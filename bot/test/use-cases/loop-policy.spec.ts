/**
 * Tests for use-cases/loop-policy.ts — backoffDelayMs + TickCircuitBreaker.
 *
 * Audit findings (H-05):
 * - 0 failures → baseMs (normal cadence); each further failure doubles the
 *   wait, clamped at maxMs.
 * - TickCircuitBreaker tracks the consecutive-failure streak: recordFailure
 *   grows it, recordSuccess resets it, isOpen flips once the streak reaches
 *   maxConsecutiveFailures.
 */

import { expect } from 'chai'

import {
  backoffDelayMs,
  type BackoffPolicy,
  TickCircuitBreaker,
} from '../../src/use-cases/loop-policy.js'

const policy: BackoffPolicy = {
  baseMs: 1000,
  maxMs: 8000,
  maxConsecutiveFailures: 3,
}

describe('use-cases/loop-policy', function () {
  describe('backoffDelayMs', function () {
    it('Should return baseMs when there are no failures', function () {
      expect(backoffDelayMs(0, policy)).to.equal(1000)
    })

    it('Should return baseMs for a non-positive failure count', function () {
      expect(backoffDelayMs(-2, policy)).to.equal(1000)
    })

    it('Should return baseMs for the first failure (2^0)', function () {
      expect(backoffDelayMs(1, policy)).to.equal(1000)
    })

    it('Should double the delay with each additional failure', function () {
      expect(backoffDelayMs(2, policy)).to.equal(2000)
      expect(backoffDelayMs(3, policy)).to.equal(4000)
    })

    it('Should clamp the delay at maxMs', function () {
      // 2^(10-1) * 1000 ≫ 8000 → clamped.
      expect(backoffDelayMs(10, policy)).to.equal(8000)
    })
  })

  describe('TickCircuitBreaker', function () {
    let breaker: TickCircuitBreaker

    beforeEach(function () {
      breaker = new TickCircuitBreaker(policy)
    })

    it('Should start healthy: zero failures, baseMs delay, closed', function () {
      expect(breaker.consecutiveFailures).to.equal(0)
      expect(breaker.nextDelayMs()).to.equal(1000)
      expect(breaker.isOpen()).to.be.false
    })

    it('Should grow the failure streak and the backoff delay', function () {
      breaker.recordFailure()
      expect(breaker.consecutiveFailures).to.equal(1)
      expect(breaker.nextDelayMs()).to.equal(1000)
      breaker.recordFailure()
      expect(breaker.consecutiveFailures).to.equal(2)
      expect(breaker.nextDelayMs()).to.equal(2000)
    })

    it('Should report open once the streak reaches maxConsecutiveFailures', function () {
      breaker.recordFailure()
      breaker.recordFailure()
      expect(breaker.isOpen()).to.be.false
      breaker.recordFailure()
      expect(breaker.isOpen()).to.be.true
    })

    it('Should reset the streak on success', function () {
      breaker.recordFailure()
      breaker.recordFailure()
      breaker.recordSuccess()
      expect(breaker.consecutiveFailures).to.equal(0)
      expect(breaker.nextDelayMs()).to.equal(1000)
      expect(breaker.isOpen()).to.be.false
    })
  })
})
