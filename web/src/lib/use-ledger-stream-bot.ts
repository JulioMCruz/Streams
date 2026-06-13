'use client'

/**
 * Fase 4 — thin React hook over `lib/ledger-7702.ts`. ISOLATED: not wired into a
 * component yet (see the wiring guide in ledger-7702.ts). Typecheck-verified;
 * live run needs Chromium + WebHID + a Ledger.
 */
import { useCallback, useState } from 'react'
import type { Address, Hex } from 'viem'

import {
	connectLedger,
	type LedgerSession,
	startStreamBotWithLedger,
	type StreamBotRules,
} from './ledger-7702'

type Status = 'idle' | 'connecting' | 'connected' | 'signing' | 'done' | 'error'
type StartArgs = { budget: bigint; rate: bigint; rules: StreamBotRules }

export function useLedgerStreamBot() {
	const [session, setSession] = useState<LedgerSession | null>(null)
	const [status, setStatus] = useState<Status>('idle')
	const [txHash, setTxHash] = useState<Hex | null>(null)
	const [error, setError] = useState<string | null>(null)

	const connect = useCallback(async () => {
		setStatus('connecting')
		setError(null)
		try {
			const s = await connectLedger()
			setSession(s)
			setStatus('connected')
			return s
		} catch (e) {
			setStatus('error')
			setError(e instanceof Error ? e.message : String(e))
			throw e
		}
	}, [])

	const start = useCallback(
		async (args: StartArgs) => {
			if (!session) throw new Error('Connect the Ledger first')
			setStatus('signing')
			setError(null)
			try {
				const h = await startStreamBotWithLedger(session, args)
				setTxHash(h)
				setStatus('done')
				return h
			} catch (e) {
				setStatus('error')
				setError(e instanceof Error ? e.message : String(e))
				throw e
			}
		},
		[session],
	)

	const address: Address | null = session?.address ?? null
	return { connect, start, address, status, txHash, error }
}
