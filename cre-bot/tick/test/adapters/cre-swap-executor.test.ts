/**
 * Tests for adapters/cre-swap-executor.ts — CreSwapExecutor.
 *
 * Uses the CRE SDK test harness. writeReport is mocked by setting
 * evmMock.writeReport directly — addContractMock.writeReport requires gasConfig
 * which writeStreamVaultsReport (and therefore executeSwap) does not supply,
 * since the DON consensus path does not need gas estimation.
 *
 * Mock shape: use WriteReportReplyJson (proto JSON form) — txStatus is the string
 * enum name ('TX_STATUS_SUCCESS' etc.), txHash is a base64 string. Optional fields
 * must be fully omitted (not set to undefined) to avoid fromJson errors.
 *
 * Audit findings:
 * - writeStreamVaultsReport throws when txStatus !== SUCCESS — the adapter
 *   propagates this so the use case can log/skip the account.
 * - The innerCallData encodes executeSwap(smartAccount, params) from decision+quote.
 */

import { EVMClient } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { EvmMock, newTestRuntime } from '@chainlink/cre-sdk/test'
import { describe, expect } from 'bun:test'
import { bytesToHex } from 'viem'

// Proto JSON representation for WriteReportReply — used to type evmMock.writeReport returns.
type WriteReportReplyJson = {
	txStatus?: 'TX_STATUS_FATAL' | 'TX_STATUS_REVERTED' | 'TX_STATUS_SUCCESS'
	txHash?: string // base64-encoded bytes
	errorMessage?: string
}

import { CreSwapExecutor } from '../../src/adapters/cre-swap-executor'
import type { QuoteResult } from '../../src/domain/models/quote'
import type { SwapDecision } from '../../src/domain/models/swap'
import type { WorkflowConfig } from '../../src/settings/config'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAIN_SELECTOR = 15971525489660198786n
const STREAM_VAULTS = '0x1111111111111111111111111111111111111111' as const
const SA1 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const
const USDCX = '0x3333333333333333333333333333333333333333' as const
const USDC = '0x4444444444444444444444444444444444444444' as const
const WETH = '0x4200000000000000000000000000000000000006' as const
const ROUTER = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF' as const
const TX_HASH_BYTES = new Uint8Array(32).fill(0xab)
const TX_HASH_B64 = Buffer.from(TX_HASH_BYTES).toString('base64')
const TX_HASH_HEX = bytesToHex(TX_HASH_BYTES)

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
			superTokenIn: USDCX,
			tokenIn: USDC,
			superToUnderlyingDivisor: 10n ** 12n,
		},
	}
}

function makeDecision(): SwapDecision {
	return {
		smartAccount: SA1,
		superTokenIn: USDCX,
		superAmountIn: 5_000_000_000_000_000_000n,
		tokenIn: USDC,
		tokenOut: WETH,
		underlyingAmountIn: 5_000_000n,
		maxSlippageBps: 100,
	}
}

function makeQuote(): QuoteResult {
	return {
		to: ROUTER,
		data: '0xdeadbeef',
		value: 0n,
		minAmountOut: 4_500_000n,
	}
}

/** WriteReportReplyJson helper — omits absent optional fields to avoid fromJson errors. */
function makeWriteReply(
	txStatus: WriteReportReplyJson['txStatus'],
	txHash?: string,
	errorMessage?: string,
): WriteReportReplyJson {
	const reply: WriteReportReplyJson = { txStatus }
	if (txHash !== undefined) reply.txHash = txHash
	if (errorMessage !== undefined) reply.errorMessage = errorMessage
	return reply
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CreSwapExecutor', () => {
	describe('executeSwap', () => {
		test('Should return the tx hash on a successful writeReport', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.writeReport = () => makeWriteReply('TX_STATUS_SUCCESS', TX_HASH_B64, '')

			const evm = new EVMClient(CHAIN_SELECTOR)
			const executor = new CreSwapExecutor(runtime, evm, makeConfig())

			const txHash = await executor.executeSwap(makeDecision(), makeQuote())
			expect(txHash.toLowerCase()).toBe(TX_HASH_HEX.toLowerCase())
		})

		test('Should throw when writeReport returns a non-SUCCESS status', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.writeReport = () => makeWriteReply('TX_STATUS_REVERTED', undefined, 'execution reverted')

			const evm = new EVMClient(CHAIN_SELECTOR)
			const executor = new CreSwapExecutor(runtime, evm, makeConfig())

			await expect(executor.executeSwap(makeDecision(), makeQuote())).rejects.toThrow(
				/writeReport failed/,
			)
		})

		test('Should throw with FATAL status error message in the thrown error', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.writeReport = () => makeWriteReply('TX_STATUS_FATAL', undefined, 'out of gas')

			const evm = new EVMClient(CHAIN_SELECTOR)
			const executor = new CreSwapExecutor(runtime, evm, makeConfig())

			await expect(executor.executeSwap(makeDecision(), makeQuote())).rejects.toThrow(/out of gas/)
		})
	})
})
