'use client'

import { useState } from 'react'
import { type Address, formatUnits, parseUnits } from 'viem'
import { useReadContract } from 'wagmi'

import { type Asset } from '@/lib/asset'
import {
	ADDRESSES,
	erc20Abi,
	smartAccountAbi,
	streamVaultsAbi,
	superTokenAbi
} from '@/lib/contracts'
import { isZeroAddress, truncate } from '@/lib/format'
import { useDualWrite } from '@/lib/use-dual-write'

import { Card } from './Card'
import { Field, inputCls } from './Field'
import { BtcLogo, EthLogo } from './Logos'
import { TxButton } from './TxButton'

type Tab = 'rules' | 'funds' | 'bots'

const live = { query: { refetchInterval: 4_000 } } as const

/**
 * Complementary operations panel. Two tabs:
 *  - Rules: the on-chain `UserRules` enforced inside the smart account.
 *  - Funds: wrap USDC → USDCx, recover unstreamed USDCx → USDC, and sweep any
 *    USDCx stuck in the bot (the dust kill switch).
 *  - Bots: open any StreamBot read-only by its smart-account address.
 */
export function ManagePanel({
	userAddress,
	smartAccount,
	asset,
	onAssetChange,
	onSelectBot
}: {
	userAddress: Address
	smartAccount: Address
	asset: Asset
	onAssetChange: (a: Asset) => void
	onSelectBot: (sa: Address) => void
}) {
	const [tab, setTab] = useState<Tab>('rules')

	return (
		<Card
			title="Manage"
			subtitle="Trading rules and funds — all on-chain."
			className="flex min-h-0 flex-1 flex-col"
		>
			{/* Tab switcher — keeps the panel a fixed footprint so the dashboard
			    stays within the viewport instead of growing a third panel. */}
			<div className="mb-4 inline-flex rounded-lg bg-zinc-900 p-0.5 ring-1 ring-zinc-800">
				{(['rules', 'funds', 'bots'] as const).map(t => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
							tab === t
								? 'bg-emerald-500 text-zinc-950'
								: 'text-zinc-400 hover:text-zinc-200'
						}`}
					>
						{t}
					</button>
				))}
			</div>

			{tab === 'rules' ? (
				<RulesTab
					userAddress={userAddress}
					smartAccount={smartAccount}
					asset={asset}
					onAssetChange={onAssetChange}
				/>
			) : tab === 'funds' ? (
				<FundsTab userAddress={userAddress} smartAccount={smartAccount} />
			) : (
				<BotsTab smartAccount={smartAccount} onSelectBot={onSelectBot} />
			)}
		</Card>
	)
}

function RulesTab({
	userAddress,
	smartAccount,
	asset,
	onAssetChange
}: {
	userAddress: Address
	smartAccount: Address
	asset: Asset
	onAssetChange: (a: Asset) => void
}) {
	const rulesQuery = useReadContract({
		address: smartAccount,
		abi: smartAccountAbi,
		functionName: 'rules'
	})
	const targetTokensQuery = useReadContract({
		address: smartAccount,
		abi: smartAccountAbi,
		functionName: 'targetTokens'
	})

	const [maxSlippageBps, setSlippage] = useState('50')
	const [minTradeAmount, setMinTrade] = useState('1')
	const [settlement, setSettlement] = useState('')

	// The chosen asset maps to a real target token. On a real network WBTC and
	// WETH are distinct whitelisted tokens, so changing this makes the bot
	// actually buy the other asset; on the local mock both resolve to the one
	// whitelisted target.
	const targetAddress = asset === 'BTC' ? ADDRESSES.wbtc : ADDRESSES.weth
	const AssetLogo = asset === 'BTC' ? BtcLogo : EthLogo

	const { write, isPending: busy, error } = useDualWrite(() => {
		void rulesQuery.refetch()
		void targetTokensQuery.refetch()
	})

	const rules = rulesQuery.data as
		| readonly [number, bigint, Address]
		| undefined
	const rulesSet = rules ? rules[1] !== 0n || !isZeroAddress(rules[2]) : false
	const targets = (targetTokensQuery.data as Address[] | undefined) ?? []

	const save = () =>
		void write({
			address: smartAccount,
			abi: smartAccountAbi,
			functionName: 'setRules',
			args: [
				[
					Number(maxSlippageBps),
					parseUnits(minTradeAmount, 6),
					// Default to the connected wallet — the contract rejects a zero
					// settlement (INVALID_RULES). Mirrors the onboarding flow.
					(settlement || userAddress) as Address,
					[targetAddress]
				]
			]
		})

	return (
		<div className="flex flex-col gap-4">
			{rulesSet && rules ? (
				<dl className="grid grid-cols-2 gap-3 text-sm">
					<Stat label="Max slippage" value={`${rules[0]} bps`} />
					<Stat label="Min trade" value={`${formatUnits(rules[1], 6)} USDC`} />
					<Stat
						label="Settlement"
						value={
							isZeroAddress(rules[2])
								? '—'
								: `${rules[2].slice(0, 6)}…${rules[2].slice(-4)}`
						}
						mono
					/>
					<Stat label="Targets" value={`${targets.length}`} />
				</dl>
			) : null}

			<form
				className="grid gap-3 sm:grid-cols-2"
				onSubmit={e => {
					e.preventDefault()
					save()
				}}
			>
				<Field label="Max slippage (bps)">
					<input
						value={maxSlippageBps}
						onChange={e => setSlippage(e.target.value)}
						className={inputCls}
					/>
				</Field>
				<Field label="Min trade (USDC)">
					<input
						value={minTradeAmount}
						onChange={e => setMinTrade(e.target.value)}
						className={inputCls}
					/>
				</Field>
				<Field label="Settlement (defaults to wallet)" className="sm:col-span-2">
					<input
						value={settlement}
						onChange={e => setSettlement(e.target.value)}
						placeholder="0x..."
						className={inputCls}
					/>
				</Field>
				<Field label="Target token (what the bot buys)" className="sm:col-span-2">
					<div className="flex items-center gap-2">
						<AssetLogo className="h-5 w-5 shrink-0" />
						<select
							value={asset}
							onChange={e => onAssetChange(e.target.value as Asset)}
							className={inputCls}
						>
							<option value="BTC">WBTC · Bitcoin</option>
							<option value="ETH">WETH · Ethereum</option>
						</select>
					</div>
				</Field>
				<div className="sm:col-span-2">
					<TxButton onClick={save} pending={busy}>
						{rulesSet ? 'Update rules' : 'Save rules'}
					</TxButton>
					{error ? (
						<p className="mt-2 break-words text-xs text-rose-400">{error}</p>
					) : null}
				</div>
			</form>
		</div>
	)
}

function FundsTab({
	userAddress,
	smartAccount
}: {
	userAddress: Address
	smartAccount: Address
}) {
	const walletUsdcx = useReadContract({
		address: ADDRESSES.usdcx,
		abi: superTokenAbi,
		functionName: 'balanceOf',
		args: [userAddress],
		...live
	})
	const saUsdcx = useReadContract({
		address: ADDRESSES.usdcx,
		abi: superTokenAbi,
		functionName: 'balanceOf',
		args: [smartAccount],
		...live
	})

	const { write, isPending: busy, error } = useDualWrite(() => {
		void walletUsdcx.refetch()
		void saUsdcx.refetch()
	})

	const [wrapAmount, setWrapAmount] = useState('200')

	const walletUsdcxBal = (walletUsdcx.data as bigint | undefined) ?? 0n
	const saUsdcxBal = (saUsdcx.data as bigint | undefined) ?? 0n

	// Wrap USDC -> USDCx into the wallet. upgradeTo pulls the underlying, so
	// approve the SuperToken first — two sequential writes, routed by wallet mode.
	const wrap = async () => {
		const underlying = parseUnits(wrapAmount, 6)
		const superAmount = parseUnits(wrapAmount, 18)
		const approved = await write({
			address: ADDRESSES.usdc,
			abi: erc20Abi,
			functionName: 'approve',
			args: [ADDRESSES.usdcx, underlying]
		})
		if (!approved) return
		await write({
			address: ADDRESSES.usdcx,
			abi: superTokenAbi,
			functionName: 'upgradeTo',
			args: [userAddress, superAmount, '0x']
		})
	}

	// Recover the wallet USDCx (not yet streamed) back to USDC.
	const downgradeAll = () =>
		void write({
			address: ADDRESSES.usdcx,
			abi: superTokenAbi,
			functionName: 'downgrade',
			args: [walletUsdcxBal]
		})

	// Pull any streamed-but-not-swapped USDCx stuck in the smart account.
	const sweep = () =>
		void write({
			address: smartAccount,
			abi: smartAccountAbi,
			functionName: 'withdrawAll',
			args: [ADDRESSES.usdcx, userAddress]
		})

	return (
		<div className="flex flex-col gap-4">
			<dl className="grid grid-cols-2 gap-3 text-sm">
				<Stat
					label="Wallet USDCx"
					value={formatUnits(walletUsdcxBal, 18)}
					mono
				/>
				<Stat label="Bot USDCx (in-flight)" value={formatUnits(saUsdcxBal, 18)} mono />
			</dl>

			<div className="flex flex-wrap items-end gap-2">
				<Field label="Wrap USDC → USDCx" className="grow">
					<input
						value={wrapAmount}
						onChange={e => setWrapAmount(e.target.value)}
						className={inputCls}
					/>
				</Field>
				<TxButton onClick={() => void wrap()} pending={busy}>
					Wrap
				</TxButton>
			</div>

			<div className="flex flex-wrap gap-2">
				<TxButton
					tone="ghost"
					onClick={downgradeAll}
					pending={busy}
					disabled={walletUsdcxBal === 0n}
				>
					Recover → USDC
				</TxButton>
				<TxButton
					tone="ghost"
					onClick={sweep}
					pending={busy}
					disabled={saUsdcxBal === 0n}
				>
					Sweep bot
				</TxButton>
			</div>

			{error ? (
				<p className="break-words text-xs text-rose-400">{error}</p>
			) : null}

			<RedeployBot saUsdcxBal={saUsdcxBal} />
		</div>
	)
}

/**
 * Replaces the user's smart account with a fresh clone on the current
 * implementation (`StreamVaults.redeploySmartAccount`). Needed after a protocol
 * upgrade: the existing EIP-1167 clone is immutable, so a user whose account
 * predates a fix (e.g. the Permit2 swap fix) regenerates it here without
 * switching wallets. Reloads on success so the dashboard reads the new account.
 */
function RedeployBot({ saUsdcxBal }: { saUsdcxBal: bigint }) {
	const { write, isPending: busy } = useDualWrite(() => {
		// The user's smartAccountOf now points at the fresh clone; reload so the
		// whole dashboard re-reads it (and shows the empty new account).
		if (typeof window !== 'undefined') window.location.reload()
	})

	const redeploy = () =>
		void write({
			address: ADDRESSES.streamVaults,
			abi: streamVaultsAbi,
			functionName: 'redeploySmartAccount'
		})

	return (
		<div className="mt-2 flex flex-col gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
			<p className="text-xs text-amber-300/90">
				Redeploy bot — replaces your smart account with a fresh one on the
				latest contract version (use after a protocol upgrade).
			</p>
			<p className="text-[11px] text-zinc-500">
				Close your stream and Recover/Sweep first — the old account is
				abandoned and the new one starts with no rules.
			</p>
			<div>
				<TxButton
					tone="danger"
					onClick={redeploy}
					pending={busy}
					disabled={saUsdcxBal !== 0n}
				>
					Redeploy bot
				</TxButton>
				{saUsdcxBal !== 0n ? (
					<p className="mt-1 text-[11px] text-rose-400">
						Sweep the bot&apos;s USDCx first.
					</p>
				) : null}
			</div>
		</div>
	)
}

/**
 * "Bots" tab — open any StreamBot read-only by pasting its smart-account
 * address. The current bot is shown as active; pasting another address opens it
 * via the parent's `onSelectBot` (read-only public view).
 */
function BotsTab({
	smartAccount,
	onSelectBot
}: {
	smartAccount: Address
	onSelectBot: (sa: Address) => void
}) {
	const [query, setQuery] = useState('')
	const trimmed = query.trim()
	const isAddress = /^0x[0-9a-fA-F]{40}$/.test(trimmed)

	return (
		<div className="flex flex-col gap-5">
			{/* Address lookup */}
			<div>
				<div className="mb-2 text-xs text-zinc-400">Open a bot by address</div>
				<div className="flex flex-wrap items-end gap-2">
					<Field label="Smart-account address" className="grow">
						<input
							value={query}
							onChange={e => setQuery(e.target.value)}
							onKeyDown={e => {
								if (e.key === 'Enter' && isAddress)
									onSelectBot(trimmed as Address)
							}}
							placeholder="0x…"
							className={inputCls}
						/>
					</Field>
					<TxButton
						onClick={() => onSelectBot(trimmed as Address)}
						disabled={!isAddress}
					>
						Open
					</TxButton>
				</div>
				{trimmed && !isAddress ? (
					<p className="mt-2 text-xs text-rose-400">
						Enter a valid 0x address.
					</p>
				) : null}
			</div>

			{/* This bot */}
			<div>
				<div className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
					This bot
				</div>
				<div className="flex w-full items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2 ring-1 ring-emerald-500/30">
					<span className="flex items-center gap-2">
						<span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
							⚙
						</span>
						<span className="font-mono text-sm text-emerald-400">
							{truncate(smartAccount)}
						</span>
					</span>
					<span className="text-[10px] uppercase tracking-wider text-emerald-400">
						active
					</span>
				</div>
			</div>
		</div>
	)
}

function Stat({
	label,
	value,
	mono
}: {
	label: string
	value: string
	mono?: boolean
}) {
	return (
		<div>
			<dt className="text-zinc-500">{label}</dt>
			<dd className={`mt-1 text-zinc-200 ${mono ? 'font-mono' : ''}`}>
				{value}
			</dd>
		</div>
	)
}
