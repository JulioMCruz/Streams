'use client'

import { type Address, formatUnits } from 'viem'
import { usePublicClient } from 'wagmi'

import { ADDRESSES } from '@/lib/contracts'
import { truncate } from '@/lib/format'
import type { Swap } from '@/lib/useSwapHistory'

import { BtcLogo, EthLogo, UniswapLogo, UsdcLogo } from './Logos'

const fmtTime = (unix: number) =>
	unix > 0
		? new Date(unix * 1000).toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			})
		: '—'

const fmt = (v: bigint, decimals: number, max = 4) =>
	Number(formatUnits(v, decimals)).toLocaleString(undefined, {
		maximumFractionDigits: max
	})

/// Resolve a swap's output token to its mark + symbol from the on-chain
/// `tokenOut` — so each row reflects what was *actually* bought, regardless of
/// the asset currently selected for the chart. On the local chain WBTC and
/// WETH resolve to the same mock, so everything reads as WBTC there.
const sameAddr = (a?: string, b?: string) =>
	!!a && !!b && a.toLowerCase() === b.toLowerCase()

function outMark(tokenOut: Address) {
	if (sameAddr(tokenOut, ADDRESSES.wbtc))
		return { sym: 'WBTC', Logo: BtcLogo }
	if (sameAddr(tokenOut, ADDRESSES.weth))
		return { sym: 'WETH', Logo: EthLogo }
	return { sym: '', Logo: BtcLogo }
}

/**
 * Swap log table — the smart account's realized DCA trades, newest first.
 * Each row is one `Executed` event: USDC in, the token actually bought (BTC or
 * ETH, per the swap's own `tokenOut`), and the realized price. Switching the
 * dashboard's target asset does NOT relabel this — it shows the full history.
 */
export function SwapHistory({
	swaps,
	isLoading
}: {
	swaps: Swap[]
	isLoading?: boolean
}) {
	const rows = [...swaps].reverse()
	// Block explorer for the active chain (basescan on mainnet/sepolia; none on
	// the local chain) — used to link each tx hash.
	const publicClient = usePublicClient()
	const explorer = publicClient?.chain?.blockExplorers?.default?.url

	return (
		<div className="flex h-full flex-col">
			<div className="mb-3 flex items-baseline justify-between">
				<h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
					Swap history
					<span className="flex items-center gap-1 text-[11px] font-normal text-zinc-500">
						via <UniswapLogo className="h-3.5 w-3.5" /> Uniswap
					</span>
				</h2>
				<span className="text-xs text-zinc-500">
					{swaps.length} trade{swaps.length === 1 ? '' : 's'}
				</span>
			</div>

			<div className="min-h-0 flex-1 overflow-auto">
				{rows.length === 0 ? (
					<div className="flex h-full items-center justify-center py-8">
						<p className="text-sm text-zinc-500">
							{isLoading ? 'Loading swaps…' : 'No swaps yet.'}
						</p>
					</div>
				) : (
					<table className="w-full text-left text-sm">
						<thead className="sticky top-0 bg-zinc-950/90 text-[11px] uppercase tracking-wider text-zinc-500 backdrop-blur">
							<tr>
								<th className="py-2 pr-3 font-medium">Time</th>
								<th className="py-2 pr-3 font-medium">
									<span className="flex items-center gap-1">
										<UsdcLogo className="h-3 w-3" /> USDC in
									</span>
								</th>
								<th className="py-2 pr-3 font-medium">Bought</th>
								<th className="py-2 pr-3 font-medium">Price</th>
								<th className="py-2 font-medium">Tx</th>
							</tr>
						</thead>
						<tbody className="font-mono text-zinc-300">
							{rows.map(s => {
								const { sym, Logo } = outMark(s.tokenOut)
								return (
									<tr
										key={s.txHash}
										className="border-t border-zinc-800/60 hover:bg-zinc-900/40"
									>
										<td className="py-2 pr-3 text-zinc-400">{fmtTime(s.time)}</td>
										<td className="py-2 pr-3">
											<span className="flex items-center gap-1.5">
												<UsdcLogo className="h-3.5 w-3.5" />
												{fmt(s.amountIn, 6, 2)}
											</span>
										</td>
										<td className="py-2 pr-3 text-emerald-400">
											<span className="flex items-center gap-1.5">
												<Logo className="h-3.5 w-3.5" />
												{fmt(s.amountOut, s.amountOutDecimals, 8)}
												{sym ? (
													<span className="text-zinc-500">{sym}</span>
												) : null}
											</span>
										</td>
										<td className="py-2 pr-3">
											{s.price.toLocaleString(undefined, {
												maximumFractionDigits: 2
											})}
										</td>
										<td className="py-2 text-zinc-500">
											{explorer ? (
												<a
													href={`${explorer}/tx/${s.txHash}`}
													target="_blank"
													rel="noreferrer"
													className="text-emerald-400/80 hover:text-emerald-300 hover:underline"
												>
													{truncate(s.txHash)}
												</a>
											) : (
												truncate(s.txHash)
											)}
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				)}
			</div>
		</div>
	)
}
