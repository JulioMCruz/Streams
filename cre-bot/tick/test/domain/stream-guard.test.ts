/**
 * Tests for domain/stream-guard.ts — pure function shouldCloseStream.
 *
 * Ported from bot/test/domain/stream-guard.spec.ts, adapted to bun:test.
 *
 * Audit findings:
 * - Function is pure: no I/O, fully unit-testable.
 * - Mirrors the on-chain guard inside StreamVaults.closeStreamIfLow; correctness
 *   is critical — a false positive spends gas, a false negative causes Superfluid
 *   liquidation penalty.
 * - deposit <= 0 short-circuits to false (defensive against Superfluid).
 * - trigger formula: deposit * thresholdBps / 10_000n (integer division).
 * - availableBalance <= trigger → close (boundary: === is inclusive).
 */

import { describe, expect, it } from 'bun:test'

import { shouldCloseStream } from '../../src/domain/stream-guard'

describe('stream-guard', () => {
	describe('shouldCloseStream', () => {
		// ── No active stream (deposit === 0) ───────────────────────────────

		it('Should return false when deposit is 0 (no active stream)', () => {
			expect(shouldCloseStream({ availableBalance: 100n, deposit: 0n }, 1000n)).toBe(false)
		})

		it('Should return false when deposit is negative (defensive; Superfluid never emits this)', () => {
			// deposit < 0 is caught by the deposit <= 0n guard
			expect(shouldCloseStream({ availableBalance: 100n, deposit: -1n }, 1000n)).toBe(false)
		})

		it('Should return false when both deposit and availableBalance are 0', () => {
			expect(shouldCloseStream({ availableBalance: 0n, deposit: 0n }, 1000n)).toBe(false)
		})

		// ── thresholdBps = 0 (feature disabled) ───────────────────────────

		it('Should return false when thresholdBps is 0 and availableBalance > 0', () => {
			// trigger = deposit * 0 / 10_000 = 0; availableBalance=1 > 0 → false
			expect(shouldCloseStream({ availableBalance: 1n, deposit: 1_000n }, 0n)).toBe(false)
		})

		it('Should return true when thresholdBps is 0 and availableBalance is 0 (at trigger)', () => {
			// trigger = 0; availableBalance = 0 ≤ 0 → true
			expect(shouldCloseStream({ availableBalance: 0n, deposit: 1_000n }, 0n)).toBe(true)
		})

		it('Should return true when thresholdBps is 0 and availableBalance is negative', () => {
			// trigger = 0; availableBalance = -1 ≤ 0 → true
			expect(shouldCloseStream({ availableBalance: -1n, deposit: 1_000n }, 0n)).toBe(true)
		})

		// ── thresholdBps = 10000 (trigger = full deposit) ─────────────────

		it('Should return true when thresholdBps is 10000 and availableBalance < deposit', () => {
			// trigger = deposit * 10000 / 10000 = deposit = 1_000n; 999 ≤ 1000 → true
			expect(shouldCloseStream({ availableBalance: 999n, deposit: 1_000n }, 10_000n)).toBe(true)
		})

		it('Should return true when thresholdBps is 10000 and availableBalance equals deposit', () => {
			// trigger = 1000; 1000 ≤ 1000 → true
			expect(shouldCloseStream({ availableBalance: 1_000n, deposit: 1_000n }, 10_000n)).toBe(true)
		})

		it('Should return false when thresholdBps is 10000 and availableBalance exceeds deposit', () => {
			// trigger = 1000; 1001 > 1000 → false
			expect(shouldCloseStream({ availableBalance: 1_001n, deposit: 1_000n }, 10_000n)).toBe(false)
		})

		// ── Standard threshold (1000 bps = 10%) ───────────────────────────

		it('Should return true when availableBalance is below the 10% trigger', () => {
			// deposit=10_000n, threshold=1000bps → trigger=1_000n; 999 ≤ 1000 → true
			expect(shouldCloseStream({ availableBalance: 999n, deposit: 10_000n }, 1_000n)).toBe(true)
		})

		it('Should return true when availableBalance exactly equals the trigger (boundary inclusive)', () => {
			// deposit=10_000n, threshold=1000bps → trigger=1_000n; 1000 ≤ 1000 → true
			expect(shouldCloseStream({ availableBalance: 1_000n, deposit: 10_000n }, 1_000n)).toBe(true)
		})

		it('Should return false when availableBalance is exactly one above the trigger (boundary exclusive)', () => {
			// deposit=10_000n, threshold=1000bps → trigger=1_000n; 1001 > 1000 → false
			expect(shouldCloseStream({ availableBalance: 1_001n, deposit: 10_000n }, 1_000n)).toBe(false)
		})

		it('Should return false when availableBalance is well above the trigger (healthy stream)', () => {
			// deposit=10_000n, threshold=1000bps → trigger=1_000n; 50_000 ≫ 1000 → false
			expect(shouldCloseStream({ availableBalance: 50_000n, deposit: 10_000n }, 1_000n)).toBe(false)
		})

		// ── Negative availableBalance (critical / insolvent) ──────────────

		it('Should return true when availableBalance is negative (stream near liquidation)', () => {
			// deposit=10_000n, threshold=1000bps → trigger=1000; -1 ≤ 1000 → true
			expect(shouldCloseStream({ availableBalance: -1n, deposit: 10_000n }, 1_000n)).toBe(true)
		})

		it('Should return true when availableBalance is very negative', () => {
			expect(shouldCloseStream({ availableBalance: -9_999_999n, deposit: 10_000n }, 500n)).toBe(true)
		})

		// ── Integer division truncation ────────────────────────────────────

		it('Should truncate the trigger via integer division (not round)', () => {
			// deposit=10_001n, threshold=1000bps → trigger = 10_001 * 1000 / 10_000
			//   = 10_001_000 / 10_000 = 1000 (truncated, not 1000.1)
			expect(shouldCloseStream({ availableBalance: 1_000n, deposit: 10_001n }, 1_000n)).toBe(true)
		})

		// ── Large bigint values (production scale) ────────────────────────

		it('Should handle Superfluid-scale bigint values without overflow', () => {
			// A realistic USDCx deposit: 4 hours of 0.01 USDCx/s
			//   = 4 * 3600 * 10^18 = 1.44e22
			const deposit = 14_400_000_000_000_000_000_000n
			const threshold = 1_000n // 10%
			const trigger = (deposit * threshold) / 10_000n
			// exactly at trigger → true
			expect(shouldCloseStream({ availableBalance: trigger, deposit }, threshold)).toBe(true)
			// one above → false
			expect(shouldCloseStream({ availableBalance: trigger + 1n, deposit }, threshold)).toBe(false)
		})

		// ── Formula consistency check ─────────────────────────────────────

		it('Should mirror the formula: availableBalance <= deposit * thresholdBps / 10000', () => {
			const cases: [bigint, bigint, bigint, boolean][] = [
				[500n, 10_000n, 500n, true], // trigger=500; 500<=500 → true
				[501n, 10_000n, 500n, false], // trigger=500; 501>500 → false
				[0n, 10_000n, 500n, true], // trigger=500; 0<=500 → true
				[4_999n, 50_000n, 1_000n, true], // trigger=5000; 4999<=5000 → true
				[5_000n, 50_000n, 1_000n, true], // trigger=5000; 5000<=5000 → true
				[5_001n, 50_000n, 1_000n, false], // trigger=5000; 5001>5000 → false
			]
			for (const [avail, deposit, bps, expected] of cases) {
				expect(shouldCloseStream({ availableBalance: avail, deposit }, bps)).toBe(expected)
			}
		})
	})
})
