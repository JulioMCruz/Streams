/**
 * Tests for adapters/cre-chain-state.ts — CreChainState.
 *
 * Uses the CRE SDK test harness (EvmMock + addContractMock + newTestRuntime).
 * The four SmartAccountDCA reads are batched via Multicall3; we mock the
 * Multicall3 address to intercept aggregate3 calls.
 *
 * Key mock patterns used here:
 * - headerByNumber: return { header: { blockNumber: bigintToProtoBigInt(n) } }
 *   bigintToProtoBigInt converts a JS bigint to the proto JSON representation
 *   ({ absVal: base64, sign: string }) that fromJson(HeaderByNumberReplySchema)
 *   can deserialise.
 * - addContractMock (callContract): handler must return the JS-decoded value;
 *   addContractMock calls encodeFunctionResult on it internally. For bytes params
 *   in tuples (aggregate3 returnData) use hex strings, not Uint8Array.
 *
 * Audit findings:
 * - getBlockNumber returns 0n when reply.header is absent (defensive fallback).
 * - readSmartAccountState delegates to multicallRead which throws if any
 *   sub-call's success===false — covered in multicall tests.
 * - readErc20Balance / readStreamHealth decode the callContract reply correctly.
 */

import { bigintToProtoBigInt, EVMClient } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { addContractMock, EvmMock, newTestRuntime } from '@chainlink/cre-sdk/test'
import { describe, expect } from 'bun:test'
import { encodeFunctionResult, getAddress } from 'viem'

import { CreChainState } from '../../src/adapters/cre-chain-state'
import type { WorkflowConfig } from '../../src/settings/config'
import { ERC20_ABI, SMART_ACCOUNT_DCA_ABI, SUPER_TOKEN_ABI } from '../../src/utils/abis'
import { MULTICALL3_ADDRESS } from '../../src/utils/multicall'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAIN_SELECTOR = 15971525489660198786n
const STREAM_VAULTS = '0x1111111111111111111111111111111111111111' as const
const SA1 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const
const USER1 = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as const
const SUPER_TOKEN = '0x3333333333333333333333333333333333333333' as const
const TOKEN_IN = '0x4444444444444444444444444444444444444444' as const
const WETH = '0x4200000000000000000000000000000000000006' as const

function makeConfig(): WorkflowConfig {
	return {
		chainSelector: CHAIN_SELECTOR,
		chainId: 8453,
		discoveryFromBlock: 0n,
		uniswapApiBase: 'https://api.example.com',
		addresses: {
			streamVaults: STREAM_VAULTS,
			streamVaultsConfig: '0x2222222222222222222222222222222222222222',
		},
		strategy: {
			superTokenIn: SUPER_TOKEN,
			tokenIn: TOKEN_IN,
			superToUnderlyingDivisor: 10n ** 12n,
		},
	}
}

