'use client'

import { useEffect, useRef, useState } from 'react'
import { type Address, formatUnits } from 'viem'
import { useChainId } from 'wagmi'

import { simulateStreamTick, STREAM_TICK_USDCX } from '@/lib/simulate'
import { LOCAL_CHAIN_ID } from '@/lib/wagmi'

import { Card } from './Card'
import { TxButton } from './TxButton'

const INTERVAL_MS = 30_000

export type StreamSim = {
	active: boolean
	toggle: () => void
	ticks: number
	note: string | null
	isLocal: boolean
}

/**
 * Stream-simulation **engine**, as a hook. Keep this mounted at the dashboard
 * level (not inside the Tools modal) so the simulation keeps running even when
 * the modal — where the controls live — is closed. Off the local chain it's a
 * no-op. The mock CFA never moves funds, so each tick pushes USDCx from the
 * wallet into the smart account, which the bot then swaps and settles.
 */
export function useStreamSimulator(
	userAddress: Address,
	smartAccount: Address
): StreamSim {
	const chainId = useChainId()
	const isLocal = chainId === LOCAL_CHAIN_ID
	const [active, setActive] = useState(false)
	const [ticks, setTicks] = useState(0)
	const [note, setNote] = useState<string | null>(null)
	const running = useRef(false)

	useEffect(() => {
		if (!active || !isLocal) return
		const tick = async () => {
			if (running.current) return
			running.current = true
			try {
				const streamed = await simulateStreamTick(userAddress, smartAccount)
				if (streamed === 0n) {
					setNote(
						'Your wallet USDCx is empty — wrap USDC → USDCx to keep streaming.'
					)
				} else {
					setTicks(t => t + 1)
					setNote(null)
				}
			} catch (err) {
				setNote(err instanceof Error ? err.message : String(err))
			} finally {
				running.current = false
			}
		}
		void tick() // fire one immediately, then every interval
		const id = setInterval(() => void tick(), INTERVAL_MS)
		return () => clearInterval(id)
	}, [active, isLocal, userAddress, smartAccount])

	return { active, toggle: () => setActive(a => !a), ticks, note, isLocal }
}

/**
 * Controls for the simulator, rendered inside the Tools modal. The engine runs
 * elsewhere (see `useStreamSimulator`), so toggling here keeps streaming after
 * the modal closes. Renders nothing off the local chain.
 */
export function SimulateStreamPanel({ sim }: { sim: StreamSim }) {
	if (!sim.isLocal) return null

	return (
		<Card
			title="Simulate stream (local)"
			subtitle="The local mock CFA doesn't move funds over time. This moves USDCx from your wallet into the smart account every 30s — your wallet USDCx drains and the bot swaps it into WBTC, just like a real stream. Keeps running after you close this."
			tone={sim.active ? 'success' : 'active'}
		>
			<div className="flex flex-wrap items-center gap-3">
				<TxButton
					tone={sim.active ? 'danger' : 'primary'}
					onClick={sim.toggle}
				>
					{sim.active ? 'Stop simulation' : 'Simulate stream'}
				</TxButton>
				<span className="text-xs text-zinc-400">
					{sim.active
						? `Streaming ${formatUnits(STREAM_TICK_USDCX, 18)} USDCx every 30s · ${sim.ticks} tick(s) sent`
						: 'Off'}
				</span>
			</div>
			{sim.note ? (
				<p className="mt-2 break-words text-xs text-amber-400">{sim.note}</p>
			) : null}
		</Card>
	)
}
