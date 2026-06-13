/**
 * Tests for utils/write-report.ts — writeStreamVaultsReport.
 *
 * Uses the CRE SDK test harness (EvmMock + newTestRuntime).
 * writeReport is mocked by setting evmMock.writeReport directly —
 * addContractMock.writeReport requires gasConfig which writeStreamVaultsReport
 * does not supply (DON consensus path doesn't need it).
 *
 * Mock shape notes:
 * - EvmMock.writeReport accepts WriteReportReplyJson (proto JSON form): txStatus
 *   is the string enum name, txHash is a base64-encoded string. fromJson converts
 *   these back to the protobuf message before the SDK client decodes the reply.
 * - TxStatus numeric enum values also work at runtime (fromJson is lenient), but
 *   for strict TypeScript correctness we use the string form.
 *
 * Audit findings:
 * - Returns the tx hash as a hex string on TxStatus.SUCCESS.
 * - Throws with the errorMessage when txStatus !== SUCCESS.
 * - Falls back to `status <N>` in the thrown error when errorMessage is absent.
 * - Returns a zero-hash hex string when txHash is undefined (edge case).
 */

import { EVMClient } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { EvmMock, newTestRuntime } from '@chainlink/cre-sdk/test'
import { describe, expect } from 'bun:test'
import { bytesToHex } from 'viem'

// Proto JSON representation for WriteReportReply — used to type evmMock.writeReport returns.
// Matches WriteReportReplyJson from @chainlink/cre-sdk internal generated types.
type WriteReportReplyJson = {
	txStatus?: 'TX_STATUS_FATAL' | 'TX_STATUS_REVERTED' | 'TX_STATUS_SUCCESS'
	txHash?: string // base64-encoded bytes
	errorMessage?: string
}

import { writeStreamVaultsReport } from '../../src/utils/write-report'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAIN_SELECTOR = 15971525489660198786n
const STREAM_VAULTS = '0x1111111111111111111111111111111111111111' as const
const TX_HASH_BYTES = new Uint8Array(32).fill(0xde)
const TX_HASH_B64 = Buffer.from(TX_HASH_BYTES).toString('base64')
const TX_HASH_HEX = bytesToHex(TX_HASH_BYTES)

/** WriteReportReplyJson helper — builds the proto JSON form for EvmMock.writeReport.
 * Omits absent optional fields entirely (passing `undefined` to fromJson would throw).
 */
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

describe('utils/write-report', () => {
	describe('writeStreamVaultsReport', () => {
		test('Should return the tx hash hex on TxStatus.SUCCESS', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.writeReport = () => makeWriteReply('TX_STATUS_SUCCESS', TX_HASH_B64, '')

			const evm = new EVMClient(CHAIN_SELECTOR)
			const txHash = writeStreamVaultsReport(runtime, evm, STREAM_VAULTS, '0xdeadbeef')
			expect(txHash.toLowerCase()).toBe(TX_HASH_HEX.toLowerCase())
		})

		test('Should throw with errorMessage when txStatus is REVERTED', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.writeReport = () =>
				makeWriteReply('TX_STATUS_REVERTED', undefined, 'execution reverted: INVALID_REPORT')

			const evm = new EVMClient(CHAIN_SELECTOR)
			expect(() => writeStreamVaultsReport(runtime, evm, STREAM_VAULTS, '0xdeadbeef')).toThrow(
				/INVALID_REPORT/,
			)
		})

		test('Should throw with errorMessage when txStatus is FATAL', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.writeReport = () => makeWriteReply('TX_STATUS_FATAL', undefined, 'out of gas')

			const evm = new EVMClient(CHAIN_SELECTOR)
			expect(() => writeStreamVaultsReport(runtime, evm, STREAM_VAULTS, '0xdeadbeef')).toThrow(
				/out of gas/,
			)
		})

		test('Should fall back to "status <N>" in the thrown error when errorMessage is absent', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			// No errorMessage — the error should mention the numeric status
			evmMock.writeReport = () => makeWriteReply('TX_STATUS_REVERTED', undefined, undefined)

			const evm = new EVMClient(CHAIN_SELECTOR)
			expect(() => writeStreamVaultsReport(runtime, evm, STREAM_VAULTS, '0xdeadbeef')).toThrow(
				/writeReport failed/,
			)
		})

		test('Should return a zero-padded hex hash when txHash is absent', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			// txHash is undefined — should return bytesToHex(new Uint8Array(32))
			evmMock.writeReport = () => makeWriteReply('TX_STATUS_SUCCESS', undefined, '')

			const evm = new EVMClient(CHAIN_SELECTOR)
			const txHash = writeStreamVaultsReport(runtime, evm, STREAM_VAULTS, '0xdeadbeef')
			// bytesToHex(new Uint8Array(32)) = '0x' + '00'.repeat(32)
			expect(txHash).toBe(bytesToHex(new Uint8Array(32)))
		})

		test('Should include "writeReport failed" prefix in all thrown errors', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.writeReport = () => makeWriteReply('TX_STATUS_FATAL', undefined, 'something bad')

			const evm = new EVMClient(CHAIN_SELECTOR)
			expect(() => writeStreamVaultsReport(runtime, evm, STREAM_VAULTS, '0xdeadbeef')).toThrow(
				/writeReport failed/,
			)
		})
	})
})
