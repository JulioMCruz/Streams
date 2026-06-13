/**
 * Tests for domain/stream-guard.ts — pure function shouldCloseStream.
 *
 * Audit findings:
 * - Function is pure: no I/O, fully unit-testable.
 * - Mirrors the on-chain guard inside StreamVaults.closeStreamIfLow;
 *   correctness is critical — a wrong result either spends a gas transaction
 *   unnecessarily (false positive) or misses a buffer-near-zero stream,
 *   causing the Superfluid liquidation penalty (false negative).
 * - deposit <= 0 short-circuits to false, covering the "no stream" case
 *   (Superfluid never sets deposit to a negative number, but the guard is
 *   defensive against it all the same).
 * - The trigger formula is: deposit * thresholdBps / 10_000n (integer
 *   division); availableBalance <= trigger → close.
 * - boundary: availableBalance === trigger returns true (close).
 * - boundary: availableBalance === trigger + 1n returns false (healthy).
 */

import { expect } from 'chai'

import { shouldCloseStream } from '../../src/domain/stream-guard.js'

describe('stream-guard', function () {
	describe('shouldCloseStream', function () {
		// ── No active stream (deposit === 0) ───────────────────────────────

		it('Should return false when deposit is 0 (no active stream)', function () {
			expect(
				shouldCloseStream({ availableBalance: 100n, deposit: 0n }, 1000n),
			).to.be.false
		})

		it('Should return false when deposit is negative (defensive; Superfluid never emits this)', function () {
			// deposit < 0 is caught by the deposit <= 0n guard
			expect(
				shouldCloseStream({ availableBalance: 100n, deposit: -1n }, 1000n),
			).to.be.false
		})

		it('Should return false when both deposit and availableBalance are 0', function () {
			expect(
				shouldCloseStream({ availableBalance: 0n, deposit: 0n }, 1000n),
			).to.be.false
		})

		// ── thresholdBps = 0 (feature disabled) ───────────────────────────

		it('Should return false when thresholdBps is 0 (trigger = 0n, balance > 0 is healthy)', function () {
			// trigger = deposit * 0 / 10_000 = 0; availableBalance=1 > 0 → false
			expect(
				shouldCloseStream({ availableBalance: 1n, deposit: 1_000n }, 0n),
			).to.be.false
		})

		it('Should return true when thresholdBps is 0 and availableBalance is 0 (exactly at trigger)', function () {
			// trigger = 0; availableBalance = 0 ≤ 0 → true
			expect(
				shouldCloseStream({ availableBalance: 0n, deposit: 1_000n }, 0n),
			).to.be.true
		})

		it('Should return true when thresholdBps is 0 and availableBalance is negative', function () {
			// trigger = 0; availableBalance = -1 ≤ 0 → true
			expect(
				shouldCloseStream({ availableBalance: -1n, deposit: 1_000n }, 0n),
			).to.be.true
		})

		// ── thresholdBps = 10000 (trigger = full deposit) ─────────────────

		it('Should return true when thresholdBps is 10000 and availableBalance is less than deposit', function () {
			// trigger = deposit * 10000 / 10000 = deposit = 1_000n
			// availableBalance = 999 ≤ 1000 → true
			expect(
				shouldCloseStream({ availableBalance: 999n, deposit: 1_000n }, 10_000n),
			).to.be.true
		})

		it('Should return true when thresholdBps is 10000 and availableBalance equals deposit (trigger)', function () {
			// trigger = deposit = 1000; 1000 ≤ 1000 → true
			expect(
				shouldCloseStream({ availableBalance: 1_000n, deposit: 1_000n }, 10_000n),
			).to.be.true
		})

		it('Should return false when thresholdBps is 10000 and availableBalance exceeds deposit', function () {
			// trigger = 1000; availableBalance = 1001 > 1000 → false
			expect(
				shouldCloseStream({ availableBalance: 1_001n, deposit: 1_000n }, 10_000n),
			).to.be.false
		})

		// ── Standard threshold (1000 bps = 10%) ───────────────────────────

		it('Should return true when availableBalance is below the 10% trigger', function () {
			// deposit=10_000n, threshold=1000bps → trigger = 10_000 * 1000 / 10_000 = 1_000n
			// availableBalance=999 ≤ 1000 → true
			expect(
				shouldCloseStream({ availableBalance: 999n, deposit: 10_000n }, 1_000n),
			).to.be.true
		})

		it('Should return true when availableBalance exactly equals the trigger (boundary inclusive)', function () {
			// deposit=10_000n, threshold=1000bps → trigger = 1_000n
			// availableBalance=1000 ≤ 1000 → true
			expect(
				shouldCloseStream({ availableBalance: 1_000n, deposit: 10_000n }, 1_000n),
			).to.be.true
		})

		it('Should return false when availableBalance is exactly one above the trigger (boundary exclusive)', function () {
			// deposit=10_000n, threshold=1000bps → trigger = 1_000n
			// availableBalance=1001 > 1000 → false
			expect(
				shouldCloseStream({ availableBalance: 1_001n, deposit: 10_000n }, 1_000n),
			).to.be.false
		})

		it('Should return false when availableBalance is well above the trigger (healthy stream)', function () {
			// deposit=10_000n, threshold=1000bps → trigger = 1_000n
			// availableBalance=50_000 ≫ 1000 → false
			expect(
				shouldCloseStream({ availableBalance: 50_000n, deposit: 10_000n }, 1_000n),
			).to.be.false
		})

		// ── Negative availableBalance (critical / insolvent) ──────────────

		it('Should return true when availableBalance is negative (stream near liquidation)', function () {
			// deposit=10_000n, threshold=1000bps → trigger=1000; -1 ≤ 1000 → true
			expect(
				shouldCloseStream({ availableBalance: -1n, deposit: 10_000n }, 1_000n),
			).to.be.true
		})

		it('Should return true when availableBalance is very negative', function () {
			expect(
				shouldCloseStream({ availableBalance: -9_999_999n, deposit: 10_000n }, 500n),
			).to.be.true
		})

		// ── Integer division truncation ────────────────────────────────────

		it('Should truncate the trigger via integer division (not round)', function () {
			// deposit=10_001n, threshold=1000bps → trigger = 10_001 * 1000 / 10_000
			//   = 10_001_000 / 10_000 = 1000 (truncated, not 1000.1)
			// availableBalance=1000 ≤ 1000 → true
			expect(
				shouldCloseStream({ availableBalance: 1_000n, deposit: 10_001n }, 1_000n),
			).to.be.true
		})

		// ── Large bigint values (production scale) ────────────────────────

		it('Should handle Superfluid-scale bigint values without overflow', function () {
			// A realistic USDCx deposit: 4 hours of 0.01 USDCx/s
			//   = 4 * 3600 * 10^18 = 1.44e22 ~ 14_400_000_000_000_000_000_000n
			const deposit = 14_400_000_000_000_000_000_000n
			const threshold = 1_000n // 10%
			// trigger = 1_440_000_000_000_000_000_000n
			// availableBalance just at trigger → true
			const trigger = (deposit * threshold) / 10_000n
			expect(
				shouldCloseStream({ availableBalance: trigger, deposit }, threshold),
			).to.be.true
			// one above → false
			expect(
				shouldCloseStream({ availableBalance: trigger + 1n, deposit }, threshold),
			).to.be.false
		})

		// ── Formula consistency check ─────────────────────────────────────

		it('Should mirror the formula: availableBalance <= deposit * thresholdBps / 10000', function () {
			// Exhaustive check against the algebraic formula.
			const cases: [bigint, bigint, bigint, boolean][] = [
				[500n, 10_000n, 500n, true],    // trigger=500; 500<=500 → true
				[501n, 10_000n, 500n, false],   // trigger=500; 501>500 → false
				[0n, 10_000n, 500n, true],      // trigger=500; 0<=500 → true
				[4_999n, 50_000n, 1_000n, true], // trigger=5000; 4999<=5000 → true
				[5_000n, 50_000n, 1_000n, true], // trigger=5000; 5000<=5000 → true
				[5_001n, 50_000n, 1_000n, false], // trigger=5000; 5001>5000 → false
			]
			for (const [avail, deposit, bps, expected] of cases) {
				expect(shouldCloseStream({ availableBalance: avail, deposit }, bps)).to.equal(
					expected,
					`shouldCloseStream({ availableBalance: ${avail}, deposit: ${deposit} }, ${bps}) should be ${expected}`,
				)
			}
		})
	})
})
