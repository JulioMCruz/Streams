/**
 * Tests for adapters/cre-swap-gateway.ts — CreSwapGateway.
 *
 * Uses the CRE SDK test harness (EvmMock + addContractMock + newTestRuntime).
 *
 * Audit findings:
 * - All three reads target the StreamVaults gateway via callContract.
 * - getLastSwapBlock must forward the smartAccount address argument.
 */

import { EVMClient } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { addContractMock, EvmMock, newTestRuntime } from '@chainlink/cre-sdk/test'
import { describe, expect } from 'bun:test'

import { CreSwapGateway } from '../../src/adapters/cre-swap-gateway'
import type { WorkflowConfig } from '../../src/settings/config'
import { STREAM_VAULTS_ABI } from '../../src/utils/abis'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAIN_SELECTOR = 15971525489660198786n
const STREAM_VAULTS = '0x1111111111111111111111111111111111111111' as const
const SA1 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const

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
			superTokenIn: '0x3333333333333333333333333333333333333333',
			tokenIn: '0x4444444444444444444444444444444444444444',
			superToUnderlyingDivisor: 10n ** 12n,
		},
	}
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CreSwapGateway', () => {
	describe('getSwapCooldownBlocks', () => {
		test('Should return the cooldown blocks from the contract', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const contractMock = addContractMock(evmMock, {
				address: STREAM_VAULTS,
				abi: STREAM_VAULTS_ABI,
			})
			contractMock.swapCooldownBlocks = () => 5n

			const evm = new EVMClient(CHAIN_SELECTOR)
			const gateway = new CreSwapGateway(runtime, evm, makeConfig())

			const result = await gateway.getSwapCooldownBlocks()
			expect(result).toBe(5n)
		})

		test('Should return 0n when cooldown is disabled', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const contractMock = addContractMock(evmMock, {
				address: STREAM_VAULTS,
				abi: STREAM_VAULTS_ABI,
			})
			contractMock.swapCooldownBlocks = () => 0n

			const evm = new EVMClient(CHAIN_SELECTOR)
			const gateway = new CreSwapGateway(runtime, evm, makeConfig())

			const result = await gateway.getSwapCooldownBlocks()
			expect(result).toBe(0n)
		})
	})

	describe('getLastSwapBlock', () => {
		test('Should return the last swap block for a given smart account', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const contractMock = addContractMock(evmMock, {
				address: STREAM_VAULTS,
				abi: STREAM_VAULTS_ABI,
			})
			contractMock.lastSwapBlock = (_sa: unknown) => 999n

			const evm = new EVMClient(CHAIN_SELECTOR)
			const gateway = new CreSwapGateway(runtime, evm, makeConfig())

			const result = await gateway.getLastSwapBlock(SA1)
			expect(result).toBe(999n)
		})

		test('Should return 0n for an account that has never swapped', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const contractMock = addContractMock(evmMock, {
				address: STREAM_VAULTS,
				abi: STREAM_VAULTS_ABI,
			})
			contractMock.lastSwapBlock = (_sa: unknown) => 0n

			const evm = new EVMClient(CHAIN_SELECTOR)
			const gateway = new CreSwapGateway(runtime, evm, makeConfig())

			const result = await gateway.getLastSwapBlock(SA1)
			expect(result).toBe(0n)
		})

		test('Should forward the smartAccount address to the contract call', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			let capturedSa: string | null = null
			const contractMock = addContractMock(evmMock, {
				address: STREAM_VAULTS,
				abi: STREAM_VAULTS_ABI,
			})
			contractMock.lastSwapBlock = (sa: unknown) => {
				capturedSa = sa as string
				return 0n
			}

			const evm = new EVMClient(CHAIN_SELECTOR)
			const gateway = new CreSwapGateway(runtime, evm, makeConfig())

			await gateway.getLastSwapBlock(SA1)
			expect((capturedSa as unknown as string).toLowerCase()).toBe(SA1.toLowerCase())
		})
	})

	describe('getStreamCloseThresholdBps', () => {
		test('Should return the auto-close threshold in bps', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const contractMock = addContractMock(evmMock, {
				address: STREAM_VAULTS,
				abi: STREAM_VAULTS_ABI,
			})
			contractMock.streamCloseThresholdBps = () => 1_000n

			const evm = new EVMClient(CHAIN_SELECTOR)
			const gateway = new CreSwapGateway(runtime, evm, makeConfig())

			const result = await gateway.getStreamCloseThresholdBps()
			expect(result).toBe(1_000n)
		})
	})
})
