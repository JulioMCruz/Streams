import type { Address, Hex } from 'viem'

/**
 * The strategy's verdict for one smart account in one tick: what to
 * swap, how much, and the slippage ceiling carried over from the user's
 * on-chain rules. Produced by the pure `decideSwap` domain service.
 */
export type SwapDecision = {
	smartAccount: Address
	superTokenIn: Address
	superAmountIn: bigint
	tokenIn: Address
	tokenOut: Address
	underlyingAmountIn: bigint
	maxSlippageBps: number
}

/**
 * The exact argument shape `StreamVaults.executeSwap` expects. The smart
 * account performs `downgrade → swap → settle to user` atomically; this
 * struct only tells it what target/calldata to forward and the realized
 * `minAmountOut` to enforce.
 */
export type SwapParams = {
	superTokenIn: Address
	superAmountIn: bigint
	tokenIn: Address
	tokenOut: Address
	target: Address
	value: bigint
	data: Hex
	minAmountOut: bigint
}
