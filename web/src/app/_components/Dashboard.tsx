'use client'

import { useState } from 'react'
import { type Address, formatUnits } from 'viem'
import { useReadContract } from 'wagmi'

import { type Asset, ASSETS } from '@/lib/asset'
import {
	ADDRESSES,
	cfaForwarderAbi,
	erc20Abi,
	outputDecimals,
	superTokenAbi
} from '@/lib/contracts'
import { SECONDS_PER_DAY, truncate } from '@/lib/format'
import { useSwapHistory } from '@/lib/useSwapHistory'

import { KpiCard } from './KpiCard'
import { BtcLogo, EthLogo, UsdcLogo } from './Logos'
import { ManagePanel } from './ManagePanel'
import { PriceChart } from './PriceChart'
import { useStreamSimulator } from './SimulateStream'
import { StreamPanel } from './StreamPanel'
import { SwapHistory } from './SwapHistory'
import { ToolsButton } from './ToolsButton'

// Poll balances/flowrate a few times a minute so the KPIs track the stream.
const live = { query: { refetchInterval: 4_000 } } as const

const fmt = (v: bigint, decimals: number, max = 4) =>
	Number(formatUnits(v, decimals)).toLocaleString(undefined, {
		maximumFractionDigits: max
	})

/**
 * The post-setup dashboard. Full-width and viewport-locked: a KPI row on top,
 * then a two-column workspace that flexes to fill the remaining height — the
 * live BTC chart (taller) + swap log (shorter) on the left, the operational
 * panels (stream control, manage) on the right. The right column owns the
 * only optional scroll, so the page itself never gets a nested scroll.
 * Utilities (faucet, stream simulator, discovery) live in the floating Tools
 * modal instead of the main flow.
 */
export function Dashboard({
	userAddress,
	smartAccount,
	onSelectBot
}: {
	userAddress: Address
	smartAccount: Address
	onSelectBot: (sa: Address) => void
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
	const weth = useReadContract({
		address: ADDRESSES.weth,
		abi: erc20Abi,
		functionName: 'balanceOf',
		args: [userAddress],
		...live
	})
	const wbtc = useReadContract({
		address: ADDRESSES.wbtc,
		abi: erc20Abi,
		functionName: 'balanceOf',
		args: [userAddress],
		...live
	})
	const flowrate = useReadContract({
		address: ADDRESSES.cfaForwarder,
		abi: cfaForwarderAbi,
		functionName: 'getFlowrate',
		args: [ADDRESSES.usdcx, userAddress, smartAccount],
		...live
	})

	const { data: swaps = [], isLoading } = useSwapHistory(smartAccount)

	// Stream-simulation engine — mounted here (not in the Tools modal) so it
	// keeps streaming after the modal closes. No-op off the local chain.
	const sim = useStreamSimulator(userAddress, smartAccount)

	// Which target asset to display — drives the chart's market, the KPI/swap
	// labels, and the rules target selector (kept in sync). On the local chain
	// the on-chain target is a single whitelisted mock, so this is a display
	// choice, not a separate token.
	const [asset, setAsset] = useState<Asset>('BTC')
	const assetToken = ASSETS[asset].token
	const AssetLogo = asset === 'BTC' ? BtcLogo : EthLogo

	const walletUsdcxBal = (walletUsdcx.data as bigint | undefined) ?? 0n
	const saUsdcxBal = (saUsdcx.data as bigint | undefined) ?? 0n
	const wethBal = (weth.data as bigint | undefined) ?? 0n
	const wbtcBal = (wbtc.data as bigint | undefined) ?? 0n
	// "Acquired" KPI tracks the token actually being bought (the active asset),
	// with that token's decimals (WBTC 8, WETH 18) — not always WETH/18.
	const acquiredBal = asset === 'BTC' ? wbtcBal : wethBal
	const acquiredDecimals =
		asset === 'BTC' ? outputDecimals(ADDRESSES.wbtc) : 18
	const rate = (flowrate.data as bigint | undefined) ?? 0n
	const perDay = rate * SECONDS_PER_DAY
	const streamActive = rate > 0n

	return (
		// Viewport-locked, full-width shell. The dashboard fills the height of
		// `<main>` exactly, so the chart, swap history and side panels all
		// stretch to use every available pixel instead of leaving dead space.
		<div className="flex h-full w-full flex-col overflow-hidden">
			<div className="flex h-full w-full flex-col gap-3 px-4 py-3">
				{/* KPI row — fixed height. */}
				<section className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
					<KpiCard
						label="Wallet USDCx"
						value={fmt(walletUsdcxBal, 18, 2)}
						hint="drains as it streams"
						icon={<UsdcLogo className="h-3.5 w-3.5" />}
					/>
					<KpiCard
						label="In-flight (bot)"
						value={fmt(saUsdcxBal, 18, 4)}
						tone={saUsdcxBal > 0n ? 'warning' : 'default'}
						hint="exposure right now"
						icon={<UsdcLogo className="h-3.5 w-3.5" />}
					/>
					<KpiCard
						label={`${assetToken} acquired`}
						value={fmt(acquiredBal, acquiredDecimals, 8)}
						tone="positive"
						hint="settled to your wallet"
						icon={<AssetLogo className="h-3.5 w-3.5" />}
					/>
					<KpiCard
						label="Stream rate"
						value={streamActive ? fmt(perDay, 18, 0) : 'Off'}
						unit={streamActive ? 'USDCx/day' : undefined}
						tone={streamActive ? 'positive' : 'default'}
						hint={`bot · ${truncate(smartAccount)}`}
					/>
				</section>

				{/* Workspace — flexes to fill the rest of the viewport. */}
				<section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-3">
					{/* Left: chart (grows most) + swap history (grows). */}
					<div className="flex min-h-0 flex-col gap-3 lg:col-span-2">
						<div className="flex min-h-0 flex-2 flex-col rounded-2xl bg-zinc-950/40 p-4 ring-1 ring-zinc-800">
							<PriceChart
								swaps={swaps}
								asset={asset}
								onAssetChange={setAsset}
							/>
						</div>
						<div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-zinc-950/40 p-4 ring-1 ring-zinc-800">
							<SwapHistory swaps={swaps} isLoading={isLoading} />
						</div>
					</div>

					{/* Right: operational panels — column scrolls internally
					    only if both panels don't fit, so we never leak a scroll
					    onto the page. */}
					<div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
						<StreamPanel userAddress={userAddress} smartAccount={smartAccount} />
						<ManagePanel
							userAddress={userAddress}
							smartAccount={smartAccount}
							asset={asset}
							onAssetChange={setAsset}
							onSelectBot={onSelectBot}
						/>
					</div>
				</section>
			</div>

			{/* Floating utilities (faucet · simulator · discovery). */}
			<ToolsButton sim={sim} />
		</div>
	)
}
