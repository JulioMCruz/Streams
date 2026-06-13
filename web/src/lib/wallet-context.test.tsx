import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWallet, WalletProvider } from './wallet-context'

const LEDGER_ADDRESS = '0xAA1aEf44DDE610F433f271C6A8749139DD5162E1' as const
const REOWN_ADDRESS = '0x35aa358E1eEcdAB3f450A2b120407b73bBc0d125' as const

// wagmi.useAccount is consumed by WalletProvider — control its return value
// per test so we can simulate "Reown connected" vs "nothing connected".
const useAccountMock = vi.fn(() => ({
	address: undefined as `0x${string}` | undefined,
	isConnected: false,
}))
vi.mock('wagmi', () => ({
	useAccount: () => useAccountMock(),
}))

// The dynamic `await import('@/lib/ledger-7702')` inside connectLedger() is
// mocked so the DMK/WebHID never runs in tests.
const ledgerConnectMock = vi.fn()
vi.mock('@/lib/ledger-7702', () => ({
	connectLedger: () => ledgerConnectMock(),
}))

function setReownConnected(connected: boolean) {
	useAccountMock.mockImplementation(() => ({
		address: connected ? REOWN_ADDRESS : undefined,
		isConnected: connected,
	}))
}

function defaultLedgerSession() {
	return {
		signerEth: { __mock: true } as unknown,
		address: LEDGER_ADDRESS,
	}
}

beforeEach(() => {
	useAccountMock.mockClear()
	ledgerConnectMock.mockReset()
	ledgerConnectMock.mockImplementation(async () => defaultLedgerSession())
	setReownConnected(false)
})

const wrapper = ({ children }: { children: ReactNode }) => (
	<WalletProvider>{children}</WalletProvider>
)

describe('useWallet()', () => {
	it('throws when used outside <WalletProvider>', () => {
		expect(() => renderHook(() => useWallet())).toThrowError(
			'useWallet must be used within <WalletProvider>',
		)
	})
})

describe('WalletProvider — default state', () => {
	it('reports mode=reown, no address, not connected when nothing is wired', () => {
		const { result } = renderHook(() => useWallet(), { wrapper })
		expect(result.current.mode).toBe('reown')
		expect(result.current.address).toBeUndefined()
		expect(result.current.isConnected).toBe(false)
		expect(result.current.ledgerSession).toBeNull()
		expect(result.current.ledgerConnecting).toBe(false)
		expect(result.current.ledgerError).toBeNull()
	})
})

describe('WalletProvider — Reown connected', () => {
	it('reflects wagmi state when Reown is the active wallet', () => {
		setReownConnected(true)
		const { result } = renderHook(() => useWallet(), { wrapper })
		expect(result.current.mode).toBe('reown')
		expect(result.current.address).toBe(REOWN_ADDRESS)
		expect(result.current.isConnected).toBe(true)
		expect(result.current.ledgerSession).toBeNull()
	})
})

describe('connectLedger() — happy path', () => {
	it('opens the DMK, stores the session and flips mode to "ledger"', async () => {
		const { result } = renderHook(() => useWallet(), { wrapper })

		await act(async () => {
			await result.current.connectLedger()
		})

		expect(ledgerConnectMock).toHaveBeenCalledTimes(1)
		expect(result.current.mode).toBe('ledger')
		expect(result.current.address).toBe(LEDGER_ADDRESS)
		expect(result.current.isConnected).toBe(true)
		expect(result.current.ledgerSession).not.toBeNull()
		expect(result.current.ledgerError).toBeNull()
	})

	it('toggles ledgerConnecting around the DMK call', async () => {
		let release: (s: ReturnType<typeof defaultLedgerSession>) => void = () => {}
		ledgerConnectMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve as (s: ReturnType<typeof defaultLedgerSession>) => void
				}),
		)

		const { result } = renderHook(() => useWallet(), { wrapper })

		let pending!: Promise<void>
		act(() => {
			pending = result.current.connectLedger()
		})
		await waitFor(() => expect(result.current.ledgerConnecting).toBe(true))

		await act(async () => {
			release(defaultLedgerSession())
			await pending
		})

		expect(result.current.ledgerConnecting).toBe(false)
		expect(result.current.mode).toBe('ledger')
	})
})

// Catching the throw INSIDE the act callback lets React commit the
// setLedgerError state update before unwinding. If the throw escapes act, the
// queued update is lost (test would see ledgerError === null forever).
async function actAndCatch(fn: () => Promise<unknown>) {
	let caught: unknown = null
	await act(async () => {
		try {
			await fn()
		} catch (e) {
			caught = e
		}
	})
	return caught
}

describe('connectLedger() — mutex (Reown already connected)', () => {
	it('refuses to open a Ledger session and surfaces a clear error', async () => {
		setReownConnected(true)
		const { result } = renderHook(() => useWallet(), { wrapper })

		const err = await actAndCatch(() => result.current.connectLedger())

		expect(err).toBeInstanceOf(Error)
		expect((err as Error).message).toMatch(
			/Disconnect your other wallet before connecting a Ledger/,
		)
		expect(ledgerConnectMock).not.toHaveBeenCalled()
		expect(result.current.ledgerSession).toBeNull()
		expect(result.current.mode).toBe('reown')
		expect(result.current.address).toBe(REOWN_ADDRESS)
		expect(result.current.ledgerError).toMatch(/Disconnect your other wallet/)
		expect(result.current.ledgerConnecting).toBe(false)
	})
})

describe('connectLedger() — DMK failure', () => {
	it('surfaces the device error, clears connecting, and rethrows', async () => {
		ledgerConnectMock.mockImplementationOnce(async () => {
			throw new Error('WebHID device refused')
		})
		const { result } = renderHook(() => useWallet(), { wrapper })

		const err = await actAndCatch(() => result.current.connectLedger())

		expect(err).toBeInstanceOf(Error)
		expect((err as Error).message).toBe('WebHID device refused')
		expect(result.current.ledgerError).toBe('WebHID device refused')
		expect(result.current.ledgerSession).toBeNull()
		expect(result.current.ledgerConnecting).toBe(false)
		expect(result.current.mode).toBe('reown')
	})

	it('stringifies non-Error throws into ledgerError', async () => {
		ledgerConnectMock.mockImplementationOnce(async () => {
			throw 'opaque failure'
		})
		const { result } = renderHook(() => useWallet(), { wrapper })

		const err = await actAndCatch(() => result.current.connectLedger())

		expect(err).toBe('opaque failure')
		expect(result.current.ledgerError).toBe('opaque failure')
	})
})

describe('disconnectLedger()', () => {
	it('clears the session and flips mode back to "reown"', async () => {
		const { result } = renderHook(() => useWallet(), { wrapper })

		await act(async () => {
			await result.current.connectLedger()
		})
		expect(result.current.mode).toBe('ledger')

		act(() => result.current.disconnectLedger())

		expect(result.current.ledgerSession).toBeNull()
		expect(result.current.mode).toBe('reown')
		expect(result.current.address).toBeUndefined()
		expect(result.current.isConnected).toBe(false)
	})
})

describe('WalletProvider — JSX surface', () => {
	function Probe() {
		const w = useWallet()
		return <div data-testid="probe">{w.mode}</div>
	}

	it('exposes the context value to children', () => {
		render(
			<WalletProvider>
				<Probe />
			</WalletProvider>,
		)
		expect(screen.getByTestId('probe').textContent).toBe('reown')
	})
})
