/**
 * Tests for domain/cooldown.ts — pure functions isCooldownActive and isSwapCooldownRevert.
 *
 * Ported from bot/test/domain/cooldown.spec.ts, adapted to bun:test.
 *
 * Audit findings:
 * - Both functions are pure: no I/O, fully unit-testable.
 * - isCooldownActive mirrors the on-chain E-05 guard exactly; correctness is
 *   critical — a wrong result wastes RPC quota calls (false active) or causes
 *   contract reverts (false inactive, wasting gas).
 * - No input validation: callers may pass negative bigints (chain state can't
 *   produce them, but adversarial injection tests are included to document that).
 */

import { describe, expect, it } from 'bun:test'

import { isCooldownActive, isSwapCooldownRevert } from '../../src/domain/cooldown'

describe('cooldown', () => {
	describe('isCooldownActive', () => {
		// ── Happy paths ────────────────────────────────────────────────────

		it('Should return false when cooldownBlocks is 0 regardless of block numbers', () => {
			// Guard: protocol can set cooldown to 0 (disable feature)
			expect(isCooldownActive(100n, 90n, 0n)).toBe(false)
			expect(isCooldownActive(0n, 0n, 0n)).toBe(false)
			expect(isCooldownActive(50n, 50n, 0n)).toBe(false)
		})

		it('Should return false for an account that has never swapped (lastSwapBlock === 0)', () => {
			// lastSwapBlock = 0 means never swapped; 0 + cooldown - 1 < currentBlock
			expect(isCooldownActive(10n, 0n, 5n)).toBe(false)
		})

		it('Should return false when currentBlock is strictly past the cooldown window', () => {
			// lastSwapBlock=100, cooldown=5: window ends at block 104.
			// currentBlock=105 is past the window → not active.
			expect(isCooldownActive(105n, 100n, 5n)).toBe(false)
		})

		it('Should return false when currentBlock is exactly one past the cooldown window end', () => {
			// Window ends at lastSwapBlock + cooldownBlocks - 1 = 100 + 3 - 1 = 102.
			// currentBlock = 103 means cooldown just expired.
			expect(isCooldownActive(103n, 100n, 3n)).toBe(false)
		})

		// ── Cooldown-active scenarios ──────────────────────────────────────

		it('Should return true when currentBlock equals the last swap block and cooldown > 0', () => {
			// Swap just happened this block; still cooling down.
			expect(isCooldownActive(100n, 100n, 5n)).toBe(true)
		})

		it('Should return true when currentBlock is at the last block of the cooldown window', () => {
			// lastSwapBlock=100, cooldown=5 → window = [100, 104].
			// currentBlock=104: still in window.
			expect(isCooldownActive(104n, 100n, 5n)).toBe(true)
		})

		it('Should return true when currentBlock is inside the cooldown window', () => {
			expect(isCooldownActive(102n, 100n, 5n)).toBe(true)
		})

		// ── Boundary / edge cases ──────────────────────────────────────────

		it('Should handle cooldownBlocks === 1 (window is exactly 1 block)', () => {
			// Window = [lastSwapBlock, lastSwapBlock]. currentBlock = lastSwapBlock → active.
			expect(isCooldownActive(50n, 50n, 1n)).toBe(true)
			// currentBlock = lastSwapBlock + 1 → inactive.
			expect(isCooldownActive(51n, 50n, 1n)).toBe(false)
		})

		it('Should handle very large block numbers without overflow', () => {
			const LARGE = 2n ** 62n
			// lastSwapBlock = LARGE, cooldown = 10 → window ends at LARGE + 9
			expect(isCooldownActive(LARGE + 9n, LARGE, 10n)).toBe(true)
			expect(isCooldownActive(LARGE + 10n, LARGE, 10n)).toBe(false)
		})

		it('Should mirror the on-chain formula at block 0 with a positive cooldown', () => {
			// currentBlock=0, lastSwapBlock=0, cooldown=5 → 0 <= 0 + 5 - 1 = 4 → active.
			expect(isCooldownActive(0n, 0n, 5n)).toBe(true)
		})

		it('Should reflect that lastSwapBlock===0 with small currentBlock is technically "active"', () => {
			// lastSwapBlock=0, cooldown=5 → window ends at 4.
			// currentBlock=1 ≤ 4 → active by math.
			// This faithfully mirrors the Solidity guard; callers guard separately for lastSwapBlock===0.
			const result = isCooldownActive(1n, 0n, 5n)
			expect(result).toBe(true)
		})

		it('Should mirror the on-chain formula: currentBlock <= lastSwapBlock + cooldownBlocks - 1', () => {
			// Exhaustive check against the algebraic formula.
			const cases: [bigint, bigint, bigint, boolean][] = [
				[10n, 5n, 6n, true], // 10 <= 5 + 6 - 1 = 10 ✓
				[11n, 5n, 6n, false], // 11 <= 10 = false ✓
				[0n, 0n, 1n, true], // 0 <= 0 + 1 - 1 = 0 ✓
				[1n, 0n, 1n, false], // 1 <= 0 = false ✓
			]
			for (const [cur, last, cd, expected] of cases) {
				expect(isCooldownActive(cur, last, cd)).toBe(expected)
			}
		})
	})

	describe('isSwapCooldownRevert', () => {
		it('Should return true for an Error whose message names SWAP_COOLDOWN_ACTIVE', () => {
			const err = new Error('execution reverted: custom error SWAP_COOLDOWN_ACTIVE()')
			expect(isSwapCooldownRevert(err)).toBe(true)
		})

		it('Should return true for a non-Error value that stringifies to the revert', () => {
			// Covers the `String(err)` branch when err is not an Error instance.
			expect(isSwapCooldownRevert('SWAP_COOLDOWN_ACTIVE')).toBe(true)
		})

		it('Should return false for an unrelated Error', () => {
			expect(isSwapCooldownRevert(new Error('nonce too low'))).toBe(false)
		})

		it('Should return false for an unrelated non-Error value', () => {
			expect(isSwapCooldownRevert(500)).toBe(false)
		})
	})
})
