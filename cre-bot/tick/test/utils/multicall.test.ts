/**
 * Tests for utils/multicall.ts — multicallRead.
 *
 * Uses the CRE SDK test harness (EvmMock + addContractMock + newTestRuntime)
 * to intercept the callContract call against the Multicall3 address.
 *
 * Key: addContractMock intercepts callContract by address+selector and calls
 * encodeFunctionResult on the handler's return value. For the aggregate3 ABI
 * the handler must return a plain array of {success, returnData} objects where
 * returnData is a hex string (not Uint8Array), because viem's ABI encoder
 * expects `bytes` parameters as hex strings in the decoded form.
 *
 * Audit findings:
 * - Returns decoded results in the same order as the input calls array.
 * - Throws with the sub-call function name when success===false.
 * - A single failing sub-call aborts the entire batch (allowFailure=false).
 * - The Multicall3 address is the canonical constant (0xcA11…CA11).
 */

import { EVMClient } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { addContractMock, EvmMock, newTestRuntime } from '@chainlink/cre-sdk/test'
import { describe, expect } from 'bun:test'
import { encodeFunctionResult, getAddress } from 'viem'

import { ERC20_ABI, SMART_ACCOUNT_DCA_ABI } from '../../src/utils/abis'
import { MULTICALL3_ADDRESS, multicallRead } from '../../src/utils/multicall'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAIN_SELECTOR = 15971525489660198786n
const SA1 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const
const USER1 = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as const

const MULTICALL3_ABI = [
	{
		type: 'function',
		name: 'aggregate3',
		stateMutability: 'payable',
		inputs: [
			{
				name: 'calls',
				type: 'tuple[]',
				components: [
					{ name: 'target', type: 'address' },
					{ name: 'allowFailure', type: 'bool' },
					{ name: 'callData', type: 'bytes' },
				],
			},
		],
		outputs: [
			{
				name: 'returnData',
				type: 'tuple[]',
				components: [
					{ name: 'success', type: 'bool' },
					{ name: 'returnData', type: 'bytes' },
				],
			},
		],
	},
] as const

/**
 * Encode a sub-call result as a hex string.
 * addContractMock calls encodeFunctionResult on the aggregate3 handler return value,
 * so the inner returnData must be a hex string (viem expects bytes params as hex).
 */
