/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import type { QuoteRequest, QuoteResult } from '../domain/models/quote'
import type { QuoteProviderPort } from '../ports/quote-provider-port'
import { getLogger, type Logger } from '../utils/logger'

export interface UniswapQuoteProviderDeps {
	readonly apiBase: string
	readonly apiKey: string
	readonly chainId: number
	readonly logger?: Logger
}

/**
 * Driven adapter — Uniswap Trading API quote provider. Two-step:
 * `POST /v1/quote` to price the route, then `POST /v1/swap` to get the
 * routed calldata the bot forwards through `StreamVaults.executeSwap`.
 *
 * NOTE: The Trading API has limited testnet coverage. If `/v1/quote`
 * fails on Base Sepolia, switch the protocol deployment to Base mainnet
 * for the demo — the adapter code is unchanged.
 */
export class UniswapQuoteProvider implements QuoteProviderPort {
	private readonly logger: Logger

	constructor(private readonly deps: UniswapQuoteProviderDeps) {
		this.logger = deps.logger ?? getLogger('uniswap-quote-provider')
	}

	async fetchQuote(req: QuoteRequest): Promise<QuoteResult | null> {
		// The Trading API expects `slippageTolerance` as a JSON number
		// (percent), not a string — sending a string returns 400
		// RequestValidationError.
		const slippagePercent = req.slippageBps / 100

		const headers: Record<string, string> = {
			'content-type': 'application/json',
		}
		if (this.deps.apiKey) {
			headers['x-api-key'] = this.deps.apiKey
		}

		const body = {
			type: 'EXACT_INPUT',
			tokenInChainId: this.deps.chainId,
			tokenOutChainId: this.deps.chainId,
			tokenIn: req.tokenIn,
			tokenOut: req.tokenOut,
			amount: req.amountIn.toString(),
			swapper: req.swapper,
			slippageTolerance: slippagePercent,
			// This gateway's enum is [BEST_PRICE, FASTEST] (not CLASSIC/UNISWAPX).
			routingPreference: 'BEST_PRICE',
		}

		const quoteRes = await fetch(`${this.deps.apiBase}/v1/quote`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
		})
		if (!quoteRes.ok) {
			this.logger.warn(
				{ status: quoteRes.status, detail: await quoteRes.text() },
				'uniswap_quote_failed',
			)
			return null
		}
		// `quote.quote` is the nested quote object forwarded verbatim to
		// /v1/swap. The output amount + its slippage-adjusted floor live in
		// `quote.quote.output` (the API already applies `slippageTolerance`).
		const quote = (await quoteRes.json()) as {
			quote?: {
				output?: { amount?: string; minimumAmount?: string }
			} & Record<string, unknown>
			requestId?: string
		}

		const swapRes = await fetch(`${this.deps.apiBase}/v1/swap`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ quote: quote.quote, simulateTransaction: false }),
		})
		if (!swapRes.ok) {
			this.logger.warn(
				{ status: swapRes.status, detail: await swapRes.text() },
				'uniswap_swap_failed',
			)
			return null
		}
		const swap = (await swapRes.json()) as {
			swap?: { to?: `0x${string}`; data?: `0x${string}`; value?: string }
		}

		if (!swap.swap?.to || !swap.swap.data) {
			this.logger.warn({}, 'uniswap_swap_missing_to_or_data')
			return null
		}

		// Use the API's slippage-adjusted floor directly — it already
		// reflects the `slippageTolerance` we sent (= the user's maxSlippageBps).
		// This is the defense-in-depth `minAmountOut` the SmartAccountDCA
		// enforces on the realized balance delta. A missing value (`0`) would
		// DISABLE that check (`require amountOut >= 0` is always true), leaving
		// the swap fully exposed to sandwich/MEV. We refuse to trade without a
		// floor: skip and let the next tick retry with a fresh quote (H-01).
		const minAmountOut = BigInt(quote.quote?.output?.minimumAmount ?? '0')
		if (minAmountOut === 0n) {
			this.logger.warn(
				{ tokenIn: req.tokenIn, tokenOut: req.tokenOut },
				'uniswap_quote_missing_minimum_amount_skipping',
			)
			return null
		}

		return {
			to: swap.swap.to,
			data: swap.swap.data,
			value: BigInt(swap.swap.value ?? '0'),
			minAmountOut,
		}
	}
	/* c8 ignore next -- class-closing brace branch inserted by V8; not reachable */
}
