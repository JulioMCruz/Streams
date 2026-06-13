import { Observable } from 'rxjs'
import { decodeFunctionData } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const DEVICE_ADDRESS = '0xAA1aEf44DDE610F433f271C6A8749139DD5162E1' as const
const SIMPLE_7702_ACCOUNT =
	'0x4Cd241E8d1510e30b2076397afc7508Ae59C66c9' as const
const STREAM_VAULTS = '0xaC556c528A52E8E239a50AAe8cA03F0e6b2e6fcC' as const
const CFA_FORWARDER = '0xcfA132E353cB4E398080B9700609bb008eceB125' as const
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const USDCX = '0xD04383398dD2426297da660F9CCA3d439AF9ce1b' as const
const CHAIN_ID = 8453
const DERIVATION = "44'/60'/0'/0/0"

// Predictable signature outputs from the device.
const SIG_R = `0x${'11'.repeat(32)}` as const
const SIG_S = `0x${'22'.repeat(32)}` as const

// ── Hoisted DMK mocks ─────────────────────────────────────────────────────────
const getAddressMock = vi.fn()
const signDelegationMock = vi.fn()
const signTransactionMock = vi.fn()
const dmkConnectMock = vi.fn(async () => 'session-1')
const startDiscoveringMock = vi.fn(
	() => new Observable<{ id: string }>((sub) => {
		sub.next({ id: 'webhid:1' })
		sub.complete()
	}),
)

vi.mock('@ledgerhq/device-management-kit', () => {
	const DeviceActionStatus = {
		Completed: 'COMPLETED',
		Error: 'ERROR',
	}
	class DeviceManagementKitBuilder {
		addTransport() {
			return this
		}
		build() {
			return {
				startDiscovering: startDiscoveringMock,
				connect: dmkConnectMock,
			}
		}
	}
	return { DeviceManagementKitBuilder, DeviceActionStatus }
})

vi.mock('@ledgerhq/device-signer-kit-ethereum', () => {
	class SignerEthBuilder {
		build() {
			return {
				getAddress: getAddressMock,
				signDelegationAuthorization: signDelegationMock,
				signTransaction: signTransactionMock,
			}
		}
	}
	return { SignerEthBuilder }
})

vi.mock('@ledgerhq/device-transport-kit-web-hid', () => ({
	webHidIdentifier: 'webhid',
	webHidTransportFactory: () => ({}),
}))

// ── Hoisted viem mocks ────────────────────────────────────────────────────────
const getTransactionCountMock = vi.fn()
const estimateFeesPerGasMock = vi.fn()
const estimateGasMock = vi.fn()
const sendRawTransactionMock = vi.fn()
const readContractMock = vi.fn()

vi.mock('viem', async () => {
	const actual = await vi.importActual<typeof import('viem')>('viem')
	return {
		...actual,
		createPublicClient: () => ({
			getTransactionCount: getTransactionCountMock,
			estimateFeesPerGas: estimateFeesPerGasMock,
			estimateGas: estimateGasMock,
			sendRawTransaction: sendRawTransactionMock,
			readContract: readContractMock,
		}),
	}
})

// recoverAuthorizationAddress lives at viem/utils; mock it so the dry-run is
// deterministic regardless of the synthetic r/s/v we feed in.
const recoverAuthMock = vi.fn()
vi.mock('viem/utils', async () => {
	const actual = await vi.importActual<typeof import('viem/utils')>('viem/utils')
	return {
		...actual,
		recoverAuthorizationAddress: (...args: unknown[]) =>
			recoverAuthMock(...args),
	}
})

// Helper to make a DMK device-action observable that completes with `output`.
function actionOf<T>(output: T) {
	return {
		observable: new Observable<{
			status: 'COMPLETED' | 'ERROR'
			output?: T
			error?: unknown
		}>((sub) => {
			sub.next({ status: 'COMPLETED', output })
			sub.complete()
		}),
	}
}