function encodeSubCallHex<const TAbi extends readonly unknown[], TName extends string>(
	abi: TAbi,
	functionName: TName,
	result: unknown,
): `0x${string}` {
	return encodeFunctionResult({
		abi,
		functionName,
		result,
	} as Parameters<typeof encodeFunctionResult>[0]) as `0x${string}`
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('utils/multicall', () => {
	describe('multicallRead', () => {
		test('Should return decoded results in order for a successful batch', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const mc = addContractMock(evmMock, {
				address: MULTICALL3_ADDRESS,
				abi: MULTICALL3_ABI,
			})

			const ownerHex = encodeSubCallHex(SMART_ACCOUNT_DCA_ABI, 'owner', getAddress(USER1))
			const operatorHex = encodeSubCallHex(SMART_ACCOUNT_DCA_ABI, 'operator', getAddress(USER1))

			// aggregate3 is payable (not view/pure), so ContractMock's type doesn't include it.
			// Cast to access the dynamic handler slot.
			;(mc as Record<string, unknown>).aggregate3 = (_calls: unknown) => [
				{ success: true, returnData: ownerHex },
				{ success: true, returnData: operatorHex },
			]

			const evm = new EVMClient(CHAIN_SELECTOR)
			const results = multicallRead(runtime, evm, [
				{ target: SA1, abi: SMART_ACCOUNT_DCA_ABI, functionName: 'owner' },
				{ target: SA1, abi: SMART_ACCOUNT_DCA_ABI, functionName: 'operator' },
			])

			expect(results).toHaveLength(2)
			// Both return USER1
			expect((results[0] as string).toLowerCase()).toBe(USER1.toLowerCase())
			expect((results[1] as string).toLowerCase()).toBe(USER1.toLowerCase())
		})

		test('Should throw with the sub-call function name when success is false', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const mc = addContractMock(evmMock, {
				address: MULTICALL3_ADDRESS,
				abi: MULTICALL3_ABI,
			})

			const ownerHex = encodeSubCallHex(SMART_ACCOUNT_DCA_ABI, 'owner', getAddress(USER1))

			// aggregate3 is payable (not view/pure), so ContractMock's type doesn't include it.
			// Cast to access the dynamic handler slot.
			;(mc as Record<string, unknown>).aggregate3 = (_calls: unknown) => [
				{ success: true, returnData: ownerHex },
				{ success: false, returnData: '0x' }, // operator sub-call reverted
			]

			const evm = new EVMClient(CHAIN_SELECTOR)
			expect(() =>
				multicallRead(runtime, evm, [
					{ target: SA1, abi: SMART_ACCOUNT_DCA_ABI, functionName: 'owner' },
					{ target: SA1, abi: SMART_ACCOUNT_DCA_ABI, functionName: 'operator' },
				]),
			).toThrow(/operator.*reverted/)
		})

		test('Should throw when the first sub-call fails', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const mc = addContractMock(evmMock, {
				address: MULTICALL3_ADDRESS,
				abi: MULTICALL3_ABI,
			})

			// aggregate3 is payable (not view/pure), so ContractMock's type doesn't include it.
			// Cast to access the dynamic handler slot.
			;(mc as Record<string, unknown>).aggregate3 = (_calls: unknown) => [
				{ success: false, returnData: '0x' },
			]

			const evm = new EVMClient(CHAIN_SELECTOR)
			expect(() =>
				multicallRead(runtime, evm, [
					{ target: SA1, abi: SMART_ACCOUNT_DCA_ABI, functionName: 'owner' },
				]),
			).toThrow(/owner.*reverted/)
		})

		test('Should return a single-element array for a single call', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const mc = addContractMock(evmMock, {
				address: MULTICALL3_ADDRESS,
				abi: MULTICALL3_ABI,
			})

			const ownerHex = encodeSubCallHex(SMART_ACCOUNT_DCA_ABI, 'owner', getAddress(USER1))

			// aggregate3 is payable (not view/pure), so ContractMock's type doesn't include it.
			// Cast to access the dynamic handler slot.
			;(mc as Record<string, unknown>).aggregate3 = (_calls: unknown) => [
				{ success: true, returnData: ownerHex },
			]

			const evm = new EVMClient(CHAIN_SELECTOR)
			const results = multicallRead(runtime, evm, [
				{ target: SA1, abi: SMART_ACCOUNT_DCA_ABI, functionName: 'owner' },
			])

			expect(results).toHaveLength(1)
			expect((results[0] as string).toLowerCase()).toBe(USER1.toLowerCase())
		})

		test('Should decode calls with args correctly (e.g. balanceOf)', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const mc = addContractMock(evmMock, {
				address: MULTICALL3_ADDRESS,
				abi: MULTICALL3_ABI,
			})

			const balanceHex = encodeSubCallHex(ERC20_ABI, 'balanceOf', 42_000_000n)

			// aggregate3 is payable (not view/pure), so ContractMock's type doesn't include it.
			// Cast to access the dynamic handler slot.
			;(mc as Record<string, unknown>).aggregate3 = (_calls: unknown) => [
				{ success: true, returnData: balanceHex },
			]

			const evm = new EVMClient(CHAIN_SELECTOR)
			const results = multicallRead(runtime, evm, [
				{ target: SA1, abi: ERC20_ABI, functionName: 'balanceOf', args: [USER1] },
			])

			expect(results[0]).toBe(42_000_000n)
		})

		test('Should verify MULTICALL3_ADDRESS constant is the canonical address', () => {
			// The canonical Multicall3 address — must never change.
			expect(MULTICALL3_ADDRESS.toLowerCase()).toBe('0xca11bde05977b3631167028862be2a173976ca11')
		})
	})
})
