import { act, renderHook } from '@testing-library/react'
import { type Abi, encodeFunctionData } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDualWrite } from './use-dual-write'

const LEDGER_ADDRESS = '0xAA1aEf44DDE610F433f271C6A8749139DD5162E1' as const
const REOWN_ADDRESS = '0x35aa358E1eEcdAB3f450A2b120407b73bBc0d125' as const
const CONTRACT = '0xaC556c528A52E8E239a50AAe8cA03F0e6b2e6fcC' as const

const minimalAbi = [
	{
		type: 'function',
		name: 'setStream',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'sa', type: 'address' },
			{ name: 'st', type: 'address' },
			{ name: 'rate', type: 'int96' },
		],
		outputs: [],
	},
] as const satisfies Abi

// ── Mocks ─────────────────────────────────────────────────────────────────────
const writeContractAsyncMock = vi.fn()
const waitForReceiptMock = vi.fn()
const usePublicClientMock = vi.fn()
const useWalletMock = vi.fn()
const signAndSendTxMock = vi.fn()

vi.mock('wagmi', () => ({
	useWriteContract: () => ({ writeContractAsync: writeContractAsyncMock }),
	usePublicClient: () => usePublicClientMock(),
}))

vi.mock('@/lib/wallet-context', () => ({
	useWallet: () => useWalletMock(),
}))

vi.mock('@/lib/ledger-7702', () => ({
	signAndSendTx: (...args: unknown[]) => signAndSendTxMock(...args),
}))

function setMode(mode: 'reown' | 'ledger') {
	useWalletMock.mockReturnValue({
		mode,
		ledgerSession:
			mode === 'ledger'
				? { signerEth: {}, address: LEDGER_ADDRESS }
				: null,
		address: mode === 'ledger' ? LEDGER_ADDRESS : REOWN_ADDRESS,
		isConnected: true,
	})
}

