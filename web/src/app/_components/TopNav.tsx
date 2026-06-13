'use client'

import { useAppKit } from '@reown/appkit/react'
import type { Address } from 'viem'
import { useAccount, useChainId } from 'wagmi'

import { LOCAL_CHAIN_ID } from '@/lib/wagmi'

const truncate = (a?: Address) =>
	a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—'

function networkLabel(chainId: number) {
	if (chainId === LOCAL_CHAIN_ID) return 'Hardhat Local'
	if (chainId === 84532) return 'Base Sepolia'
	return `Chain ${chainId}`
}

/**
 * Sticky dashboard header: brand on the left, live network badge + wallet
 * connect/identity on the right. The wallet button opens the Reown modal.
 * Clicking the brand calls `onHome` — used to return to the landing (it clears
 * any bot the visitor was exploring).
 */
export function TopNav({ onHome }: { onHome?: () => void }) {
	const { address, isConnected } = useAccount()
	const { open } = useAppKit()
	const chainId = useChainId()

	return (
		<header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
			<div className="flex h-14 w-full items-center justify-between px-6">
				<button
					type="button"
					onClick={onHome}
					aria-label="StreamVaults home"
					className="flex items-center gap-2 rounded-lg transition-opacity hover:opacity-80"
				>
					<span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.6)]" />
					<span className="text-sm font-semibold tracking-tight text-zinc-50">
						StreamVaults
					</span>
					<span className="hidden text-xs text-zinc-600 sm:inline">
						/ capital streaming for DeFi
					</span>
				</button>

				<div className="flex items-center gap-3">
					{isConnected ? (
						<span className="hidden items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1 text-xs text-emerald-400 ring-1 ring-emerald-500/20 sm:inline-flex">
							<span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
							{networkLabel(chainId)}
						</span>
					) : null}
					<button
						type="button"
						onClick={() => open()}
						className="inline-flex h-9 items-center rounded-lg bg-emerald-500 px-4 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400"
					>
						{isConnected ? truncate(address) : 'Connect wallet'}
					</button>
				</div>
			</div>
		</header>
	)
}
