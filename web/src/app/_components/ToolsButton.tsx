'use client'

import { useEffect, useState } from 'react'

import { BotLookup } from './BotLookup'
import { FaucetCard } from './Faucet'
import { SimulateStreamPanel, type StreamSim } from './SimulateStream'

/**
 * Floating action button (bottom-right) that opens a "Tools" modal. Groups the
 * dev/utility surfaces that don't belong in the always-on dashboard: the local
 * faucet, the stream simulator, and public bot discovery. Faucet and simulator
 * self-hide off the local chain, so on a real network the modal just shows
 * discovery. Keeping these here is what lets the dashboard fit the viewport
 * without scrolling.
 *
 * The simulator engine lives in the dashboard (`useStreamSimulator`), not here,
 * so it keeps running after the modal closes — we only render its controls.
 */
export function ToolsButton({ sim }: { sim: StreamSim }) {
	const [open, setOpen] = useState(false)

	// Close on Escape and lock body scroll while the modal is open.
	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [open])

	return (
		<>
			<button
				type="button"
				aria-label="Open tools"
				onClick={() => setOpen(true)}
				className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-zinc-950 shadow-lg shadow-emerald-500/30 transition-transform hover:scale-105 hover:bg-emerald-400"
			>
				<WrenchIcon />
			</button>

			{open ? (
				<div
					className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
					onClick={() => setOpen(false)}
				>
					{/* Stop propagation so clicks inside the panel don't close it. */}
					<div
						className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-zinc-950 p-5 ring-1 ring-zinc-800"
						onClick={e => e.stopPropagation()}
					>
						<div className="mb-4 flex items-center justify-between">
							<h2 className="text-lg font-semibold text-zinc-50">Tools</h2>
							<button
								type="button"
								aria-label="Close"
								onClick={() => setOpen(false)}
								className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 ring-1 ring-zinc-800 hover:text-zinc-100 hover:ring-zinc-600"
							>
								✕
							</button>
						</div>

						<div className="flex flex-col gap-4">
							<FaucetCard />
							<SimulateStreamPanel sim={sim} />
							<BotLookup />
						</div>
					</div>
				</div>
			) : null}
		</>
	)
}

function WrenchIcon() {
	return (
		<svg
			width="22"
			height="22"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.8-.7-.7-2.8 2.7-2.5z" />
		</svg>
	)
}