beforeEach(() => {
	writeContractAsyncMock.mockReset()
	waitForReceiptMock.mockReset()
	signAndSendTxMock.mockReset()
	useWalletMock.mockReset()
	usePublicClientMock.mockReset()
	usePublicClientMock.mockReturnValue({
		waitForTransactionReceipt: waitForReceiptMock,
	})
	setMode('reown')
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('useDualWrite() — Reown mode', () => {
	it('routes to wagmi.writeContractAsync, waits for the receipt, and calls onSuccess', async () => {
		const hash = ('0x' + 'ab'.repeat(32)) as `0x${string}`
		writeContractAsyncMock.mockResolvedValueOnce(hash)
		waitForReceiptMock.mockResolvedValueOnce({ status: 'success' })
		const onSuccess = vi.fn()

		const { result } = renderHook(() => useDualWrite(onSuccess))

		let outcome: boolean | undefined
		await act(async () => {
			outcome = await result.current.write({
				address: CONTRACT,
				abi: minimalAbi,
				functionName: 'setStream',
				args: [LEDGER_ADDRESS, REOWN_ADDRESS, 0n],
			})
		})

		expect(outcome).toBe(true)
		expect(signAndSendTxMock).not.toHaveBeenCalled()
		expect(writeContractAsyncMock).toHaveBeenCalledTimes(1)
		expect(writeContractAsyncMock).toHaveBeenCalledWith(
			expect.objectContaining({
				address: CONTRACT,
				functionName: 'setStream',
				args: [LEDGER_ADDRESS, REOWN_ADDRESS, 0n],
			}),
		)
		expect(waitForReceiptMock).toHaveBeenCalledTimes(1)
		expect(waitForReceiptMock).toHaveBeenCalledWith({ hash })
		expect(onSuccess).toHaveBeenCalledOnce()
		expect(result.current.isPending).toBe(false)
		expect(result.current.error).toBeNull()
	})

	it('captures the wagmi error, returns false, and clears isPending', async () => {
		writeContractAsyncMock.mockRejectedValueOnce(new Error('user rejected'))
		const onSuccess = vi.fn()

		const { result } = renderHook(() => useDualWrite(onSuccess))

		let outcome: boolean | undefined
		await act(async () => {
			outcome = await result.current.write({
				address: CONTRACT,
				abi: minimalAbi,
				functionName: 'setStream',
				args: [LEDGER_ADDRESS, REOWN_ADDRESS, 0n],
			})
		})

		expect(outcome).toBe(false)
		expect(onSuccess).not.toHaveBeenCalled()
		expect(waitForReceiptMock).not.toHaveBeenCalled()
		expect(result.current.error).toBe('user rejected')
		expect(result.current.isPending).toBe(false)
	})
})

describe('useDualWrite() — Ledger mode', () => {
	it('encodes calldata, hands it to signAndSendTx, waits for the receipt, and calls onSuccess', async () => {
		setMode('ledger')
		const hash = ('0x' + 'cd'.repeat(32)) as `0x${string}`
		signAndSendTxMock.mockResolvedValueOnce(hash)
		waitForReceiptMock.mockResolvedValueOnce({ status: 'success' })
		const onSuccess = vi.fn()

		const { result } = renderHook(() => useDualWrite(onSuccess))

		const args = [LEDGER_ADDRESS, REOWN_ADDRESS, 1234n] as const
		let outcome: boolean | undefined
		await act(async () => {
			outcome = await result.current.write({
				address: CONTRACT,
				abi: minimalAbi,
				functionName: 'setStream',
				args,
			})
		})

		expect(outcome).toBe(true)
		expect(writeContractAsyncMock).not.toHaveBeenCalled()
		expect(signAndSendTxMock).toHaveBeenCalledOnce()
		const [session, tx] = signAndSendTxMock.mock.calls[0] as [
			{ address: `0x${string}` },
			{ to: `0x${string}`; data: `0x${string}`; value?: bigint },
		]
		expect(session.address).toBe(LEDGER_ADDRESS)
		expect(tx.to).toBe(CONTRACT)
		expect(tx.value).toBeUndefined()
		// The encoded calldata MUST equal what viem produces for the same call.
		expect(tx.data).toBe(
			encodeFunctionData({
				abi: minimalAbi,
				functionName: 'setStream',
				args,
			}),
		)
		expect(waitForReceiptMock).toHaveBeenCalledTimes(1)
		expect(waitForReceiptMock).toHaveBeenCalledWith({ hash })
		expect(onSuccess).toHaveBeenCalledOnce()
	})

	it('forwards value (msg.value) to signAndSendTx', async () => {
		setMode('ledger')
		signAndSendTxMock.mockResolvedValueOnce(
			('0x' + '11'.repeat(32)) as `0x${string}`,
		)
		waitForReceiptMock.mockResolvedValueOnce({ status: 'success' })

		const { result } = renderHook(() => useDualWrite())

		await act(async () => {
			await result.current.write({
				address: CONTRACT,
				abi: minimalAbi,
				functionName: 'setStream',
				args: [LEDGER_ADDRESS, REOWN_ADDRESS, 0n],
				value: 1_000n,
			})
		})

		const [, tx] = signAndSendTxMock.mock.calls[0] as [
			unknown,
			{ value?: bigint },
		]
		expect(tx.value).toBe(1_000n)
	})

	it('falls back to the Reown path when ledgerSession is missing (mode mismatch)', async () => {
		// Defensive: if useWallet ever returns mode='ledger' but ledgerSession=null
		// the routing must NOT crash the Ledger path. It falls through to wagmi.
		useWalletMock.mockReturnValue({
			mode: 'ledger',
			ledgerSession: null,
			address: LEDGER_ADDRESS,
			isConnected: true,
		})
		writeContractAsyncMock.mockResolvedValueOnce(
			('0x' + '22'.repeat(32)) as `0x${string}`,
		)
		waitForReceiptMock.mockResolvedValueOnce({ status: 'success' })

		const { result } = renderHook(() => useDualWrite())

		await act(async () => {
			await result.current.write({
				address: CONTRACT,
				abi: minimalAbi,
				functionName: 'setStream',
				args: [LEDGER_ADDRESS, REOWN_ADDRESS, 0n],
			})
		})

		expect(signAndSendTxMock).not.toHaveBeenCalled()
		expect(writeContractAsyncMock).toHaveBeenCalledOnce()
	})

	it('captures the Ledger error path', async () => {
		setMode('ledger')
		signAndSendTxMock.mockRejectedValueOnce(new Error('device unplugged'))

		const { result } = renderHook(() => useDualWrite())

		let outcome: boolean | undefined
		await act(async () => {
			outcome = await result.current.write({
				address: CONTRACT,
				abi: minimalAbi,
				functionName: 'setStream',
				args: [LEDGER_ADDRESS, REOWN_ADDRESS, 0n],
			})
		})

		expect(outcome).toBe(false)
		expect(waitForReceiptMock).not.toHaveBeenCalled()
		expect(result.current.error).toBe('device unplugged')
		expect(result.current.isPending).toBe(false)
	})

	it('stringifies non-Error throws into the error field', async () => {
		setMode('ledger')
		signAndSendTxMock.mockRejectedValueOnce({ code: -32000, msg: 'opaque' })

		const { result } = renderHook(() => useDualWrite())

		await act(async () => {
			await result.current.write({
				address: CONTRACT,
				abi: minimalAbi,
				functionName: 'setStream',
				args: [LEDGER_ADDRESS, REOWN_ADDRESS, 0n],
			})
		})

		expect(result.current.error).toMatch(/object Object|code/)
	})
})

describe('useDualWrite() — receipt wait', () => {
	it('still resolves true when there is no publicClient (e.g. SSR/before hydration)', async () => {
		// usePublicClient can return undefined in some edge cases. The hook should
		// skip waitForTransactionReceipt but still call onSuccess.
		usePublicClientMock.mockReturnValue(undefined)
		setMode('reown')
		writeContractAsyncMock.mockResolvedValueOnce(
			('0x' + '33'.repeat(32)) as `0x${string}`,
		)
		const onSuccess = vi.fn()

		const { result } = renderHook(() => useDualWrite(onSuccess))

		await act(async () => {
			await result.current.write({
				address: CONTRACT,
				abi: minimalAbi,
				functionName: 'setStream',
				args: [LEDGER_ADDRESS, REOWN_ADDRESS, 0n],
			})
		})

		expect(waitForReceiptMock).not.toHaveBeenCalled()
		expect(onSuccess).toHaveBeenCalledOnce()
	})
})