// Helper to make a DMK device-action observable that errors.
function actionThatErrors(err: unknown) {
	return {
		observable: new Observable<{
			status: 'COMPLETED' | 'ERROR'
			error?: unknown
		}>((sub) => {
			sub.next({ status: 'ERROR', error: err })
			sub.complete()
		}),
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	getAddressMock.mockReturnValue(actionOf({ address: DEVICE_ADDRESS }))
	signDelegationMock.mockReturnValue(actionOf({ r: SIG_R, s: SIG_S, v: 27 }))
	signTransactionMock.mockReturnValue(actionOf({ r: SIG_R, s: SIG_S, v: 27 }))
	dmkConnectMock.mockResolvedValue('session-1')
	startDiscoveringMock.mockReturnValue(
		new Observable<{ id: string }>((sub) => {
			sub.next({ id: 'webhid:1' })
			sub.complete()
		}),
	)
	getTransactionCountMock.mockResolvedValue(5)
	estimateFeesPerGasMock.mockResolvedValue({
		maxFeePerGas: 2_000_000_000n,
		maxPriorityFeePerGas: 1_000_000_000n,
	})
	estimateGasMock.mockResolvedValue(500_000n)
	sendRawTransactionMock.mockResolvedValue(`0x${'ff'.repeat(32)}`)
	recoverAuthMock.mockResolvedValue(DEVICE_ADDRESS)
})

// ── connectLedger() ───────────────────────────────────────────────────────────
describe('connectLedger()', () => {
	it('builds a DMK session and returns the device address', async () => {
		const { connectLedger } = await import('./ledger-7702')

		const session = await connectLedger()

		expect(startDiscoveringMock).toHaveBeenCalledOnce()
		expect(dmkConnectMock).toHaveBeenCalledOnce()
		expect(getAddressMock).toHaveBeenCalledOnce()
		expect(getAddressMock).toHaveBeenCalledWith(DERIVATION)
		expect(session.address).toBe(DEVICE_ADDRESS)
		expect(session.signerEth).toBeDefined()
	})

	it('rejects when getAddress emits an Error state', async () => {
		getAddressMock.mockReturnValue(
			actionThatErrors(new Error('user denied')),
		)
		const { connectLedger } = await import('./ledger-7702')
		await expect(connectLedger()).rejects.toThrow('user denied')
	})
})

// ── signDelegationDryRun() ────────────────────────────────────────────────────
describe('signDelegationDryRun()', () => {
	it('signs the 7702 delegation and verifies the signature recovers to the device', async () => {
		const { signDelegationDryRun } = await import('./ledger-7702')

		const out = await signDelegationDryRun()

		expect(out.address).toBe(DEVICE_ADDRESS)
		expect(out.nonce).toBe(5)
		expect(out.r).toBe(SIG_R)
		expect(out.s).toBe(SIG_S)
		expect(out.v).toBe(27)
		expect(out.recovered).toBe(DEVICE_ADDRESS)
		expect(out.ok).toBe(true)

		// The Ledger app whitelists exactly Simple7702Account: the delegation
		// MUST be requested against that address and the current chainId.
		expect(signDelegationMock).toHaveBeenCalledOnce()
		expect(signDelegationMock).toHaveBeenCalledWith(
			DERIVATION,
			CHAIN_ID,
			SIMPLE_7702_ACCOUNT,
			5,
		)
	})

	it('reports ok=false when recovery does not match the device address', async () => {
		recoverAuthMock.mockResolvedValueOnce(
			'0xDEADbeEf00000000000000000000000000000000',
		)
		const { signDelegationDryRun } = await import('./ledger-7702')
		const out = await signDelegationDryRun()
		expect(out.ok).toBe(false)
	})

	it('uses a custom rpcUrl when provided (lets a test point at a local fork)', async () => {
		const { signDelegationDryRun } = await import('./ledger-7702')
		await signDelegationDryRun('http://127.0.0.1:8546')
		// We rely on the createPublicClient mock having captured the calls; the
		// nonce read still resolves through the same mock, which is enough to
		// prove the helper accepted the override without throwing.
		expect(getTransactionCountMock).toHaveBeenCalledWith({
			address: DEVICE_ADDRESS,
		})
	})
})

