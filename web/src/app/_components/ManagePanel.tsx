'use client'

import { useState } from 'react'
import { type Address, formatUnits, parseUnits } from 'viem'
import {
	usePublicClient,
	useReadContract,
	useWaitForTransactionReceipt,
	useWriteContract
} from 'wagmi'

import { type Asset } from '@/lib/asset'
import {
	ADDRESSES,
	ENS_PARENT,
	erc20Abi,
	registryAbi,
	smartAccountAbi,
	streamVaultsAbi,
	superTokenAbi
} from '@/lib/contracts'
import { isZeroAddress, truncate } from '@/lib/format'
import { useAllBots } from '@/lib/useAllBots'

import { Card } from './Card'
import { Field, inputCls } from './Field'
import { BtcLogo, EnsLogo, EthLogo } from './Logos'
import { TxButton } from './TxButton'

type Tab = 'rules' | 'funds' | 'name' | 'bots'

const live = { query: { refetchInterval: 4_000 } } as const

/**
 * Complementary operations panel. Two tabs:
 *  - Rules: the on-chain `UserRules` enforced inside the smart account.
 *  - Funds: wrap USDC → USDCx, recover unstreamed USDCx → USDC, and sweep any
 *    USDCx stuck in the bot (the dust kill switch).
 *  - Name: register `<label>.streamvault.eth` for the smart account.
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
			subtitle="Trading rules, funds, and ENS name — all on-chain."
			className="flex min-h-0 flex-1 flex-col"
		>
			{/* Tab switcher — keeps the panel a fixed footprint so the dashboard
			    stays within the viewport instead of growing a third panel. */}
			<div className="mb-4 inline-flex rounded-lg bg-zinc-900 p-0.5 ring-1 ring-zinc-800">
				{(['rules', 'funds', 'name', 'bots'] as const).map(t => (
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
			) : tab === 'name' ? (
				<NameTab smartAccount={smartAccount} />
			) : (
				<BotsTab
					userAddress={userAddress}
					smartAccount={smartAccount}
					onSelectBot={onSelectBot}
				/>
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

	const { writeContract, data: txHash, isPending } = useWriteContract()
	const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
		hash: txHash
	})
	if (isSuccess) {
		void rulesQuery.refetch()
		void targetTokensQuery.refetch()
	}

	const rules = rulesQuery.data as
		| readonly [number, bigint, Address]
		| undefined
	const rulesSet = rules ? rules[1] !== 0n || !isZeroAddress(rules[2]) : false
	const targets = (targetTokensQuery.data as Address[] | undefined) ?? []

	const save = () =>
		writeContract({
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
					<TxButton onClick={save} pending={isPending || confirming}>
						{rulesSet ? 'Update rules' : 'Save rules'}
					</TxButton>
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

	const publicClient = usePublicClient()
	const { writeContract, writeContractAsync, data: txHash, isPending } =
		useWriteContract()
	const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
		hash: txHash
	})
	if (isSuccess) {
		void walletUsdcx.refetch()
		void saUsdcx.refetch()
	}

	const [wrapAmount, setWrapAmount] = useState('200')
	const [wrapping, setWrapping] = useState(false)

	const walletUsdcxBal = (walletUsdcx.data as bigint | undefined) ?? 0n
	const saUsdcxBal = (saUsdcx.data as bigint | undefined) ?? 0n
	const busy = isPending || confirming

	// Wrap USDC -> USDCx into the wallet. upgradeTo pulls the underlying, so
	// approve the SuperToken first.
	const wrap = async () => {
		if (!publicClient) return
		setWrapping(true)
		try {
			const underlying = parseUnits(wrapAmount, 6)
			const superAmount = parseUnits(wrapAmount, 18)
			const approveTx = await writeContractAsync({
				address: ADDRESSES.usdc,
				abi: erc20Abi,
				functionName: 'approve',
				args: [ADDRESSES.usdcx, underlying]
			})
			await publicClient.waitForTransactionReceipt({ hash: approveTx })
			const upgradeTx = await writeContractAsync({
				address: ADDRESSES.usdcx,
				abi: superTokenAbi,
				functionName: 'upgradeTo',
				args: [userAddress, superAmount, '0x']
			})
			await publicClient.waitForTransactionReceipt({ hash: upgradeTx })
			void walletUsdcx.refetch()
		} finally {
			setWrapping(false)
		}
	}

	// Recover the wallet USDCx (not yet streamed) back to USDC.
	const downgradeAll = () =>
		writeContract({
			address: ADDRESSES.usdcx,
			abi: superTokenAbi,
			functionName: 'downgrade',
			args: [walletUsdcxBal]
		})

	// Pull any streamed-but-not-swapped USDCx stuck in the smart account.
	const sweep = () =>
		writeContract({
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
				<TxButton onClick={() => void wrap()} pending={wrapping}>
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
	const { writeContract, data: txHash, isPending } = useWriteContract()
	const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
		hash: txHash
	})
	if (isSuccess) {
		// The user's smartAccountOf now points at the fresh clone; reload so the
		// whole dashboard re-reads it (and shows the empty new account).
		if (typeof window !== 'undefined') window.location.reload()
	}

	const redeploy = () =>
		writeContract({
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
					pending={isPending || confirming}
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

function NameTab({ smartAccount }: { smartAccount: Address }) {
	const labelQuery = useReadContract({
		address: ADDRESSES.smartAccountRegistry,
		abi: registryAbi,
		functionName: 'labelOf',
		args: [smartAccount]
	})

	const [label, setLabel] = useState('')
	const { writeContract, data: txHash, isPending } = useWriteContract()
	const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
		hash: txHash
	})
	if (isSuccess) void labelQuery.refetch()

	const currentLabel = labelQuery.data as string | undefined
	const hasName = !!currentLabel && currentLabel.length > 0

	// Sanitise to a DNS-style label as the user types (lowercase, a-z0-9-).
	const onLabel = (v: string) =>
		setLabel(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))

	return hasName ? (
		<dl className="grid gap-3 text-sm">
			<div>
				<dt className="flex items-center gap-1.5 text-zinc-500">
					<EnsLogo className="h-3.5 w-3.5" /> ENS name
				</dt>
				<dd className="mt-1 font-mono text-emerald-400">
					{currentLabel}.{ENS_PARENT}
				</dd>
			</div>
			<div>
				<dt className="text-zinc-500">Resolves to</dt>
				<dd className="mt-1 font-mono text-zinc-300">{truncate(smartAccount)}</dd>
			</div>
		</dl>
	) : (
		<div className="flex flex-col gap-3">
			<p className="text-xs text-zinc-500">
				Register a label that resolves to your bot as{' '}
				<span className="text-zinc-300">&lt;name&gt;.{ENS_PARENT}</span> via
				ENSIP-10 wildcard resolution.
			</p>
			<div className="flex flex-wrap items-end gap-3">
				<Field label="Pick a label" className="grow">
					<input
						value={label}
						onChange={e => onLabel(e.target.value)}
						placeholder="alice-btc-stacker"
						className={inputCls}
					/>
				</Field>
				<TxButton
					onClick={() =>
						writeContract({
							address: ADDRESSES.smartAccountRegistry,
							abi: registryAbi,
							functionName: 'register',
							args: [smartAccount, label]
						})
					}
					pending={isPending || confirming}
					disabled={!label}
				>
					Register
				</TxButton>
			</div>
		</div>
	)
}

