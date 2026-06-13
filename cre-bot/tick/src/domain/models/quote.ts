import type { Address, Hex } from 'viem'

/** Inbound request the bot hands to a `QuoteProviderPort`. */
export type QuoteRequest = {
	tokenIn: Address
	tokenOut: Address
	amountIn: bigint
	swapper: Address
	slippageBps: number
}

/**
 * Routed-swap calldata returned by a quote provider. `to`/`data`/`value`
 * are forwarded verbatim through `StreamVaults.executeSwap`; the bot
 * builds and signs the outer transaction itself.
 */
export type QuoteResult = {
	to: Address
	data: Hex
	value: bigint
	minAmountOut: bigint
}
