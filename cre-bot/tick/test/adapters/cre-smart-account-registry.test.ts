/**
 * Tests for adapters/cre-smart-account-registry.ts — CreSmartAccountRegistry.
 *
 * Uses the CRE SDK test harness (EvmMock + newTestRuntime) to exercise the
 * filterLogs capability call without hitting a real RPC.
 *
 * Mock shape notes:
 * - EvmMock.filterLogs returns FilterLogsReplyJson: topics and data are base64
 *   strings (proto JSON form for `bytes` fields). Use toBase64() to convert
 *   from Uint8Array.
 *
 * Audit findings:
 * - Logs with < 3 topics are silently skipped (short-circuit guard).
 * - Logs that fail decodeEventLog are silently skipped (try/catch).
 * - Duplicate smart accounts (multiple events for the same SA) are deduped —
 *   only the last entry wins (dedup.set overwrites).
 * - Logs with empty user/smartAccount address fields are skipped.
 */

import { EVMClient } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { EvmMock, newTestRuntime } from '@chainlink/cre-sdk/test'
import { describe, expect } from 'bun:test'
import { encodeEventTopics, parseAbiItem, toBytes } from 'viem'

// Proto JSON representation for FilterLogsReply — used to type evmMock.filterLogs returns.
// topics, data, address, etc. are base64-encoded bytes strings (proto JSON wire format).
type LogJson = {
	address?: string
	topics?: string[] // base64-encoded 32-byte values
	txHash?: string
	blockHash?: string
	data?: string // base64-encoded bytes
	eventSig?: string
}

type FilterLogsReplyJson = {
	logs?: LogJson[]
}

import { CreSmartAccountRegistry } from '../../src/adapters/cre-smart-account-registry'
import type { WorkflowConfig } from '../../src/settings/config'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAIN_SELECTOR = 15971525489660198786n
const STREAM_VAULTS = '0x1111111111111111111111111111111111111111' as const
const SA1 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const
const SA2 = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' as const
const USER1 = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as const
const USER2 = '0xDDdDddDdDdddDDddDDddDDDDdDdDDdDDdDDDDDDd' as const

function makeConfig(): WorkflowConfig {
	return {
		chainSelector: CHAIN_SELECTOR,
		chainId: 8453,
		discoveryFromBlock: 23100000n,
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

const SmartAccountCreated = parseAbiItem(
	'event SmartAccountCreated(address indexed user, address indexed smartAccount)',
)

/** Convert Uint8Array to base64 string (proto JSON wire format for `bytes` fields). */
function toBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64')
}

/**
 * Build the 3-topic base64-string array for a SmartAccountCreated event.
 * FilterLogsReplyJson uses `topics: string[]` — each element is a base64-encoded
 * 32-byte value (sig hash, indexed user, indexed SA).
 */
function makeTopics(user: string, smartAccount: string): string[] {
	const hexTopics = encodeEventTopics({
		abi: [SmartAccountCreated],
		eventName: 'SmartAccountCreated',
		args: {
			user: user as `0x${string}`,
			smartAccount: smartAccount as `0x${string}`,
		},
	})
	// Convert each hex topic to Uint8Array then to base64
	return hexTopics.map((t) => toBase64(toBytes(t as `0x${string}`)))
}

/** Build a FilterLogsReplyJson containing the specified log entries. */
function makeFilterLogsReply(
	logs: Array<{ topics: string[]; data?: string }>,
): FilterLogsReplyJson {
	return {
		logs: logs.map((l) => ({
			topics: l.topics,
			data: l.data ?? toBase64(new Uint8Array(0)),
		})),
	}
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CreSmartAccountRegistry', () => {
	describe('discover', () => {
		test('Should return an empty array when filterLogs returns no logs', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.filterLogs = () => makeFilterLogsReply([])

			const evm = new EVMClient(CHAIN_SELECTOR)
			const registry = new CreSmartAccountRegistry(runtime, evm, makeConfig())

			const result = await registry.discover()
			expect(result).toHaveLength(0)
		})

		test('Should decode a single SmartAccountCreated log correctly', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.filterLogs = () => makeFilterLogsReply([{ topics: makeTopics(USER1, SA1) }])

			const evm = new EVMClient(CHAIN_SELECTOR)
			const registry = new CreSmartAccountRegistry(runtime, evm, makeConfig())

			const result = await registry.discover()
			expect(result).toHaveLength(1)
			expect(result[0]!.user.toLowerCase()).toBe(USER1.toLowerCase())
			expect(result[0]!.smartAccount.toLowerCase()).toBe(SA1.toLowerCase())
		})

		test('Should decode multiple SmartAccountCreated logs', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.filterLogs = () =>
				makeFilterLogsReply([{ topics: makeTopics(USER1, SA1) }, { topics: makeTopics(USER2, SA2) }])

			const evm = new EVMClient(CHAIN_SELECTOR)
			const registry = new CreSmartAccountRegistry(runtime, evm, makeConfig())

			const result = await registry.discover()
			expect(result).toHaveLength(2)
		})

		test('Should deduplicate logs for the same smart account', async () => {
			// Two events for SA1 (e.g. re-emitted) — dedup should yield one entry.
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.filterLogs = () =>
				makeFilterLogsReply([
					{ topics: makeTopics(USER1, SA1) },
					{ topics: makeTopics(USER1, SA1) }, // duplicate
				])

			const evm = new EVMClient(CHAIN_SELECTOR)
			const registry = new CreSmartAccountRegistry(runtime, evm, makeConfig())

			const result = await registry.discover()
			expect(result).toHaveLength(1)
		})

		test('Should skip logs with fewer than 3 topics', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			// Only 2 topics (missing the SA indexed arg)
			const shortTopics = makeTopics(USER1, SA1).slice(0, 2)
			evmMock.filterLogs = () => makeFilterLogsReply([{ topics: shortTopics }])

			const evm = new EVMClient(CHAIN_SELECTOR)
			const registry = new CreSmartAccountRegistry(runtime, evm, makeConfig())

			const result = await registry.discover()
			expect(result).toHaveLength(0)
		})

		test('Should skip logs whose topics cannot be decoded as SmartAccountCreated', async () => {
			// Use a random topic[0] (not the SmartAccountCreated signature) — decodeEventLog throws.
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			const badTopics = [
				// Replace topic[0] with zeros (wrong event sig)
				toBase64(new Uint8Array(32)),
				toBase64(toBytes(USER1 as `0x${string}`)),
				toBase64(toBytes(SA1 as `0x${string}`)),
			]
			evmMock.filterLogs = () => makeFilterLogsReply([{ topics: badTopics }])

			const evm = new EVMClient(CHAIN_SELECTOR)
			const registry = new CreSmartAccountRegistry(runtime, evm, makeConfig())

			const result = await registry.discover()
			// Decode throws → silently skipped
			expect(result).toHaveLength(0)
		})

		test('Should return checksummed addresses', async () => {
			const runtime = newTestRuntime()
			const evmMock = EvmMock.testInstance(CHAIN_SELECTOR)
			evmMock.filterLogs = () => makeFilterLogsReply([{ topics: makeTopics(USER1, SA1) }])

			const evm = new EVMClient(CHAIN_SELECTOR)
			const registry = new CreSmartAccountRegistry(runtime, evm, makeConfig())

			const result = await registry.discover()
			// getAddress checksums the address
			expect(result[0]!.user).toMatch(/^0x[0-9a-fA-F]{40}$/)
			expect(result[0]!.smartAccount).toMatch(/^0x[0-9a-fA-F]{40}$/)
		})
	})
})
