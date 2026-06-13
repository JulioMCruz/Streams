'use client'

/**
 * Unified wallet state for the dual connect (Reown OR Ledger).
 *
 * - Reads (useReadContract) don't need the wallet — they use the wagmi transport,
 *   so they work the same in both modes; only the "connected address" and the
 *   WRITE path differ.
 * - Reown mode: reflects wagmi's `useAccount`; writes go through wagmi.
 * - Ledger mode: holds a DMK session (address + signer); writes are signed by the
 *   device (see lib/ledger-7702 + the per-action routing). The DMK is imported
 *   DYNAMICALLY so it never runs during SSR/build (browser-only, on connect).
 */
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from 'react'
import type { Address } from 'viem'
import { useAccount } from 'wagmi'

import type { LedgerSession } from '@/lib/ledger-7702'

export type WalletMode = 'reown' | 'ledger'

type WalletContextValue = {
	mode: WalletMode
	address: Address | undefined
	isConnected: boolean
	/** The DMK session, present only in Ledger mode (used to sign writes). */
	ledgerSession: LedgerSession | null
	ledgerConnecting: boolean
	ledgerError: string | null
	connectLedger: () => Promise<void>
	disconnectLedger: () => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
	const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount()
	const [ledgerSession, setLedgerSession] = useState<LedgerSession | null>(null)
	const [ledgerConnecting, setLedgerConnecting] = useState(false)
	const [ledgerError, setLedgerError] = useState<string | null>(null)

	// Strict mutex: only one wallet may be connected at a time. If wagmi already
	// holds a session, refuse — the caller must disconnect Reown first. Symmetric
	// guard for the other direction lives at the call site (button disabled when
	// `ledgerSession` is present), since the Reown modal is owned by AppKit.
	const connectLedger = useCallback(async () => {
		if (wagmiConnected) {
			const message =
				'Disconnect your other wallet before connecting a Ledger'
			setLedgerError(message)
			throw new Error(message)
		}
		setLedgerConnecting(true)
		setLedgerError(null)
		try {
			// Dynamic import → DMK/WebHID loads only in the browser, on demand.
			const { connectLedger: connect } = await import('@/lib/ledger-7702')
			setLedgerSession(await connect())
		} catch (e) {
			setLedgerError(e instanceof Error ? e.message : String(e))
			throw e
		} finally {
			setLedgerConnecting(false)
		}
	}, [wagmiConnected])

	const disconnectLedger = useCallback(() => setLedgerSession(null), [])

	const value = useMemo<WalletContextValue>(() => {
		const mode: WalletMode = ledgerSession ? 'ledger' : 'reown'
		return {
			mode,
			address: ledgerSession ? ledgerSession.address : wagmiAddress,
			isConnected: ledgerSession ? true : wagmiConnected,
			ledgerSession,
			ledgerConnecting,
			ledgerError,
			connectLedger,
			disconnectLedger,
		}
	}, [
		ledgerSession,
		wagmiAddress,
		wagmiConnected,
		ledgerConnecting,
		ledgerError,
		connectLedger,
		disconnectLedger,
	])

	return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
	const ctx = useContext(WalletContext)
	if (!ctx) throw new Error('useWallet must be used within <WalletProvider>')
	return ctx
}
