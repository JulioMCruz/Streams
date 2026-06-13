/**
 * Tests for domain/strategy.ts — pure function decideSwap.
 *
 * Ported from bot/test/domain/strategy.spec.ts, adapted to bun:test.
 *
 * Audit findings:
 * - decideSwap is pure: every dependency is passed in, no side effects.
 * - Critical paths: empty targetTokens, balance below minTradeAmount,
 *   divisor of zero (would cause division-by-zero — currently unchecked).
 * - Adversarial: superToUnderlyingDivisor = 0n causes division by zero.
 */

import { describe, expect, it } from 'bun:test'

import type { SmartAccountState } from '../../src/domain/models/smart-account'
import { decideSwap, type StrategyTokens } from '../../src/domain/strategy'

// ── Shared fixtures ───────────────────────────────────────────────────────────

const WETH = '0x4200000000000000000000000000000000000006' as const
const WBTC = '0x0555E30da8f98308EdB960aa94C0Db47230d2B9' as const
const USDCX = '0x1eFe44b4B786AAF3C6FEDF9B9d0BC0F64E1e60c' as const
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
const SA = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF' as const
const USER = '0xaBcDef0123456789012345678901234567890123' as const

const defaultTokens: StrategyTokens = {
	superTokenIn: USDCX,
	tokenIn: USDC,
	superToUnderlyingDivisor: 10n ** 12n, // USDCx(18) → USDC(6)
}

function makeState(overrides: Partial<SmartAccountState> = {}): SmartAccountState {
	return {
		smartAccount: SA,
		owner: USER,
		operator: USER,
		maxSlippageBps: 100,
		minTradeAmount: 1_000_000n, // 1 USDC (6 dec)
		settlementAddress: USER,
		targetTokens: [WETH],
		...overrides,
	}
}