// ── startStreamBotWithLedger() ────────────────────────────────────────────────
describe('startStreamBotWithLedger()', () => {
	const args = {
		budget: 200_000_000n,
		rate: 33_333_333_333_333n,
		rules: {
			maxSlippageBps: 100,
			minTradeAmount: 1_000_000n,
			settlementAddress: DEVICE_ADDRESS,
			targetTokens: [
				'0x4200000000000000000000000000000000000006' as const, // WETH
			],
		},
	}

	it('signs the auth with txNonce+1 and the tx with txNonce, then broadcasts', async () => {
		getTransactionCountMock.mockResolvedValueOnce(7) // txNonce
		const { startStreamBotWithLedger } = await import('./ledger-7702')

		const session = {
			signerEth: {
				getAddress: getAddressMock,
				signDelegationAuthorization: signDelegationMock,
				signTransaction: signTransactionMock,
			},
			address: DEVICE_ADDRESS,
		} as never

		const hash = await startStreamBotWithLedger(session, args)

		expect(hash).toBe(`0x${'ff'.repeat(32)}`)

		// authNonce MUST be txNonce + 1 (well-known self-sponsor rule).
		expect(signDelegationMock).toHaveBeenCalledOnce()
		expect(signDelegationMock).toHaveBeenCalledWith(
			DERIVATION,
			CHAIN_ID,
			SIMPLE_7702_ACCOUNT,
			8,
		)
		expect(signTransactionMock).toHaveBeenCalledOnce()
		expect(sendRawTransactionMock).toHaveBeenCalledOnce()
	})

	it('encodes executeBatch with [grantPermissions, approve, startStreamBot] in that order', async () => {
		getTransactionCountMock.mockResolvedValueOnce(7)

		// Capture the unsigned tx bytes that go to the device.
		signTransactionMock.mockImplementation((_path: string, bytes: Uint8Array) => {
			capturedTxBytes = bytes
			return actionOf({ r: SIG_R, s: SIG_S, v: 27 })
		})
		let capturedTxBytes: Uint8Array | undefined

		const { startStreamBotWithLedger } = await import('./ledger-7702')
		const session = {
			signerEth: {
				getAddress: getAddressMock,
				signDelegationAuthorization: signDelegationMock,
				signTransaction: signTransactionMock,
			},
			address: DEVICE_ADDRESS,
		} as never

		await startStreamBotWithLedger(session, args)

		expect(capturedTxBytes).toBeDefined()

		// Re-parse the serialized tx to inspect calldata.
		const { parseTransaction } = await import('viem')
		const parsed = parseTransaction(
			`0x${Buffer.from(capturedTxBytes!).toString('hex')}` as `0x${string}`,
		)
		expect(parsed.type).toBe('eip7702')
		expect(parsed.to?.toLowerCase()).toBe(DEVICE_ADDRESS.toLowerCase())
		expect(parsed.chainId).toBe(CHAIN_ID)
		expect(parsed.nonce).toBe(7)
		expect(parsed.authorizationList).toHaveLength(1)
		expect(parsed.authorizationList?.[0].address.toLowerCase()).toBe(
			SIMPLE_7702_ACCOUNT.toLowerCase(),
		)
		expect(parsed.authorizationList?.[0].nonce).toBe(8)

		// Decode the outer executeBatch and verify each inner call.
		const ACCOUNT_ABI = [
			{
				type: 'function',
				name: 'executeBatch',
				stateMutability: 'payable',
				inputs: [
					{
						name: 'calls',
						type: 'tuple[]',
						components: [
							{ name: 'target', type: 'address' },
							{ name: 'value', type: 'uint256' },
							{ name: 'data', type: 'bytes' },
						],
					},
				],
				outputs: [],
			},
		] as const
		const decoded = decodeFunctionData({
			abi: ACCOUNT_ABI,
			data: parsed.data!,
		})
		expect(decoded.functionName).toBe('executeBatch')
		const calls = decoded.args[0] as readonly {
			target: string
			value: bigint
			data: `0x${string}`
		}[]
		expect(calls).toHaveLength(3)
		expect(calls[0].target.toLowerCase()).toBe(CFA_FORWARDER.toLowerCase())
		expect(calls[1].target.toLowerCase()).toBe(USDC.toLowerCase())
		expect(calls[2].target.toLowerCase()).toBe(STREAM_VAULTS.toLowerCase())

		// Decode each inner call to verify the function selectors + args.
		const grantPerm = decodeFunctionData({
			abi: [
				{
					type: 'function',
					name: 'grantPermissions',
					stateMutability: 'nonpayable',
					inputs: [
						{ name: 'token', type: 'address' },
						{ name: 'flowOperator', type: 'address' },
					],
					outputs: [{ type: 'bool' }],
				},
			] as const,
			data: calls[0].data,
		})
		expect(grantPerm.functionName).toBe('grantPermissions')
		expect(grantPerm.args).toEqual([USDCX, STREAM_VAULTS])

		const approve = decodeFunctionData({
			abi: [
				{
					type: 'function',
					name: 'approve',
					stateMutability: 'nonpayable',
					inputs: [
						{ name: 'spender', type: 'address' },
						{ name: 'amount', type: 'uint256' },
					],
					outputs: [{ type: 'bool' }],
				},
			] as const,
			data: calls[1].data,
		})
		expect(approve.functionName).toBe('approve')
		expect(approve.args).toEqual([STREAM_VAULTS, args.budget])
	})
})

