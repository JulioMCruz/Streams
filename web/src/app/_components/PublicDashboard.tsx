'use client'

import { type Address, formatUnits } from 'viem'
import { useReadContract } from 'wagmi'

import {
	ADDRESSES,
	cfaForwarderAbi,
	ENS_PARENT,
	registryAbi,
	streamVaultsAbi,
	superTokenAbi
} from '@/lib/contracts'
import { isZeroAddress, SECONDS_PER_DAY, truncate } from '@/lib/format'
import { useSwapHistory } from '@/lib/useSwapHistory'

import { KpiCard } from './KpiCard'
import { BtcLogo, EnsLogo, UsdcLogo } from './Logos'
import { PriceChart } from './PriceChart'
import { SwapHistory } from './SwapHistory'

const live = { query: { refetchInterval: 4_000 } } as const

const fmt = (v: bigint, decimals: number, max = 4) =>
	Number(formatUnits(v, decimals)).toLocaleString(undefined, {
		maximumFractionDigits: max
	})

/**
 * Read-only public view of any StreamBot, reachable from the landing gallery
 * without a wallet. Shows the bot's identity, live exposure/activity KPIs, the
 * BTC market chart with its DCA buys, and its trade log — but none of the
 * operational controls, since only the owner can drive the bot.
 */
export function PublicDashboard({
	smartAccount,
	onBack
}: {
	smartAccount: Address
	onBack: () => void
}) {
	const ownerQuery = useReadContract({
		address: ADDRESSES.streamVaults,
		abi: streamVaultsAbi,
		functionName: 'userOf',
		args: [smartAccount]
	})
	const labelQuery = useReadContract({
		address: ADDRESSES.smartAccountRegistry,
		abi: registryAbi,
		functionName: 'labelOf',
		args: [smartAccount]
	})
	const inflight = useReadContract({
		address: ADDRESSES.usdcx,
		abi: superTokenAbi,
		functionName: 'balanceOf',
		args: [smartAccount],
		...live
	})

	const owner = ownerQuery.data as Address | undefined

	const flowrate = useReadContract({
		address: ADDRESSES.cfaForwarder,
		abi: cfaForwarderAbi,
		functionName: 'getFlowrate',
		args: [ADDRESSES.usdcx, owner ?? smartAccount, smartAccount],
		query: { enabled: Boolean(owner) && !isZeroAddress(owner), refetchInterval: 4_000 }
	})

	const { data: swaps = [], isLoading } = useSwapHistory(smartAccount)

	const label = labelQuery.data as string | undefined
	const named = !!label && label.length > 0
	const name = named ? `${label}.${ENS_PARENT}` : truncate(smartAccount)
	const inflightBal = (inflight.data as bigint | undefined) ?? 0n
	const rate = (flowrate.data as bigint | undefined) ?? 0n
	const perDay = rate * SECONDS_PER_DAY
	const streamActive = rate > 0n
	const totalBought = swaps.reduce((acc, s) => acc + s.amountOut, 0n)

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6 py-6">
			{/* Identity header */}
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={onBack}
						className="flex h-9 items-center gap-1 rounded-lg px-3 text-sm text-zinc-300 ring-1 ring-zinc-700 transition-colors hover:text-zinc-50 hover:ring-zinc-500"
					>
						<span>←</span> Explore
					</button>
					<div>
						<div className="flex items-center gap-2">
							<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
								{named ? <EnsLogo className="h-5 w-5" /> : '⚙'}
							</span>
							<span className="font-mono text-lg text-emerald-400">{name}</span>
						</div>
						<div className="mt-1 font-mono text-xs text-zinc-500">
							{truncate(smartAccount)} · owner {truncate(owner)}
						</div>
					</div>
				</div>
				<span
					className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ${
						streamActive
							? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30'
							: 'bg-zinc-900 text-zinc-400 ring-zinc-800'
					}`}
				>
					<span
						className={`h-1.5 w-1.5 rounded-full ${streamActive ? 'animate-pulse bg-emerald-400' : 'bg-zinc-600'}`}
					/>
					{streamActive ? 'streaming' : 'idle'}
				</span>
			</div>

			{/* KPIs */}
			<section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<KpiCard
					label="In-flight (exposed)"
					value={fmt(inflightBal, 18, 4)}
					unit="USDCx"
					tone={inflightBal > 0n ? 'warning' : 'default'}
					hint="capital at risk now"
					icon={<UsdcLogo className="h-3.5 w-3.5" />}
				/>
				<KpiCard
					label="WBTC acquired"
					value={fmt(totalBought, 18, 6)}
					tone="positive"
					hint="settled to owner"
					icon={<BtcLogo className="h-3.5 w-3.5" />}
				/>
				<KpiCard
					label="Stream rate"
					value={streamActive ? fmt(perDay, 18, 0) : 'Off'}
					unit={streamActive ? 'USDCx/day' : undefined}
					tone={streamActive ? 'positive' : 'default'}
				/>
				<KpiCard label="Trades" value={swaps.length} hint="DCA buys executed" />
			</section>

			{/* Chart */}
			<div className="flex flex-col rounded-2xl bg-zinc-950/40 p-4 ring-1 ring-zinc-800">
				<div className="mb-2">
					<h2 className="text-sm font-semibold text-zinc-100">BTC / USD</h2>
					<p className="text-xs text-zinc-500">
						Live market price — this bot&apos;s DCA buys marked on the timeline.
					</p>
				</div>
				<div className="h-[380px] w-full">
					<PriceChart swaps={swaps} />
				</div>
			</div>

			{/* Swap history */}
			<div className="flex h-[280px] flex-col rounded-2xl bg-zinc-950/40 p-4 ring-1 ring-zinc-800">
				<SwapHistory swaps={swaps} isLoading={isLoading} />
			</div>
		</div>
	)
}
