import type { Hex } from 'viem'

import type { QuoteResult } from '../domain/models/quote'
import type { SwapDecision } from '../domain/models/swap'

/**
 * Driven port — submits the routed swap on-chain via
 * `StreamVaults.executeSwap`. The baseline adapter signs with the bot
 * hot key; the CRE workflow signer implements the same port.
 *
 * Returns the submitted transaction hash.
 */
export interface SwapExecutorPort {
	executeSwap(decision: SwapDecision, quote: QuoteResult): Promise<Hex>
}
