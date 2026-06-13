/**
 * Tests for utils/format-error.ts — formatError.
 *
 * Ported from bot/test/utils/format-error.spec.ts, adapted to bun:test.
 *
 * Audit findings (H-04):
 * - Error → its message; non-Error object → redacted JSON; primitive → String(value).
 * - Keys matching /(key|token|secret|auth|password|signature|private|mnemonic|seed)/i
 *   are replaced with [redacted] so an upstream HTTP error can't leak credentials.
 * - BigInt values are stringified (JSON.stringify throws on bigint otherwise).
 * - Circular / non-serialisable objects fall back to String(value).
 * - The output is always capped at 500 chars to bound a hostile payload.
 */

import { describe, expect, it } from 'bun:test'

import { formatError } from '../../src/utils/format-error'

describe('utils/format-error', () => {
	describe('formatError', () => {
		it('Should return the message of an Error instance', () => {
			expect(formatError(new Error('rpc timeout'))).toBe('rpc timeout')
		})

		it('Should return the message of an Error subclass', () => {
			class ConfigError extends Error {}
			expect(formatError(new ConfigError('bad config'))).toBe('bad config')
		})

		it('Should redact secret-looking keys in an error object', () => {
			const out = formatError({
				apiKey: 'super-secret',
				signature: '0xdeadbeef',
				message: 'request failed',
			})
			expect(out).toContain('[redacted]')
			expect(out).not.toContain('super-secret')
			expect(out).not.toContain('0xdeadbeef')
			// Non-secret fields are preserved.
			expect(out).toContain('request failed')
		})

		it('Should preserve non-secret keys and stringify bigint values', () => {
			const out = formatError({ amount: 5, balance: 1000000000000000000n })
			expect(out).toContain('"amount":5')
			// bigint serialised as a string, not throwing.
			expect(out).toContain('"balance":"1000000000000000000"')
		})

		it('Should fall back to String() for a circular object', () => {
			const circular: Record<string, unknown> = {}
			circular.self = circular
			// JSON.stringify throws on a cycle → catch → String(value).
			expect(formatError(circular)).toBe('[object Object]')
		})

		it('Should stringify a primitive number', () => {
			expect(formatError(404)).toBe('404')
		})

		it('Should stringify a primitive string', () => {
			expect(formatError('plain failure')).toBe('plain failure')
		})

		it('Should stringify null without treating it as an object', () => {
			expect(formatError(null)).toBe('null')
		})

		it('Should cap a very long Error message at 500 chars with a truncation marker', () => {
			const out = formatError(new Error('x'.repeat(1000)))
			expect(out.length).toBeLessThan(1000)
			expect(out.endsWith('…[truncated]')).toBe(true)
		})

		it('Should not truncate a short message', () => {
			const out = formatError(new Error('short'))
			expect(out).toBe('short')
			expect(out).not.toContain('[truncated]')
		})

		it('Should redact "token" and "private" keys (adversarial: log injection)', () => {
			const out = formatError({ token: 'LEAKED_TOKEN', privateKey: '0xdeadbeef' })
			expect(out).not.toContain('LEAKED_TOKEN')
			expect(out).not.toContain('0xdeadbeef')
			expect(out).toContain('[redacted]')
		})

		it('Should redact "mnemonic" and "seed" keys', () => {
			const out = formatError({ mnemonic: 'word1 word2 word3', seed: 'entropy' })
			expect(out).not.toContain('word1')
			expect(out).not.toContain('entropy')
		})

		it('Should stringify undefined via String()', () => {
			expect(formatError(undefined)).toBe('undefined')
		})

		it('Should stringify false (boolean) via String()', () => {
			expect(formatError(false)).toBe('false')
		})
	})
})
