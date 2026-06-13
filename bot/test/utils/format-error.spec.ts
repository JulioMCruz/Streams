/**
 * Tests for utils/format-error.ts — formatError.
 *
 * Audit findings (H-04):
 * - Error → its message; non-Error object → redacted JSON; primitive →
 *   String(value).
 * - Keys matching /(key|token|secret|auth|password|signature|private|
 *   mnemonic|seed)/i are replaced with [redacted] so an upstream HTTP error
 *   object can't leak credentials into the logs.
 * - BigInt values are stringified (JSON.stringify throws on bigint otherwise).
 * - Circular / non-serialisable objects fall back to String(value).
 * - The output is always capped at 500 chars to bound a hostile payload.
 */

import { expect } from 'chai'

import { formatError } from '../../src/utils/format-error.js'

describe('utils/format-error', function () {
  describe('formatError', function () {
    it('Should return the message of an Error instance', function () {
      expect(formatError(new Error('rpc timeout'))).to.equal('rpc timeout')
    })

    it('Should return the message of an Error subclass', function () {
      class ConfigError extends Error {}
      expect(formatError(new ConfigError('bad config'))).to.equal('bad config')
    })

    it('Should redact secret-looking keys in an error object', function () {
      const out = formatError({
        apiKey: 'super-secret',
        signature: '0xdeadbeef',
        message: 'request failed',
      })
      expect(out).to.contain('[redacted]')
      expect(out).to.not.contain('super-secret')
      expect(out).to.not.contain('0xdeadbeef')
      // Non-secret fields are preserved.
      expect(out).to.contain('request failed')
    })

    it('Should preserve non-secret keys and stringify bigint values', function () {
      const out = formatError({ amount: 5, balance: 1000000000000000000n })
      expect(out).to.contain('"amount":5')
      // bigint serialised as a string, not throwing.
      expect(out).to.contain('"balance":"1000000000000000000"')
    })

    it('Should fall back to String() for a circular object', function () {
      const circular: Record<string, unknown> = {}
      circular.self = circular
      // JSON.stringify throws on a cycle → catch → String(value).
      expect(formatError(circular)).to.equal('[object Object]')
    })

    it('Should stringify a primitive number', function () {
      expect(formatError(404)).to.equal('404')
    })

    it('Should stringify a primitive string', function () {
      expect(formatError('plain failure')).to.equal('plain failure')
    })

    it('Should stringify null without treating it as an object', function () {
      expect(formatError(null)).to.equal('null')
    })

    it('Should cap a very long Error message at 500 chars with a truncation marker', function () {
      const out = formatError(new Error('x'.repeat(1000)))
      expect(out.length).to.be.lessThan(1000)
      expect(out.endsWith('…[truncated]')).to.be.true
    })

    it('Should not truncate a short message', function () {
      const out = formatError(new Error('short'))
      expect(out).to.equal('short')
      expect(out).to.not.contain('[truncated]')
    })
  })
})