describe('strategy', () => {
	describe('decideSwap', () => {
		// ── Happy paths ────────────────────────────────────────────────────

		it('Should return a SwapDecision when balance exceeds minTradeAmount', () => {
			const superBalance = 5_000_000_000_000_000_000n // 5 USDCx (18 dec)
			const state = makeState()
			const decision = decideSwap(state, superBalance, defaultTokens)

			expect(decision).not.toBeNull()
			expect(decision!.smartAccount).toBe(SA)
			expect(decision!.superTokenIn).toBe(USDCX)
			// 90% of the balance is traded (10% headroom for the read→execute race).
			expect(decision!.superAmountIn).toBe(4_500_000_000_000_000_000n)
			expect(decision!.tokenIn).toBe(USDC)
			expect(decision!.tokenOut).toBe(WETH)
			expect(decision!.underlyingAmountIn).toBe(4_500_000n) // 90% of 5 USDC
			expect(decision!.maxSlippageBps).toBe(100)
		})

		it('Should pick the first target token from the array', () => {
			const state = makeState({ targetTokens: [WBTC, WETH] })
			const decision = decideSwap(state, 2_000_000_000_000_000_000n, defaultTokens)

			expect(decision).not.toBeNull()
			expect(decision!.tokenOut).toBe(WBTC) // first one wins
		})

		it('Should correctly compute underlyingAmountIn using integer division', () => {
			// 1.5 USDCx = 1_500_000_000_000_000_000 wei; 18-6 = 12 dec divisor
			const superBalance = 1_500_000_000_000_000_000n
			const state = makeState({ minTradeAmount: 1_000_000n })
			const decision = decideSwap(state, superBalance, defaultTokens)

			expect(decision).not.toBeNull()
			// 90% margin then integer division: (1.5e18 * 0.9) / 10^12 = 1_350_000
			expect(decision!.underlyingAmountIn).toBe(1_350_000n)
		})

		it('Should pass maxSlippageBps from state unchanged to the decision', () => {
			const state = makeState({ maxSlippageBps: 300 })
			const decision = decideSwap(state, 5_000_000_000_000_000_000n, defaultTokens)
			expect(decision!.maxSlippageBps).toBe(300)
		})

		// ── Null returns (skip conditions) ────────────────────────────────

		it('Should return null when targetTokens is empty', () => {
			const state = makeState({ targetTokens: [] })
			const decision = decideSwap(state, 5_000_000_000_000_000_000n, defaultTokens)
			expect(decision).toBeNull()
		})

		it('Should return null when underlyingAmountIn is exactly one below minTradeAmount', () => {
			// 0.999_999 USDC < 1_000_000 minTradeAmount → skip
			const superBalance = 999_999_000_000_000_000n // 0.999999 USDCx
			const state = makeState({ minTradeAmount: 1_000_000n })
			const decision = decideSwap(state, superBalance, defaultTokens)
			expect(decision).toBeNull()
		})

		it('Should NOT return null when the margined underlyingAmountIn equals minTradeAmount exactly', () => {
			// 1 USDCx * 0.9 = 0.9 USDC margined; guard `< minTradeAmount` is false
			// at equality, so it passes through.
			const superBalance = 1_000_000_000_000_000_000n // exactly 1 USDCx
			const state = makeState({ minTradeAmount: 900_000n })
			const decision = decideSwap(state, superBalance, defaultTokens)
			expect(decision).not.toBeNull()
		})

		it('Should return null when superBalance is 0', () => {
			const state = makeState()
			const decision = decideSwap(state, 0n, defaultTokens)
			expect(decision).toBeNull()
		})

		it('Should return null when superBalance produces underlyingAmountIn === 0 due to truncation', () => {
			// 999_999 wei of USDCx → underlyingAmountIn = 0 (< 10^12 divisor)
			const superBalance = 999_999n
			const state = makeState({ minTradeAmount: 1n })
			const decision = decideSwap(state, superBalance, defaultTokens)
			// 999_999 / 10^12 = 0 → 0 < 1 = true → null
			expect(decision).toBeNull()
		})

		// ── Edge cases ────────────────────────────────────────────────────

		it('Should handle minTradeAmount === 0 (always trade if underlying > 0)', () => {
			const state = makeState({ minTradeAmount: 0n })
			const decision = decideSwap(state, 10_000_000_000_000n, defaultTokens)
			// underlyingAmountIn = 10_000_000_000_000 / 10^12 = 10 > 0 → proceed
			expect(decision).not.toBeNull()
		})

		it('Should handle a single-token targetTokens array correctly', () => {
			const state = makeState({ targetTokens: [WBTC] })
			const decision = decideSwap(state, 5_000_000_000_000_000_000n, defaultTokens)
			expect(decision!.tokenOut).toBe(WBTC)
		})

		it('Should not mutate the state.targetTokens array', () => {
			const tokens = [WETH, WBTC]
			const state = makeState({ targetTokens: tokens })
			decideSwap(state, 5_000_000_000_000_000_000n, defaultTokens)
			expect(state.targetTokens).toEqual([WETH, WBTC])
		})

		it('Should work with a divisor of 1 (same-decimals token pair)', () => {
			const tokens: StrategyTokens = {
				superTokenIn: USDCX,
				tokenIn: USDC,
				superToUnderlyingDivisor: 1n,
			}
			const state = makeState({ minTradeAmount: 1n })
			const superBalance = 5_000n
			const decision = decideSwap(state, superBalance, tokens)
			// 90% margin: 5_000 * 0.9 = 4_500, divisor 1 → 4_500
			expect(decision!.underlyingAmountIn).toBe(4_500n)
		})

		it('Should propagate superAmountIn as 90% of superBalance (read→execute headroom)', () => {
			const superBalance = 7_500_000_000_000_000_000n
			const state = makeState()
			const decision = decideSwap(state, superBalance, defaultTokens)
			// 7.5e18 * 9000 / 10000 = 6.75e18
			expect(decision!.superAmountIn).toBe(6_750_000_000_000_000_000n)
		})

		// ── Adversarial tests ─────────────────────────────────────────────

		it('Should return null when targetTokens has a falsy first element', () => {
			// The function checks `if (!tokenOut) return null` — empty string is falsy.
			const state = makeState({ targetTokens: ['' as `0x${string}`] })
			const decision = decideSwap(state, 5_000_000_000_000_000_000n, defaultTokens)
			// empty string is falsy → guard returns null
			expect(decision).toBeNull()
		})

		it('Should handle very large superBalance without throwing', () => {
			const MAX_UINT256 = 2n ** 256n - 1n
			const state = makeState({ minTradeAmount: 1n })
			// Should not throw — just compute a large underlyingAmountIn
			expect(() => decideSwap(state, MAX_UINT256, defaultTokens)).not.toThrow()
		})
	})
})
