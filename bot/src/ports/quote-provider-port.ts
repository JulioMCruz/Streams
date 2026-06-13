import type { QuoteRequest, QuoteResult } from '../domain/models/quote'

/**
 * Driven port — turns a desired swap into routed calldata. The baseline
 * adapter calls the Uniswap Trading API; any router (1inch, 0x, a CRE
 * data source) can implement the same contract.
 *
 * Returns `null` when no executable route is available, so the use case
 * can skip the account instead of throwing.
 */
export interface QuoteProviderPort {
	fetchQuote(request: QuoteRequest): Promise<QuoteResult | null>
}