// ── signAndSendTx() ───────────────────────────────────────────────────────────
describe('signAndSendTx()', () => {
	it('builds a type-2 tx with nonce + fees + gas, has the device sign it, and broadcasts', async () => {
		const { signAndSendTx } = await import('./ledger-7702')

		const session = {
			signerEth: {
				getAddress: getAddressMock,
				signDelegationAuthorization: signDelegationMock,
				signTransaction: signTransactionMock,
			},
			address: DEVICE_ADDRESS,
		} as never

		const tx = {
			to: STREAM_VAULTS,
			data: '0xdeadbeef' as `0x${string}`,
		}
		const hash = await signAndSendTx(session, tx)

		expect(hash).toBe(`0x${'ff'.repeat(32)}`)
		expect(getTransactionCountMock).toHaveBeenCalledOnce()
		expect(estimateFeesPerGasMock).toHaveBeenCalledOnce()
		expect(estimateGasMock).toHaveBeenCalledOnce()
		expect(signTransactionMock).toHaveBeenCalledOnce()
		expect(sendRawTransactionMock).toHaveBeenCalledOnce()
	})

	it('falls back to a fixed 600_000 gas limit when estimateGas throws', async () => {
		estimateGasMock.mockRejectedValueOnce(new Error('cannot estimate'))

		// Capture the unsigned bytes to verify the gas field.
		let capturedTxBytes: Uint8Array | undefined
		signTransactionMock.mockImplementationOnce((_p: string, bytes: Uint8Array) => {
			capturedTxBytes = bytes
			return actionOf({ r: SIG_R, s: SIG_S, v: 27 })
		})

		const { signAndSendTx } = await import('./ledger-7702')
		const session = {
			signerEth: {
				getAddress: getAddressMock,
				signDelegationAuthorization: signDelegationMock,
				signTransaction: signTransactionMock,
			},
			address: DEVICE_ADDRESS,
		} as never

		await signAndSendTx(session, {
			to: STREAM_VAULTS,
			data: '0xabcdef' as `0x${string}`,
		})

		const { parseTransaction } = await import('viem')
		const parsed = parseTransaction(
			`0x${Buffer.from(capturedTxBytes!).toString('hex')}` as `0x${string}`,
		)
		expect(parsed.type).toBe('eip1559')
		expect(parsed.gas).toBe(600_000n)
	})

	it('forwards a non-zero value when provided', async () => {
		let capturedTxBytes: Uint8Array | undefined
		signTransactionMock.mockImplementationOnce((_p: string, bytes: Uint8Array) => {
			capturedTxBytes = bytes
			return actionOf({ r: SIG_R, s: SIG_S, v: 27 })
		})

		const { signAndSendTx } = await import('./ledger-7702')
		await signAndSendTx(
			{
				signerEth: {
					getAddress: getAddressMock,
					signDelegationAuthorization: signDelegationMock,
					signTransaction: signTransactionMock,
				},
				address: DEVICE_ADDRESS,
			} as never,
			{
				to: STREAM_VAULTS,
				data: '0x' as `0x${string}`,
				value: 12_345n,
			},
		)

		const { parseTransaction } = await import('viem')
		const parsed = parseTransaction(
			`0x${Buffer.from(capturedTxBytes!).toString('hex')}` as `0x${string}`,
		)
		expect(parsed.value).toBe(12_345n)
	})
})

// ── readOnboardingResult() ────────────────────────────────────────────────────
describe('readOnboardingResult()', () => {
	it('reads smartAccountOf and getFlowrate via the public client', async () => {
		const sa = '0x0000000000000000000000000000000000000baD' as const
		readContractMock.mockResolvedValueOnce(sa)
		readContractMock.mockResolvedValueOnce(33_333_333_333_333n)

		const { readOnboardingResult } = await import('./ledger-7702')
		const out = await readOnboardingResult(DEVICE_ADDRESS)

		expect(out.smartAccount.toLowerCase()).toBe(sa.toLowerCase())
		expect(out.flowrate).toBe(33_333_333_333_333n)
		expect(readContractMock).toHaveBeenCalledTimes(2)
		const calls = readContractMock.mock.calls as Array<
			[
				{
					address: `0x${string}`
					functionName: string
					args: readonly unknown[]
				},
			]
		>
		expect(calls[0][0].functionName).toBe('smartAccountOf')
		expect(calls[0][0].address.toLowerCase()).toBe(STREAM_VAULTS.toLowerCase())
		expect(calls[1][0].functionName).toBe('getFlowrate')
		expect(calls[1][0].address.toLowerCase()).toBe(CFA_FORWARDER.toLowerCase())
		expect(calls[1][0].args).toEqual([USDCX, DEVICE_ADDRESS, sa])
	})
})