/**
 * Encode a sub-call result as a hex string for use inside aggregate3 returnData.
 * addContractMock calls encodeFunctionResult on the handler's return value, so
 * bytes params must be hex strings (not Uint8Array).
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CreChainState', () => {
	describe('getBlockNumber', () => {
		test('Should return the block number from the header reply', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			// headerByNumber returns a proto BigInt — use bigintToProtoBigInt to
			// produce the correct JSON form ({ absVal: base64, sign: string }).
			evmMock.headerByNumber = () => ({
				header: {
					blockNumber: bigintToProtoBigInt(1000n),
				},
			})

			const evm = new EVMClient(CHAIN_SELECTOR)
			const chain = new CreChainState(runtime, evm, makeConfig())

			const block = await chain.getBlockNumber()
			expect(block).toBe(1000n)
		})

		test('Should return 0n when the header is absent in the reply', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			// Simulate a malformed reply with no header
			evmMock.headerByNumber = () => ({})

			const evm = new EVMClient(CHAIN_SELECTOR)
			const chain = new CreChainState(runtime, evm, makeConfig())

			const block = await chain.getBlockNumber()
			expect(block).toBe(0n)
		})
	})

	describe('readErc20Balance', () => {
		test('Should return the token balance decoded from callContract', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const contractMock = addContractMock(evmMock, {
				address: SUPER_TOKEN,
				abi: ERC20_ABI,
			})
			contractMock.balanceOf = (_account: unknown) => 5_000_000_000_000_000_000n

			const evm = new EVMClient(CHAIN_SELECTOR)
			const chain = new CreChainState(runtime, evm, makeConfig())

			const balance = await chain.readErc20Balance(SUPER_TOKEN, SA1)
			expect(balance).toBe(5_000_000_000_000_000_000n)
		})

		test('Should pass the holder address to balanceOf', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			let capturedAccount: string | null = null
			const contractMock = addContractMock(evmMock, {
				address: SUPER_TOKEN,
				abi: ERC20_ABI,
			})
			contractMock.balanceOf = (account: unknown) => {
				capturedAccount = account as string
				return 0n
			}

			const evm = new EVMClient(CHAIN_SELECTOR)
			const chain = new CreChainState(runtime, evm, makeConfig())

			await chain.readErc20Balance(SUPER_TOKEN, SA1)
			expect((capturedAccount as unknown as string).toLowerCase()).toBe(SA1.toLowerCase())
		})
	})

	describe('readStreamHealth', () => {
		test('Should return availableBalance and deposit from realtimeBalanceOfNow', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const contractMock = addContractMock(evmMock, {
				address: SUPER_TOKEN,
				abi: SUPER_TOKEN_ABI,
			})
			// realtimeBalanceOfNow returns [availableBalance, deposit, owedDeposit, timestamp]
			contractMock.realtimeBalanceOfNow = (_account: unknown) => [12345678n, 10_000n, 0n, 0n] as const

			const evm = new EVMClient(CHAIN_SELECTOR)
			const chain = new CreChainState(runtime, evm, makeConfig())

			const health = await chain.readStreamHealth(SUPER_TOKEN, USER1)
			expect(health.availableBalance).toBe(12345678n)
			expect(health.deposit).toBe(10_000n)
		})
	})

	describe('readSmartAccountState', () => {
		test('Should batch-read all four SmartAccountDCA fields via Multicall3', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)

			// Build the inner encoded results for [owner, operator, rules, targetTokens]
			// returnData must be hex strings — addContractMock calls encodeFunctionResult
			// on aggregate3's return value, which encodes bytes params from hex strings.
			const ownerHex = encodeSubCallHex(SMART_ACCOUNT_DCA_ABI, 'owner', getAddress(USER1))
			const operatorHex = encodeSubCallHex(SMART_ACCOUNT_DCA_ABI, 'operator', getAddress(USER1))
			const rulesHex = encodeSubCallHex(SMART_ACCOUNT_DCA_ABI, 'rules', [
				100,
				1_000_000n,
				getAddress(USER1),
			])
			const targetsHex = encodeSubCallHex(SMART_ACCOUNT_DCA_ABI, 'targetTokens', [getAddress(WETH)])

			const multicallMock = addContractMock(evmMock, {
				address: MULTICALL3_ADDRESS,
				abi: MULTICALL3_ABI,
			})
			// aggregate3 is payable (not view/pure), so ContractMock's type doesn't include it.
			// Cast to access the dynamic handler slot.
			;(multicallMock as Record<string, unknown>).aggregate3 = (_calls: unknown) => [
				{ success: true, returnData: ownerHex },
				{ success: true, returnData: operatorHex },
				{ success: true, returnData: rulesHex },
				{ success: true, returnData: targetsHex },
			]

			const evm = new EVMClient(CHAIN_SELECTOR)
			const chain = new CreChainState(runtime, evm, makeConfig())

			const state = await chain.readSmartAccountState(SA1)
			expect(state.smartAccount).toBe(SA1)
			expect(state.owner.toLowerCase()).toBe(USER1.toLowerCase())
			expect(state.operator.toLowerCase()).toBe(USER1.toLowerCase())
			expect(state.maxSlippageBps).toBe(100)
			expect(state.minTradeAmount).toBe(1_000_000n)
			expect(state.targetTokens).toHaveLength(1)
			expect(state.targetTokens[0]!.toLowerCase()).toBe(WETH.toLowerCase())
		})
	})
})
