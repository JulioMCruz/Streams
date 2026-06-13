/**
 * Tests for domain/errors.ts — BotError and BotErrorCode.
 *
 * Ported from bot/test/domain/errors.spec.ts, adapted to bun:test.
 *
 * Audit findings:
 * - BotError.name is set but instanceof checks rely on prototype chain.
 * - code is a readonly public field; consumers can branch on it safely.
 */

import { describe, expect, it } from 'bun:test'

import { BotError, BotErrorCode } from '../../src/domain/errors'

describe('errors', () => {
	describe('BotError', () => {
		it('Should be an instance of Error', () => {
			const err = new BotError(BotErrorCode.NO_TARGETS, 'no targets configured')
			expect(err).toBeInstanceOf(Error)
		})

		it('Should be an instance of BotError', () => {
			const err = new BotError(BotErrorCode.BELOW_MIN_TRADE, 'below min')
			expect(err).toBeInstanceOf(BotError)
		})

		it('Should set name to "BotError"', () => {
			const err = new BotError(BotErrorCode.NO_TARGETS, 'msg')
			expect(err.name).toBe('BotError')
		})

		it('Should carry the provided code as a readonly field', () => {
			for (const code of Object.values(BotErrorCode)) {
				const err = new BotError(code, 'test')
				expect(err.code).toBe(code)
			}
		})

		it('Should carry the provided message', () => {
			const msg = 'Something went wrong'
			const err = new BotError(BotErrorCode.QUOTE_UNAVAILABLE, msg)
			expect(err.message).toBe(msg)
		})

		it('Should expose all four expected error codes', () => {
			// Cast to string to satisfy bun:test's strict overload resolution —
			// BotErrorCode is an enum type; the literal strings are the runtime values.
			expect(BotErrorCode.NO_TARGETS as string).toBe('NO_TARGETS')
			expect(BotErrorCode.BALANCE_UNAVAILABLE as string).toBe('BALANCE_UNAVAILABLE')
			expect(BotErrorCode.BELOW_MIN_TRADE as string).toBe('BELOW_MIN_TRADE')
			expect(BotErrorCode.QUOTE_UNAVAILABLE as string).toBe('QUOTE_UNAVAILABLE')
		})

		it('Should allow branching on code without matching on message text', () => {
			const err = new BotError(BotErrorCode.BALANCE_UNAVAILABLE, 'rpc timeout')
			let handled = false
			if (err.code === BotErrorCode.BALANCE_UNAVAILABLE) {
				handled = true
			}
			expect(handled).toBe(true)
		})
	})
})
