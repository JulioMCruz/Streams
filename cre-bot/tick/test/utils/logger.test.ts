/**
 * Tests for utils/logger.ts — getLogger factory (CRE flavour).
 *
 * The CRE logger differs from bot in that it wraps `runtime.log()`
 * instead of `console.*`. There is no LOG_LEVEL filtering: every line is
 * emitted — the DON captures all `runtime.log` output. Tests verify:
 * - The service name and level tag appear in the output.
 * - Structured context (including bigint values) is serialised correctly.
 * - String-shortcut ctx is handled (no JSON wrapping).
 * - Missing msg on an object ctx defaults to ''.
 */

import type { Runtime } from '@chainlink/cre-sdk'
import { describe, expect, it } from 'bun:test'

import { getLogger } from '../../src/utils/logger'

// ── Minimal Runtime stub: captures runtime.log calls ─────────────────────────

function makeRuntime(): { runtime: Runtime<unknown>; logs: string[] } {
	const logs: string[] = []
	const runtime = {
		log: (msg: string) => logs.push(msg),
	} as unknown as Runtime<unknown>
	return { runtime, logs }
}

describe('utils/logger', () => {
	describe('getLogger', () => {
		it('Should prefix every message with the service name', () => {
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'my-service')
			logger.info({}, 'test_event')

			expect(logs).toHaveLength(1)
			expect(logs[0]).toContain('[my-service]')
		})

		it('Should include INFO level tag in the output', () => {
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'svc')
			logger.info({}, 'hello')

			expect(logs[0]).toContain('INFO')
		})

		it('Should include WARN level tag in the output', () => {
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'svc')
			logger.warn({}, 'warning')

			expect(logs[0]).toContain('WARN')
		})

		it('Should include ERROR level tag in the output', () => {
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'svc')
			logger.error({}, 'oops')

			expect(logs[0]).toContain('ERROR')
		})

		it('Should emit ALL levels (no level filtering — DON captures everything)', () => {
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'svc')
			logger.info({}, 'info_event')
			logger.warn({}, 'warn_event')
			logger.error({}, 'error_event')

			// All three lines must appear — there is no LOG_LEVEL filter in the CRE logger.
			expect(logs).toHaveLength(3)
		})

		it('Should include the event message string in the output', () => {
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'svc')
			logger.info({}, 'bot_started')

			expect(logs[0]).toContain('bot_started')
		})

		it('Should include structured context fields in the output', () => {
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'svc')
			logger.info({ smartAccount: '0xabc', count: 3 }, 'tick')

			expect(logs[0]).toContain('smartAccount')
			expect(logs[0]).toContain('0xabc')
		})

		it('Should serialize bigint context values without throwing', () => {
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'svc')
			expect(() =>
				logger.info({ block: 1234567890n, balance: 2n ** 128n }, 'block_info'),
			).not.toThrow()
			expect(logs[0]).toContain('1234567890')
		})

		it('Should accept a plain string as context (string shortcut)', () => {
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'svc')
			logger.info('plain string message')

			expect(logs).toHaveLength(1)
			expect(logs[0]).toContain('plain string message')
		})

		it('Should use empty string as message when ctx is an object and no msg is provided', () => {
			// Covers the `msg ?? ''` branch:
			//   const message = typeof ctx === 'string' ? ctx : (msg ?? '')
			// When ctx is a LogContext object and msg is omitted, message defaults to ''.
			// The output still includes the context fields (serialized as JSON).
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'svc')
			logger.info({ event: 'tick', block: 42 })

			expect(logs).toHaveLength(1)
			// message is '' but context JSON is appended
			expect(logs[0]).toContain('tick')
			expect(logs[0]).toContain('42')
		})

		it('Should include service name, level, and context in a single log line', () => {
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'dca-bot')
			logger.warn({ smartAccount: SA1, reason: 'cooldown' }, 'swap_skipped')

			const line = logs[0]!
			expect(line).toContain('[dca-bot]')
			expect(line).toContain('WARN')
			expect(line).toContain('swap_skipped')
			expect(line).toContain('smartAccount')
			expect(line).toContain(SA1)
		})

		it('Should not throw when context contains nested objects', () => {
			const { runtime } = makeRuntime()
			const logger = getLogger(runtime, 'svc')
			expect(() => logger.info({ nested: { deep: { value: 42 } } }, 'nested_ctx')).not.toThrow()
		})

		it('Should emit each level via the same runtime.log sink', () => {
			// There is only one sink (runtime.log); info/warn/error all go through it.
			const { runtime, logs } = makeRuntime()
			const logger = getLogger(runtime, 'svc')
			logger.info({}, 'i')
			logger.warn({}, 'w')
			logger.error({}, 'e')

			// All three use runtime.log (no separate console.warn / console.error)
			expect(logs).toHaveLength(3)
			expect(logs[0]).toContain('INFO')
			expect(logs[1]).toContain('WARN')
			expect(logs[2]).toContain('ERROR')
		})
	})
})

// ── Fixture addresses (for readability in tests above) ────────────────────────
const SA1 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
