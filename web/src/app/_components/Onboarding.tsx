'use client'

import { useMemo, useState } from 'react'
import {
	type Address,
	encodeFunctionData,
	type Hex,
	parseUnits,
	zeroHash
} from 'viem'
import {
	useCapabilities,
	useChainId,
	usePublicClient,
	useSendCalls,
	useSignTypedData,
	useWaitForCallsStatus,
	useWriteContract
} from 'wagmi'

import {
	ADDRESSES,
	cfaForwarderAbi,
	erc20Abi,
	erc2612Abi,
	streamVaultsAbi
} from '@/lib/contracts'
import { buildPermitTypedData, toPermit2612Sig } from '@/lib/permit'
import { LOCAL_CHAIN_ID } from '@/lib/wagmi'
import { useWallet } from '@/lib/wallet-context'

import { Card } from './Card'
import { FaucetCard } from './Faucet'
import { Field, inputCls } from './Field'
import { TxButton } from './TxButton'

type StartStatus = 'idle' | 'signing' | 'sending' | 'confirming' | 'error'

type FlowUnit = 'second' | 'minute' | 'hour' | 'day'

const UNIT_SECONDS: Record<FlowUnit, number> = {
	second: 1,
	minute: 60,
	hour: 3_600,
	day: 86_400
}

/// Superfluid clean-up deposit ("buffer") = liquidation period × flow rate. On
/// Base mainnet the governance liquidation period is 4 hours; the buffer is
/// locked from the streamer's SuperToken balance and returned on a clean close.
/// Opening a stream without enough balance to cover it reverts — the #1 reason
/// startStreamBot fails, so we surface it before the user signs.
const BUFFER_SECONDS = 4 * 60 * 60

const fmtDuration = (s: number): string => {
	if (!Number.isFinite(s) || s <= 0) return '—'
	if (s < 90) return `${Math.round(s)}s`
	if (s < 5_400) return `${(s / 60).toFixed(1)} min`
	if (s < 172_800) return `${(s / 3_600).toFixed(1)} h`
	return `${(s / 86_400).toFixed(1)} days`
}

const fmtNum = (n: number, max = 2): string =>
	Number.isFinite(n)
		? n.toLocaleString(undefined, { maximumFractionDigits: max })
		: '—'

/**
 * First-run experience for a wallet without a smart account: the pitch, the
 * local faucet, and the single "Start StreamBot" action (spec §4). Signs an
 * EIP-2612 permit off-chain, then sends an EIP-5792 batch — grantPermissions
 * + startStreamBot — which the wallet atomises when it can.
 */
export function Onboarding({
	userAddress,
	refetchSa
}: {
	userAddress: Address
	refetchSa: () => void
}) {
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
			<section className="flex flex-col gap-3 rounded-2xl bg-gradient-to-br from-emerald-900/20 via-zinc-900/40 to-zinc-950 p-8 ring-1 ring-emerald-500/20">
				<p className="text-xs font-medium uppercase tracking-widest text-emerald-400">
					StreamVaults
				</p>
				<h1 className="text-3xl font-semibold leading-tight">
					Pay your DCA bot while you use it.
				</h1>
				<p className="max-w-2xl text-sm text-zinc-400">
					You don&apos;t deposit upfront. You stream USDC at a rate you set, and
					the protocol only ever holds what has already flowed in. Your exposure
					is hours of flow, not a full TVL.
				</p>
			</section>

			<FaucetCard />
			<StartStreamBot userAddress={userAddress} refetchSa={refetchSa} />
		</div>
	)
}

