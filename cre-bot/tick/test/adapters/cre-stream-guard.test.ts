/**
 * Tests for adapters/cre-stream-guard.ts — CreStreamGuard.
 *
 * Uses the CRE SDK test harness. writeReport is mocked by setting
 * evmMock.writeReport directly — addContractMock.writeReport requires gasConfig
 * which writeStreamVaultsReport (and therefore closeStream) does not supply,
 * since the DON consensus path does not need gas estimation.
 *
 * Mock shape: use WriteReportReplyJson (proto JSON form) — txStatus is the string
 * enum name ('TX_STATUS_SUCCESS' etc.), txHash is a base64 string. Optional fields
 * must be fully omitted (not set to undefined) to avoid fromJson errors.
 *
 * Audit findings:
 * - writeStreamVaultsReport throws on non-SUCCESS status — propagated to caller.
 * - The inner calldata encodes closeStreamIfLow(smartAccount, superToken).
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

import { CreStreamGuard } from '../../src/adapters/cre-stream-guard'
import type { WorkflowConfig } from '../../src/settings/config'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAIN_SELECTOR = 15971525489660198786n
const STREAM_VAULTS = '0x1111111111111111111111111111111111111111' as const
const SA1 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const
const SUPER_TOKEN = '0x3333333333333333333333333333333333333333' as const
const TX_HASH_BYTES = new Uint8Array(32).fill(0xca)
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
			superTokenIn: SUPER_TOKEN,
			tokenIn: '0x4444444444444444444444444444444444444444',
			superToUnderlyingDivisor: 10n ** 12n,
		},
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

describe('CreStreamGuard', () => {
	describe('closeStream', () => {
		test('Should return the tx hash on a successful writeReport', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.writeReport = () => makeWriteReply('TX_STATUS_SUCCESS', TX_HASH_B64, '')

			const evm = new EVMClient(CHAIN_SELECTOR)
			const guard = new CreStreamGuard(runtime, evm, makeConfig())

			const txHash = await guard.closeStream(SA1, SUPER_TOKEN)
			expect(txHash.toLowerCase()).toBe(TX_HASH_HEX.toLowerCase())
		})

		test('Should throw when writeReport returns a REVERTED status', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.writeReport = () =>
				makeWriteReply('TX_STATUS_REVERTED', undefined, 'revert STREAM_NOT_ACTIVE')

			const evm = new EVMClient(CHAIN_SELECTOR)
			const guard = new CreStreamGuard(runtime, evm, makeConfig())

			await expect(guard.closeStream(SA1, SUPER_TOKEN)).rejects.toThrow(/writeReport failed/)
		})

		test('Should throw when writeReport returns a FATAL status', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.writeReport = () => makeWriteReply('TX_STATUS_FATAL', undefined, 'fatal error')

			const evm = new EVMClient(CHAIN_SELECTOR)
			const guard = new CreStreamGuard(runtime, evm, makeConfig())

			await expect(guard.closeStream(SA1, SUPER_TOKEN)).rejects.toThrow(/fatal error/)
		})

		test('Should throw when writeReport has no errorMessage and returns non-SUCCESS', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			// No errorMessage — falls back to `status <N>` in the error message
			evmMock.writeReport = () => makeWriteReply('TX_STATUS_REVERTED')

			const evm = new EVMClient(CHAIN_SELECTOR)
			const guard = new CreStreamGuard(runtime, evm, makeConfig())

			await expect(guard.closeStream(SA1, SUPER_TOKEN)).rejects.toThrow(/writeReport failed/)
		})
	})
})
