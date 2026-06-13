'use client'

import { useAppKit } from '@reown/appkit/react'
import type { Address } from 'viem'
import { useChainId } from 'wagmi'

import { LOCAL_CHAIN_ID } from '@/lib/wagmi'
import { useWallet } from '@/lib/wallet-context'

const truncate = (a?: Address) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')

function networkLabel(chainId: number, mode: string) {
	if (mode === 'ledger') return 'Base'
	if (chainId === LOCAL_CHAIN_ID) return 'Hardhat Local'
	if (chainId === 84532) return 'Base Sepolia'
	if (chainId === 8453) return 'Base'
	return `Chain ${chainId}`
}

/**
 * Sticky header: brand + network badge + dual wallet connect.
 * The user connects EITHER with Reown (any wallet) OR with a Ledger over WebHID
 * (DMK) — `useWallet()` unifies the active address/mode and routes the contract
 * actions accordingly.
 */
export function TopNav({ onHome }: { onHome?: () => void }) {
	const { open } = useAppKit()
	const chainId = useChainId()
	const {
		mode,
		address,
		isConnected,
		ledgerConnecting,
		ledgerError,
		connectLedger,
		disconnectLedger,
	} = useWallet()

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
							{networkLabel(chainId, mode)}
						</span>
					) : null}

					{isConnected ? (
						mode === 'ledger' ? (
							<div className="flex items-center gap-2">
								<span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-sm text-zinc-100 ring-1 ring-zinc-700">
									<span className="text-amber-400">⬡ Ledger</span>
									{truncate(address)}
								</span>
								<button
									type="button"
									onClick={disconnectLedger}
									className="inline-flex h-9 items-center rounded-lg px-2 text-sm text-zinc-400 hover:text-zinc-200"
								>
									Disconnect
								</button>
							</div>
						) : (
							<button
								type="button"
								onClick={() => open()}
								className="inline-flex h-9 items-center rounded-lg bg-emerald-500 px-4 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400"
							>
								{truncate(address)}
							</button>
						)
					) : (
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => open()}
								className="inline-flex h-9 items-center rounded-lg bg-emerald-500 px-4 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400"
							>
								Connect wallet
							</button>
							<button
								type="button"
								onClick={() => connectLedger().catch(() => {})}
								disabled={ledgerConnecting}
								title="Connect a Ledger over WebHID (Chromium)"
								className="inline-flex h-9 items-center rounded-lg border border-amber-500/40 bg-zinc-900 px-4 text-sm font-medium text-amber-300 transition-colors hover:bg-zinc-800 disabled:opacity-60"
							>
								{ledgerConnecting ? 'Connecting…' : '⬡ Connect Ledger'}
							</button>
						</div>
					)}
				</div>
			</div>
			{ledgerError ? (
				<div className="border-t border-amber-500/20 bg-amber-500/5 px-6 py-1.5 text-xs text-amber-300">
					Ledger: {ledgerError}
				</div>
			) : null}
		</header>
	)
}