function StartStreamBot({
	userAddress,
	refetchSa
}: {
	userAddress: Address
	refetchSa: () => void
}) {
	const chainId = useChainId()
	const publicClient = usePublicClient()
	const { signTypedDataAsync } = useSignTypedData()
	const { sendCallsAsync } = useSendCalls()
	const { writeContractAsync } = useWriteContract()
	const { data: capabilities } = useCapabilities({ account: userAddress })
	const { mode, ledgerSession } = useWallet()

	const [budget, setBudget] = useState('60')
	// Human-friendly rate: "<flowAmount> USDC every <flowEvery> <flowUnit>".
	// flowAmount is decimal USDC (0.5 = 50 cents); flowEvery is a whole count.
	const [flowAmount, setFlowAmount] = useState('0.5')
	const [flowEvery, setFlowEvery] = useState('5')
	const [flowUnit, setFlowUnit] = useState<FlowUnit>('minute')
	const [slippageBps, setSlippageBps] = useState('50')
	const [minTrade, setMinTrade] = useState('0.5')
	const [settlement, setSettlement] = useState('')
	// 'BTC' → WBTC token, 'ETH' → WETH token (distinct on a real network; the
	// same whitelisted mock locally).
	const [targetAsset, setTargetAsset] = useState<'BTC' | 'ETH'>('BTC')
	const target = targetAsset === 'BTC' ? ADDRESSES.wbtc : ADDRESSES.weth

	// Live stream plan: turns the human-friendly rate + budget into the flow
	// rate, the Superfluid buffer that gets locked, how long the budget streams,
	// and how often the bot can trade — so the buffer requirement is visible
	// *before* signing instead of surfacing as a MetaMask revert.
	const plan = useMemo(() => {
		const amt = Number(flowAmount)
		const every = Math.floor(Number(flowEvery))
		const bud = Number(budget)
		const mt = Number(minTrade)
		const secs = UNIT_SECONDS[flowUnit] * every
		if (!(amt > 0) || !(every > 0) || secs <= 0) return null
		const ratePerSec = amt / secs // USDCx/s (1:1 with USDC)
		const perDay = ratePerSec * 86_400
		const buffer = ratePerSec * BUFFER_SECONDS
		const hasBudget = bud > 0
		const streamable = hasBudget ? bud - buffer : 0
		const streamDuration = streamable > 0 ? streamable / ratePerSec : 0
		const swapEvery = mt > 0 ? mt / ratePerSec : 0
		const enough = hasBudget && bud > buffer
		return { perDay, buffer, streamable, streamDuration, swapEvery, enough }
	}, [flowAmount, flowEvery, flowUnit, budget, minTrade])

	const [status, setStatus] = useState<StartStatus>('idle')
	const [error, setError] = useState<string | null>(null)
	const [callsId, setCallsId] = useState<string | undefined>()

	const { isSuccess } = useWaitForCallsStatus({
		id: callsId,
		query: { enabled: Boolean(callsId) }
	})
	if (isSuccess && status !== 'idle') {
		setStatus('idle')
		setCallsId(undefined)
		void refetchSa()
	}

	const atomicStatus =
		capabilities?.[chainId]?.atomic?.status ??
		capabilities?.[chainId]?.atomicBatch?.status
	const isAtomic = atomicStatus === 'supported' || atomicStatus === 'ready'
	const busy = status === 'signing' || status === 'sending'

	const start = async () => {
		if (!publicClient) return
		setError(null)
		try {
			const underlyingAmount = parseUnits(budget, 6)
			// Flow rate (int96 wei/s): "<flowAmount> USDCx every <flowEvery> <flowUnit>".
			const intervalSecs = BigInt(
				Math.floor(UNIT_SECONDS[flowUnit] * Number(flowEvery))
			)
			const rate = parseUnits(flowAmount, 18) / intervalSecs
			const rules = {
				maxSlippageBps: Number(slippageBps),
				minTradeAmount: parseUnits(minTrade, 6),
				settlementAddress: (settlement || userAddress) as Address,
				targetTokens: [target]
			}

			// Ledger mode: the whole setup is ONE device-signed EIP-7702 transaction
			// (delegate to Simple7702Account, then executeBatch grant+approve+start).
			// The device signs the delegation and the type-4 tx; we broadcast it to
			// Base mainnet. Two on-device approvals, no permit/EIP-5792 needed.
			if (mode === 'ledger' && ledgerSession) {
				setStatus('signing')
				const { startStreamBotWithLedger } = await import('@/lib/ledger-7702')
				setStatus('sending')
				await startStreamBotWithLedger(ledgerSession, {
					budget: underlyingAmount,
					rate,
					rules
				})
				setStatus('idle')
				void refetchSa()
				return
			}

			// Local Hardhat mocks can't do EIP-5792/7702 batching and the mock
			// CFA has no grantPermissions, so run plain sequential
			// approve + startStreamBot (its permit is try/catch'd on-chain).
			if (chainId === LOCAL_CHAIN_ID) {
				setStatus('sending')
				const approveTx = await writeContractAsync({
					address: ADDRESSES.usdc,
					abi: erc20Abi,
					functionName: 'approve',
					args: [ADDRESSES.streamVaults, underlyingAmount]
				})
				await publicClient.waitForTransactionReceipt({ hash: approveTx })
				const startTx = await writeContractAsync({
					address: ADDRESSES.streamVaults,
					abi: streamVaultsAbi,
					functionName: 'startStreamBot',
					args: [
						ADDRESSES.usdcx,
						underlyingAmount,
						rate,
						rules,
						{
							deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
							v: 0,
							r: zeroHash,
							s: zeroHash
						}
					]
				})
				await publicClient.waitForTransactionReceipt({ hash: startTx })
				setStatus('idle')
				void refetchSa()
				return
			}

			setStatus('signing')
			const [nonce, tokenName] = await Promise.all([
				publicClient.readContract({
					address: ADDRESSES.usdc,
					abi: erc2612Abi,
					functionName: 'nonces',
					args: [userAddress]
				}),
				publicClient.readContract({
					address: ADDRESSES.usdc,
					abi: erc2612Abi,
					functionName: 'name'
				})
			])
			let version = '2'
			try {
				version = await publicClient.readContract({
					address: ADDRESSES.usdc,
					abi: erc2612Abi,
					functionName: 'version'
				})
			} catch {
				// Token doesn't expose version(); USDC's EIP-712 domain is "2".
			}
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
			const signature = (await signTypedDataAsync(
				buildPermitTypedData({
					tokenName,
					version,
					chainId,
					token: ADDRESSES.usdc,
					owner: userAddress,
					spender: ADDRESSES.streamVaults,
					value: underlyingAmount,
					nonce,
					deadline
				})
			)) as Hex
			const permitSig = toPermit2612Sig(signature, deadline)

			setStatus('sending')
			const { id } = await sendCallsAsync({
				calls: [
					{
						to: ADDRESSES.cfaForwarder,
						data: encodeFunctionData({
							abi: cfaForwarderAbi,
							functionName: 'grantPermissions',
							args: [ADDRESSES.usdcx, ADDRESSES.streamVaults]
						})
					},
					{
						to: ADDRESSES.streamVaults,
						data: encodeFunctionData({
							abi: streamVaultsAbi,
							functionName: 'startStreamBot',
							args: [ADDRESSES.usdcx, underlyingAmount, rate, rules, permitSig]
						})
					}
				]
			})
			setCallsId(id)
			setStatus('confirming')
		} catch (err) {
			setStatus('error')
			setError(err instanceof Error ? err.message : String(err))
		}
	}

	return (
		<Card
			title="Start your StreamBot"
			subtitle="One action sets everything up: sign once, and your USDC is wrapped, your bot deployed, and your stream opened — atomically."
			tone="active"
		>
			<form
				className="grid gap-3 sm:grid-cols-2"
				onSubmit={e => {
					e.preventDefault()
					void start()
				}}
			>
				<Field label="Budget to wrap (USDC)">
					<input
						value={budget}
						onChange={e => setBudget(e.target.value)}
						className={inputCls}
					/>
				</Field>
				<Field
					label="Stream rate · how much USDC flows, and how often"
					className="sm:col-span-2"
				>
					<div className="flex flex-wrap items-center gap-2">
						<input
							value={flowAmount}
							onChange={e => setFlowAmount(e.target.value)}
							inputMode="decimal"
							className={`${inputCls} w-24`}
						/>
						<span className="text-sm text-zinc-500">USDC every</span>
						<input
							value={flowEvery}
							onChange={e => setFlowEvery(e.target.value)}
							inputMode="numeric"
							className={`${inputCls} w-20`}
						/>
						<select
							value={flowUnit}
							onChange={e => setFlowUnit(e.target.value as FlowUnit)}
							className={`${inputCls} w-32`}
						>
							<option value="second">seconds</option>
							<option value="minute">minutes</option>
							<option value="hour">hours</option>
							<option value="day">days</option>
						</select>
					</div>
					<span className="mt-1 text-xs text-zinc-600">
						Amount is in USDC — decimals are cents (0.5 = 50¢). &ldquo;Every&rdquo;
						is a whole number.
					</span>
				</Field>
				<Field label="Max slippage (bps)">
					<input
						value={slippageBps}
						onChange={e => setSlippageBps(e.target.value)}
						className={inputCls}
					/>
				</Field>
				<Field label="Min trade size (USDC)">
					<input
						value={minTrade}
						onChange={e => setMinTrade(e.target.value)}
						className={inputCls}
					/>
				</Field>
				<Field label="Settlement address (defaults to your wallet)">
					<input
						value={settlement}
						onChange={e => setSettlement(e.target.value)}
						placeholder="0x..."
						className={inputCls}
					/>
				</Field>
				<Field label="Target token (output of each swap)">
					<select
						value={targetAsset}
						onChange={e => setTargetAsset(e.target.value as 'BTC' | 'ETH')}
						className={inputCls}
					>
						<option value="BTC">WBTC · Bitcoin</option>
						<option value="ETH">WETH · Ethereum</option>
					</select>
				</Field>
				{plan ? (
					<div className="rounded-xl bg-zinc-900/60 p-4 text-sm ring-1 ring-zinc-800 sm:col-span-2">
						<div className="mb-2 flex items-center justify-between">
							<span className="text-xs uppercase tracking-wide text-zinc-500">
								Stream plan
							</span>
							<span className="font-mono text-zinc-400">
								≈ {fmtNum(plan.perDay)} USDCx / day
							</span>
						</div>
						<dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-zinc-300">
							<dt className="text-zinc-500">Buffer locked (Superfluid, 4h)</dt>
							<dd
								className={
									chainId === LOCAL_CHAIN_ID || plan.enough ? '' : 'text-rose-400'
								}
							>
								{fmtNum(plan.buffer, 4)} USDCx
							</dd>
							<dt className="text-zinc-500">Streams for</dt>
							<dd>{fmtDuration(plan.streamDuration)}</dd>
							<dt className="text-zinc-500">Bot can trade every</dt>
							<dd>{fmtDuration(plan.swapEvery)}</dd>
						</dl>
						{chainId === LOCAL_CHAIN_ID ? (
							<p className="mt-3 text-xs text-zinc-500">
								Local mock CFA has no real buffer — use{' '}
								<span className="text-zinc-400">Simulate stream</span> to feed the
								account.
							</p>
						) : plan.enough ? (
							<p className="mt-3 text-xs text-zinc-500">
								Of your {fmtNum(Number(budget))} USDC: {fmtNum(plan.buffer, 2)}{' '}
								locked as buffer (returned when you close the stream),{' '}
								{fmtNum(plan.streamable, 2)} streams to the bot.
							</p>
						) : (
							<p className="mt-3 text-xs text-rose-400">
								Budget too low — this rate needs at least{' '}
								{fmtNum(plan.buffer, 2)} USDC just for the Superfluid buffer. Raise
								the budget or lower the rate, or the transaction will revert.
							</p>
						)}
					</div>
				) : null}
				<div className="flex flex-col gap-2 sm:col-span-2">
					<TxButton
						pending={busy}
						disabled={
							chainId !== LOCAL_CHAIN_ID && plan !== null && !plan.enough
						}
						onClick={() => void start()}
					>
						{status === 'signing'
							? 'Sign the permit in your wallet…'
							: status === 'sending'
								? 'Confirm in your wallet…'
								: 'Start StreamBot'}
					</TxButton>
					<p className="text-xs text-zinc-500">
						{chainId === LOCAL_CHAIN_ID
							? 'Local chain: two plain transactions — approve USDC, then start (no EIP-5792/permit).'
							: isAtomic
								? 'Your wallet supports atomic batching — one confirmation sets everything up.'
								: 'Your wallet will ask you to sign the permit, then confirm one or two transactions.'}
					</p>
					{error ? (
						<p className="break-words text-xs text-rose-400">{error}</p>
					) : null}
				</div>
			</form>
		</Card>
	)
}
