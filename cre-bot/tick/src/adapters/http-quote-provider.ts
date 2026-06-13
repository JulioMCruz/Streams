import { create } from '@bufbuild/protobuf'
import {
	consensusIdenticalAggregation,
	type HTTPClient,
	type HTTPSendRequester,
	json,
	ok,
	type Runtime,
} from '@chainlink/cre-sdk'
import { HTTP_CLIENT_PB } from '@chainlink/cre-sdk/pb'
import { stringToBytes } from 'viem'

import type { QuoteRequest, QuoteResult } from '../domain/models/quote'
import type { QuoteProviderPort } from '../ports/quote-provider-port'
import type { WorkflowConfig } from '../settings/config'

/** Consensus-safe (string-only) projection of a QuoteResult. bigints aren't
 * JSON-serialisable, so the node-mode fn returns strings and the adapter
 * converts after consensus. An empty `to` means "no executable route". */
type RawQuote = { to: string; data: string; value: string; minAmountOut: string }
const NO_ROUTE: RawQuote = { to: '', data: '', value: '0', minAmountOut: '0' }

/**
 * CRE replacement for `uniswap-quote-provider.ts` (Uniswap Trading API).
 *
 * Baseline: two `fetch` calls (`/v1/quote` then `/v1/swap`) in the Node loop.
 * CRE: the same two calls run inside `http.sendRequest`'s node-mode callback —
 * every DON node fetches and the results are reconciled by consensus. Because
 * the swap calldata must match across nodes, we use identical-aggregation.
 *
 * ⚠️ CAVEATS (tracked, not blocking the wiring):
 *  - Identical consensus on live routed calldata is fragile (nodes may quote at
 *    slightly different times). Production should pin a block/quote or front a
 *    deterministic router. The bot's `minAmountOut` floor still guards slippage.
 *  - The API key is a secret: wire `runtime.getSecret('UNISWAP_API_KEY')` and
 *    add it as `x-api-key`. The labs gateway works keyless for the demo (the
 *    baseline treats the key as optional), so it is omitted here for now.
 */
export class HttpQuoteProvider implements QuoteProviderPort {
	constructor(
		private readonly runtime: Runtime<unknown>,
		private readonly http: HTTPClient,
		private readonly cfg: WorkflowConfig,
	) {}

	async fetchQuote(req: QuoteRequest): Promise<QuoteResult | null> {
		const apiBase = this.cfg.uniswapApiBase
		const chainId = this.cfg.chainId
		// The API expects slippageTolerance as a JSON number (percent).
		const slippagePercent = req.slippageBps / 100

		const fetchRoute = (sendRequester: HTTPSendRequester): RawQuote => {
			const headers: Record<string, string> = {
				'content-type': 'application/json',
			}
			// The labs gateway now returns 401 without the key (matches the bot's
			// `x-api-key` header). Empty key -> keyless attempt (back-compat).
			if (this.cfg.uniswapApiKey) headers['x-api-key'] = this.cfg.uniswapApiKey

			const post = (path: string, payload: unknown) =>
				sendRequester
					.sendRequest(
						create(HTTP_CLIENT_PB.RequestSchema, {
							url: `${apiBase}${path}`,
							method: 'POST',
							headers,
							body: stringToBytes(JSON.stringify(payload)),
						}),
					)
					.result()

			const quoteResp = post('/v1/quote', {
				type: 'EXACT_INPUT',
				tokenInChainId: chainId,
				tokenOutChainId: chainId,
				tokenIn: req.tokenIn,
				tokenOut: req.tokenOut,
				amount: req.amountIn.toString(),
				swapper: req.swapper,
				slippageTolerance: slippagePercent,
				routingPreference: 'BEST_PRICE',
			})
			if (!ok(quoteResp)) return NO_ROUTE

			const quote = json(quoteResp) as {
				quote?: { output?: { minimumAmount?: string } } & Record<string, unknown>
			}

			const minAmountOut = quote.quote?.output?.minimumAmount ?? '0'
			// A missing floor would disable the on-chain slippage check — refuse.
			if (minAmountOut === '0') return NO_ROUTE

			const swapResp = post('/v1/swap', {
				quote: quote.quote,
				simulateTransaction: false,
			})
			if (!ok(swapResp)) return NO_ROUTE

			const swap = json(swapResp) as {
				swap?: { to?: string; data?: string; value?: string }
			}
			if (!swap.swap?.to || !swap.swap.data) return NO_ROUTE

			return {
				to: swap.swap.to,
				data: swap.swap.data,
				value: swap.swap.value ?? '0',
				minAmountOut,
			}
		}

		const raw = this.http
			.sendRequest(this.runtime, fetchRoute, consensusIdenticalAggregation<RawQuote>())()
			.result()

		if (!raw.to || !raw.data) return null
		return {
			to: raw.to as `0x${string}`,
			data: raw.data as `0x${string}`,
			value: BigInt(raw.value),
			minAmountOut: BigInt(raw.minAmountOut),
		}
	}
}
