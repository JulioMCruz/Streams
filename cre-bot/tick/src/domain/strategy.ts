/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import type { Address } from 'viem'

import type { SmartAccountState } from './models/smart-account'
import type { SwapDecision } from './models/swap'

/**
 * Token wiring the strategy needs to translate a SuperToken balance into
 * an underlying swap. Injected (not hardcoded) so the same pure function
 * works across networks — the concrete addresses live in `settings/config`.
 */
export type StrategyTokens = {
	/** Streamed SuperToken held by the smart account (e.g. USDCx, 18 dec). */
	superTokenIn: Address
	/** Underlying token the SuperToken downgrades into (e.g. USDC, 6 dec). */
	tokenIn: Address
	/**
	 * SuperToken → underlying divisor. Superfluid preserves value 1:1
	 * across decimals, so for USDCx(18)→USDC(6) this is `10n ** 12n`.
	 */
	superToUnderlyingDivisor: bigint
}

/**
 * Pure DCA strategy: given a smart account's on-chain rules and its
 * current SuperToken balance, decide whether to trade and what the swap
 * looks like. No I/O — every input is passed in, so this is fully unit
 * testable without a chain.
 *
 * Fase 8a strategy is deliberately trivial: pick the first whitelisted
 * target, downgrade the entire SuperToken balance, swap the resulting
 * underlying. The CRE workflow (Fase 8b) replaces this body with config
 * reads + Chainlink Data Feeds; the signature stays the same.
 *
 * Returns `null` when there is nothing to do (no targets, or the
 * underlying-equivalent balance is below the user's `minTradeAmount`).
 */
/* c8 ignore next -- function-declaration branch inserted by V8; not reachable from tests */
export function decideSwap(
	state: SmartAccountState,
	superBalance: bigint,
	tokens: StrategyTokens,
): SwapDecision | null {
	if (state.targetTokens.length === 0) return null

	// Trade 90% of the balance, not 100%. The SuperToken balance keeps moving
	// between the read, the quote fetch and the on-chain submit; leaving a 10%
	// headroom means a slightly lower balance at execution still covers the
	// atomic downgrade. Without it, `superAmountIn` can exceed the live balance
	// at execution and the downgrade reverts (insufficient balance).
	const superAmountIn = (superBalance * 9000n) / 10_000n

	// Convert SuperToken amount to underlying-equivalent for the minTrade
	// check; the actual downgrade happens atomically inside SmartAccountDCA at
	// execution time.
	const underlyingAmountIn = superAmountIn / tokens.superToUnderlyingDivisor
	if (underlyingAmountIn < state.minTradeAmount) return null

	const tokenOut = state.targetTokens[0]
	if (!tokenOut) return null

	return {
		smartAccount: state.smartAccount,
		superTokenIn: tokens.superTokenIn,
		superAmountIn,
		tokenIn: tokens.tokenIn,
		tokenOut,
		underlyingAmountIn,
		maxSlippageBps: state.maxSlippageBps,
	}
}
