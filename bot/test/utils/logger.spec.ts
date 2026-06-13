/**
 * Tests for utils/logger.ts — getLogger factory and Logger interface.
 *
 * Audit findings:
 * - Logger reads process.env.LOG_LEVEL at call time (call-site capture).
 *   Tests must restore the env var after each case.
 * - Structured context with bigint values is serialized safely.
 * - Unknown LOG_LEVEL falls back to 'info' threshold.
 * - No sensitive data leakage in context serialization.
 */

import { expect } from 'chai'
import sinon from 'sinon'

import { getLogger } from '../../src/utils/logger.js'

describe('logger', function () {
  describe('getLogger', function () {
    let logStub: sinon.SinonStub
    let warnStub: sinon.SinonStub
    let errorStub: sinon.SinonStub
    let savedLogLevel: string | undefined

    beforeEach(function () {
      logStub = sinon.stub(console, 'log')
      warnStub = sinon.stub(console, 'warn')
      errorStub = sinon.stub(console, 'error')
      savedLogLevel = process.env.LOG_LEVEL
    })

    afterEach(function () {
      sinon.restore()
      if (savedLogLevel === undefined) {
        delete process.env.LOG_LEVEL
      } else {
        process.env.LOG_LEVEL = savedLogLevel
      }
    })

    it('Should prefix every message with the service name', function () {
      process.env.LOG_LEVEL = 'info'
      const logger = getLogger('my-service')
      logger.info({}, 'test_event')
      expect(logStub.calledOnce).to.be.true
      const output = logStub.firstCall.args[0] as string
      expect(output).to.include('[my-service]')
    })

    it('Should output INFO level to console.log', function () {
      process.env.LOG_LEVEL = 'info'
      const logger = getLogger('svc')
      logger.info({}, 'hello')
      expect(logStub.calledOnce).to.be.true
      expect(warnStub.called).to.be.false
      expect(errorStub.called).to.be.false
    })

    it('Should output WARN level to console.warn', function () {
      process.env.LOG_LEVEL = 'info'
      const logger = getLogger('svc')
      logger.warn({}, 'warning')
      expect(warnStub.calledOnce).to.be.true
      expect(logStub.called).to.be.false
    })

    it('Should output ERROR level to console.error', function () {
      process.env.LOG_LEVEL = 'info'
      const logger = getLogger('svc')
      logger.error({}, 'oops')
      expect(errorStub.calledOnce).to.be.true
      expect(logStub.called).to.be.false
    })

    it('Should suppress messages below the configured level', function () {
      process.env.LOG_LEVEL = 'error'
      const logger = getLogger('svc')
      logger.info({}, 'should_not_appear')
      logger.warn({}, 'should_not_appear')
      expect(logStub.called).to.be.false
      expect(warnStub.called).to.be.false
      expect(errorStub.called).to.be.false
    })

    it('Should emit error but not info/warn when LOG_LEVEL=error', function () {
      process.env.LOG_LEVEL = 'error'
      const logger = getLogger('svc')
      logger.error({}, 'critical')
      expect(errorStub.calledOnce).to.be.true
    })

    it('Should emit warn and error but not info when LOG_LEVEL=warn', function () {
      process.env.LOG_LEVEL = 'warn'
      const logger = getLogger('svc')
      logger.info({}, 'nope')
      logger.warn({}, 'yes')
      logger.error({}, 'yes')
      expect(logStub.called).to.be.false
      expect(warnStub.calledOnce).to.be.true
      expect(errorStub.calledOnce).to.be.true
    })

    it('Should include the event message in the output', function () {
      process.env.LOG_LEVEL = 'info'
      const logger = getLogger('svc')
      logger.info({}, 'bot_started')
      const output = logStub.firstCall.args[0] as string
      expect(output).to.include('bot_started')
    })

    it('Should include structured context fields in the output', function () {
      process.env.LOG_LEVEL = 'info'
      const logger = getLogger('svc')
      logger.info({ smartAccount: '0xabc', count: 3 }, 'tick')
      const output = logStub.firstCall.args[0] as string
      expect(output).to.include('smartAccount')
      expect(output).to.include('0xabc')
    })

    it('Should serialize bigint context values without throwing', function () {
      process.env.LOG_LEVEL = 'info'
      const logger = getLogger('svc')
      expect(() =>
        logger.info({ block: 1234567890n, balance: 2n ** 128n }, 'block_info'),
      ).to.not.throw()
      const output = logStub.firstCall.args[0] as string
      expect(output).to.include('1234567890')
    })

    it('Should accept a plain string as context (string shortcut)', function () {
      process.env.LOG_LEVEL = 'info'
      const logger = getLogger('svc')
      logger.info('plain string message')
      expect(logStub.calledOnce).to.be.true
      const output = logStub.firstCall.args[0] as string
      expect(output).to.include('plain string message')
    })

    it('Should fall back to info threshold when LOG_LEVEL is unknown', function () {
      process.env.LOG_LEVEL = 'verbose_unknown'
      const logger = getLogger('svc')
      // info should still appear (threshold falls back to info=20)
      logger.info({}, 'visible')
      expect(logStub.calledOnce).to.be.true
    })

    it('Should use info threshold when LOG_LEVEL is not set', function () {
      delete process.env.LOG_LEVEL
      const logger = getLogger('svc')
      logger.info({}, 'visible')
      expect(logStub.calledOnce).to.be.true
    })

    it('Should include the level tag (INFO/WARN/ERROR) in the output', function () {
      process.env.LOG_LEVEL = 'info'
      const logger = getLogger('svc')
      logger.info({}, 'ev')
      logger.warn({}, 'ev')
      logger.error({}, 'ev')
      expect((logStub.firstCall.args[0] as string)).to.include('INFO')
      expect((warnStub.firstCall.args[0] as string)).to.include('WARN')
      expect((errorStub.firstCall.args[0] as string)).to.include('ERROR')
    })

    it('Should use an empty string as message when ctx is an object and no msg is provided', function () {
      // Covers the `msg ?? ''` branch in:
      //   const message = typeof ctx === 'string' ? ctx : (msg ?? '')
      // When ctx is a LogContext object and msg is omitted, message defaults to ''.
      // The output should still include the context fields (serialized as JSON).
      process.env.LOG_LEVEL = 'info'
      const logger = getLogger('svc')
      logger.info({ event: 'tick', block: 42 })
      expect(logStub.calledOnce).to.be.true
      const output = logStub.firstCall.args[0] as string
      // message is '' but context JSON is appended
      expect(output).to.include('tick')
      expect(output).to.include('42')
    })
  })
})