/**
 * "Bots" tab — the user's own smart accounts (address + ENS), plus an ENS
 * searcher to jump to any bot. Clicking your own bot switches the dashboard to
 * it; any other bot opens read-only (handled by the parent's `onSelectBot`).
 */
function BotsTab({
	userAddress,
	smartAccount,
	onSelectBot
}: {
	userAddress: Address
	smartAccount: Address
	onSelectBot: (sa: Address) => void
}) {
	const { data: bots = [], isLoading } = useAllBots()
	const mine = bots.filter(
		b => b.owner.toLowerCase() === userAddress.toLowerCase()
	)

	const [query, setQuery] = useState('')
	const [submitted, setSubmitted] = useState('')
	const saQuery = useReadContract({
		address: ADDRESSES.smartAccountRegistry,
		abi: registryAbi,
		functionName: 'smartAccountOf',
		args: [submitted],
		query: { enabled: submitted.length > 0 }
	})
	const found = saQuery.data as Address | undefined
	const foundValid = found && !isZeroAddress(found)

	return (
		<div className="flex flex-col gap-5">
			{/* ENS searcher */}
			<div>
				<div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-400">
					<EnsLogo className="h-4 w-4" /> Find a bot by ENS
				</div>
				<div className="flex flex-wrap items-end gap-2">
					<Field label={`<name>.${ENS_PARENT}`} className="grow">
						<input
							value={query}
							onChange={e => setQuery(e.target.value.toLowerCase())}
							onKeyDown={e => {
								if (e.key === 'Enter') setSubmitted(query)
							}}
							placeholder="alice-btc-stacker"
							className={inputCls}
						/>
					</Field>
					<TxButton onClick={() => setSubmitted(query)}>Resolve</TxButton>
				</div>
				{submitted && !saQuery.isLoading ? (
					foundValid ? (
						<button
							type="button"
							onClick={() => onSelectBot(found)}
							className="mt-2 flex w-full items-center justify-between rounded-lg bg-zinc-900/40 px-3 py-2 text-left ring-1 ring-zinc-800 hover:ring-emerald-500/40"
						>
							<span className="font-mono text-sm text-emerald-400">
								{submitted}.{ENS_PARENT}
							</span>
							<span className="text-xs text-zinc-400">Open →</span>
						</button>
					) : (
						<p className="mt-2 text-xs text-rose-400">
							No bot named {submitted}.{ENS_PARENT}.
						</p>
					)
				) : null}
			</div>

			{/* Your bots */}
			<div>
				<div className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
					Your bots
				</div>
				{isLoading ? (
					<p className="text-sm text-zinc-500">Loading…</p>
				) : mine.length === 0 ? (
					<p className="text-sm text-zinc-500">No bots for this wallet yet.</p>
				) : (
					<ul className="flex flex-col gap-2">
						{mine.map(b => {
							const active =
								b.smartAccount.toLowerCase() === smartAccount.toLowerCase()
							return (
								<li key={b.smartAccount}>
									<button
										type="button"
										onClick={() => onSelectBot(b.smartAccount)}
										className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ring-1 transition-colors ${
											active
												? 'bg-emerald-500/10 ring-emerald-500/30'
												: 'bg-zinc-900/40 ring-zinc-800 hover:ring-zinc-600'
										}`}
									>
										<span className="flex items-center gap-2">
											<span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
												{b.label ? <EnsLogo className="h-4 w-4" /> : '⚙'}
											</span>
											<span className="flex flex-col leading-tight">
												<span className="font-mono text-sm text-emerald-400">
													{b.label
														? `${b.label}.${ENS_PARENT}`
														: truncate(b.smartAccount)}
												</span>
												<span className="font-mono text-[10px] text-zinc-500">
													{truncate(b.smartAccount)}
												</span>
											</span>
										</span>
										{active ? (
											<span className="text-[10px] uppercase tracking-wider text-emerald-400">
												active
											</span>
										) : (
											<span className="text-xs text-zinc-500">view →</span>
										)}
									</button>
								</li>
							)
						})}
					</ul>
				)}
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
