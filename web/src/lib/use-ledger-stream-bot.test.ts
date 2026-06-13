import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLedgerStreamBot } from './use-ledger-stream-bot'

const ADDRESS = '0xAA1aEf44DDE610F433f271C6A8749139DD5162E1' as const
const TX_HASH = `0x${'aa'.repeat(32)}` as const

const connectLedgerMock = vi.fn()
const startStreamBotMock = vi.fn()

vi.mock('./ledger-7702', () => ({
	connectLedger: () => connectLedgerMock(),
	startStreamBotWithLedger: (...args: unknown[]) => startStreamBotMock(...args),
}))

function defaultSession() {
	return { signerEth: { __mock: true }, address: ADDRESS }
}

beforeEach(() => {
	connectLedgerMock.mockReset()
	startStreamBotMock.mockReset()
	connectLedgerMock.mockImplementation(async () => defaultSession())
	startStreamBotMock.mockImplementation(async () => TX_HASH)
})

describe('useLedgerStreamBot() — initial state', () => {
	it('reports idle with no address, no hash, no error', () => {
		const { result } = renderHook(() => useLedgerStreamBot())
		expect(result.current.status).toBe('idle')
		expect(result.current.address).toBeNull()
		expect(result.current.txHash).toBeNull()
		expect(result.current.error).toBeNull()
	})
})

describe('useLedgerStreamBot().connect()', () => {
	it('transitions idle → connecting → connected and exposes the device address', async () => {
		let release: (s: ReturnType<typeof defaultSession>) => void = () => {}
		connectLedgerMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve as (s: ReturnType<typeof defaultSession>) => void
				}),
		)
		const { result } = renderHook(() => useLedgerStreamBot())

		let pending!: Promise<unknown>
		act(() => {
			pending = result.current.connect()
		})
		await waitFor(() => expect(result.current.status).toBe('connecting'))

		await act(async () => {
			release(defaultSession())
			await pending
		})

		expect(result.current.status).toBe('connected')
		expect(result.current.address).toBe(ADDRESS)
		expect(result.current.error).toBeNull()
	})

	it('transitions to error and records the message on DMK failure', async () => {
		connectLedgerMock.mockImplementationOnce(async () => {
			throw new Error('WebHID refused')
		})
		const { result } = renderHook(() => useLedgerStreamBot())

		let caught: unknown
		await act(async () => {
			try {
				await result.current.connect()
			} catch (e) {
				caught = e
			}
		})

		expect(caught).toBeInstanceOf(Error)
		expect(result.current.status).toBe('error')
		expect(result.current.error).toBe('WebHID refused')
		expect(result.current.address).toBeNull()
	})

	it('stringifies non-Error throws into error', async () => {
		connectLedgerMock.mockImplementationOnce(async () => {
			throw 'opaque'
		})
		const { result } = renderHook(() => useLedgerStreamBot())

		await act(async () => {
			try {
				await result.current.connect()
			} catch {}
		})

		expect(result.current.error).toBe('opaque')
	})
})

describe('useLedgerStreamBot().start()', () => {
	const args = {
		budget: 200_000_000n,
		rate: 33_333_333_333_333n,
		rules: {
			maxSlippageBps: 100,
			minTradeAmount: 1_000_000n,
			settlementAddress: ADDRESS,
			targetTokens: [],
		},
	}

	it('throws when called before connect()', async () => {
		const { result } = renderHook(() => useLedgerStreamBot())

		await expect(
			act(async () => {
				await result.current.start(args)
			}),
		).rejects.toThrow(/Connect the Ledger first/)

		expect(startStreamBotMock).not.toHaveBeenCalled()
	})

	it('drives signing → done and exposes the tx hash', async () => {
		const { result } = renderHook(() => useLedgerStreamBot())

		await act(async () => {
			await result.current.connect()
		})

		await act(async () => {
			await result.current.start(args)
		})

		expect(startStreamBotMock).toHaveBeenCalledOnce()
		const [, callArgs] = startStreamBotMock.mock.calls[0] as [unknown, typeof args]
		expect(callArgs).toEqual(args)
		expect(result.current.status).toBe('done')
		expect(result.current.txHash).toBe(TX_HASH)
		expect(result.current.error).toBeNull()
	})

	it('records the signing error and stays in error state', async () => {
		startStreamBotMock.mockImplementationOnce(async () => {
			throw new Error('user denied on device')
		})
		const { result } = renderHook(() => useLedgerStreamBot())

		await act(async () => {
			await result.current.connect()
		})

		let caught: unknown
		await act(async () => {
			try {
				await result.current.start(args)
			} catch (e) {
				caught = e
			}
		})

		expect(caught).toBeInstanceOf(Error)
		expect(result.current.status).toBe('error')
		expect(result.current.error).toBe('user denied on device')
		expect(result.current.txHash).toBeNull()
	})
})
