/**
 * Tests for domain/errors.ts — BotError and BotErrorCode.
 *
 * Audit findings:
 * - BotError.name is set but instanceof checks rely on prototype chain.
 * - code is a readonly public field; consumers can branch on it safely.
 */

import { expect } from 'chai'

import { BotError, BotErrorCode } from '../../src/domain/errors.js'

describe('errors', function () {
  describe('BotError', function () {
    it('Should be an instance of Error', function () {
      const err = new BotError(BotErrorCode.NO_TARGETS, 'no targets configured')
      expect(err).to.be.instanceOf(Error)
    })

    it('Should be an instance of BotError', function () {
      const err = new BotError(BotErrorCode.BELOW_MIN_TRADE, 'below min')
      expect(err).to.be.instanceOf(BotError)
    })

    it('Should set name to "BotError"', function () {
      const err = new BotError(BotErrorCode.NO_TARGETS, 'msg')
      expect(err.name).to.equal('BotError')
    })

    it('Should carry the provided code as a readonly field', function () {
      for (const code of Object.values(BotErrorCode)) {
        const err = new BotError(code, 'test')
        expect(err.code).to.equal(code)
      }
    })

    it('Should carry the provided message', function () {
      const msg = 'Something went wrong'
      const err = new BotError(BotErrorCode.QUOTE_UNAVAILABLE, msg)
      expect(err.message).to.equal(msg)
    })

    it('Should expose all four expected error codes', function () {
      expect(BotErrorCode.NO_TARGETS).to.equal('NO_TARGETS')
      expect(BotErrorCode.BALANCE_UNAVAILABLE).to.equal('BALANCE_UNAVAILABLE')
      expect(BotErrorCode.BELOW_MIN_TRADE).to.equal('BELOW_MIN_TRADE')
      expect(BotErrorCode.QUOTE_UNAVAILABLE).to.equal('QUOTE_UNAVAILABLE')
    })

    it('Should allow branching on code without matching on message text', function () {
      const err = new BotError(BotErrorCode.BALANCE_UNAVAILABLE, 'rpc timeout')
      let handled = false
      if (err.code === BotErrorCode.BALANCE_UNAVAILABLE) {
        handled = true
      }
      expect(handled).to.be.true
    })
  })
})
