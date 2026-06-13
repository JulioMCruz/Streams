/**
 * Tests for adapters/http-quote-provider.ts — HttpQuoteProvider.
 *
 * Uses the CRE SDK test harness (HttpActionsMock + newTestRuntime).
 * The adapter calls http.sendRequest in node-mode with consensusIdenticalAggregation.
 * The HttpActionsMock intercepts the SendRequest method on the HTTP capability.
 *
 * Architecture note: HttpQuoteProvider.fetchQuote calls
 *   this.http.sendRequest(runtime, fetchRoute, consensus)()
 * which invokes the node-mode variant of sendRequest. The mock intercepts
 * the inner sendRequest calls emitted by fetchRoute (two per full quote:
 * /v1/quote then /v1/swap). We supply a mock that returns the entire
 * consensus-resolved raw RawQuote via the consensus path.
 *
 * Audit findings:
 * - Returns null when /v1/quote returns a non-2xx response.
 * - Returns null when minAmountOut is '0' (missing slippage floor).
 * - Returns null when /v1/swap returns a non-2xx response.
 * - Returns null when swap.swap.to or swap.swap.data are absent.
 * - Returns null when the consensus result has empty to/data.
 * - BigInt conversion: value and minAmountOut are parsed from strings.
 */

import { HTTPClient } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { HttpActionsMock, newTestRuntime } from '@chainlink/cre-sdk/test'
import { describe, expect } from 'bun:test'

// Proto message types for HttpActionsMock.sendRequest — not in the public SDK API.
// Matches the generated types in @chainlink/cre-sdk internal generated sources.
type Request = {
	url?: string
	method?: string
	headers?: Record<string, string>
	body?: Uint8Array
}

import { HttpQuoteProvider } from '../../src/adapters/http-quote-provider'
import type { QuoteRequest } from '../../src/domain/models/quote'
import type { WorkflowConfig } from '../../src/settings/config'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
const WETH = '0x4200000000000000000000000000000000000006' as const
const ROUTER = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF' as const
const SA1 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const
const API_BASE = 'https://trading-api.example.com'

function makeConfig(): WorkflowConfig {
	return {
		chainSelector: 15971525489660198786n,
		chainId: 8453,
		discoveryFromBlock: 0n,
		uniswapApiBase: API_BASE,
		addresses: {
			streamVaults: '0x1111111111111111111111111111111111111111',
			streamVaultsConfig: '0x2222222222222222222222222222222222222222',
		},
		strategy: {
			superTokenIn: '0x3333333333333333333333333333333333333333',
			tokenIn: USDC,
			superToUnderlyingDivisor: 10n ** 12n,
		},
	}
}

function makeRequest(): QuoteRequest {
	return {
		tokenIn: USDC,
		tokenOut: WETH,
		amountIn: 5_000_000n,
		swapper: SA1,
		slippageBps: 100,
	}
}

/**
 * Encode a JSON body as a base64 string for use in ResponseJson.body.
 * ResponseJson.body is the proto JSON wire format for a `bytes` field — a
 * base64-encoded string. fromJson(ResponseSchema, reply) decodes it back to
 * Uint8Array, which the SDK's decodeJson helper then decodes with TextDecoder.
 */
function jsonBody(data: unknown): string {
	const bytes = new TextEncoder().encode(JSON.stringify(data))
	return Buffer.from(bytes).toString('base64')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HttpQuoteProvider', () => {
	describe('fetchQuote', () => {
		test('Should return a QuoteResult when both API calls succeed', async () => {
			const runtime = newTestRuntime()
			const httpMock = HttpActionsMock.testInstance()
			// The HttpActionsMock intercepts inner sendRequest calls inside fetchRoute.
			const quoteBody = {
				quote: {
					output: { minimumAmount: '4500000' },
					tokenIn: USDC,
					tokenOut: WETH,
				},
			}
			const swapBody = {
				swap: {
					to: ROUTER,
					data: '0xabcdef',
					value: '0',
				},
			}
			httpMock.sendRequest = (req: Request) => {
				const body = req.url?.includes('/v1/quote') ? quoteBody : swapBody
				return { statusCode: 200, body: jsonBody(body) }
			}

			const http = new HTTPClient()
			const provider = new HttpQuoteProvider(runtime, http, makeConfig())

			const result = await provider.fetchQuote(makeRequest())
			expect(result).not.toBeNull()
			expect(result!.to.toLowerCase()).toBe(ROUTER.toLowerCase())
			expect(result!.data).toBe('0xabcdef')
			expect(result!.minAmountOut).toBe(4500000n)
			expect(result!.value).toBe(0n)
		})

		test('Should return null when /v1/quote returns a non-2xx status', async () => {
			const runtime = newTestRuntime()
			const httpMock = HttpActionsMock.testInstance()
			httpMock.sendRequest = (_req: Request) => ({
				statusCode: 500,
				body: jsonBody({ error: 'internal error' }),
				headers: {} as Record<string, string>,
			})

			const http = new HTTPClient()
			const provider = new HttpQuoteProvider(runtime, http, makeConfig())

			const result = await provider.fetchQuote(makeRequest())
			expect(result).toBeNull()
		})

		test('Should return null when minimumAmount is "0" (missing slippage floor)', async () => {
			// ⚠️ SECURITY: a missing/zero minimumAmount disables the on-chain slippage guard.
			// The adapter correctly refuses the quote in this case.
			const runtime = newTestRuntime()
			const httpMock = HttpActionsMock.testInstance()
			httpMock.sendRequest = (_req: Request) => ({
				statusCode: 200,
				body: jsonBody({ quote: { output: { minimumAmount: '0' } } }),
				headers: {} as Record<string, string>,
			})

			const http = new HTTPClient()
			const provider = new HttpQuoteProvider(runtime, http, makeConfig())

			const result = await provider.fetchQuote(makeRequest())
			expect(result).toBeNull()
		})

		test('Should return null when minimumAmount is missing from the quote response', async () => {
			const runtime = newTestRuntime()
			const httpMock = HttpActionsMock.testInstance()
			httpMock.sendRequest = (_req: Request) => ({
				statusCode: 200,
				// no output.minimumAmount field at all
				body: jsonBody({ quote: { output: {} } }),
				headers: {} as Record<string, string>,
			})

			const http = new HTTPClient()
			const provider = new HttpQuoteProvider(runtime, http, makeConfig())

			const result = await provider.fetchQuote(makeRequest())
			// minimumAmount defaults to '0' → NO_ROUTE
			expect(result).toBeNull()
		})

		test('Should return null when /v1/swap returns a non-2xx status', async () => {
			const runtime = newTestRuntime()
			const httpMock = HttpActionsMock.testInstance()
			let callCount = 0
			httpMock.sendRequest = (_req: Request) => {
				callCount++
				if (callCount === 1) {
					// First call: /v1/quote succeeds
					return {
						statusCode: 200,
						body: jsonBody({
							quote: { output: { minimumAmount: '4500000' }, tokenIn: USDC },
						}),
						headers: {} as Record<string, string>,
					}
				}
				// Second call: /v1/swap fails
				return {
					statusCode: 503,
					body: jsonBody({ error: 'service unavailable' }),
					headers: {} as Record<string, string>,
				}
			}

			const http = new HTTPClient()
			const provider = new HttpQuoteProvider(runtime, http, makeConfig())

			const result = await provider.fetchQuote(makeRequest())
			expect(result).toBeNull()
		})

		test('Should return null when swap.to is absent', async () => {
			const runtime = newTestRuntime()
			const httpMock = HttpActionsMock.testInstance()
			let callCount = 0
			httpMock.sendRequest = (_req: Request) => {
				callCount++
				if (callCount === 1) {
					return {
						statusCode: 200,
						body: jsonBody({
							quote: { output: { minimumAmount: '4500000' } },
						}),
						headers: {} as Record<string, string>,
					}
				}
				// swap.to is missing
				return {
					statusCode: 200,
					body: jsonBody({ swap: { data: '0xabcdef', value: '0' } }),
					headers: {} as Record<string, string>,
				}
			}

			const http = new HTTPClient()
			const provider = new HttpQuoteProvider(runtime, http, makeConfig())

			const result = await provider.fetchQuote(makeRequest())
			expect(result).toBeNull()
		})

		test('Should return null when swap.data is absent', async () => {
			const runtime = newTestRuntime()
			const httpMock = HttpActionsMock.testInstance()
			let callCount = 0
			httpMock.sendRequest = (_req: Request) => {
				callCount++
				if (callCount === 1) {
					return {
						statusCode: 200,
						body: jsonBody({
							quote: { output: { minimumAmount: '4500000' } },
						}),
						headers: {} as Record<string, string>,
					}
				}
				// swap.data is missing
				return {
					statusCode: 200,
					body: jsonBody({ swap: { to: ROUTER, value: '0' } }),
					headers: {} as Record<string, string>,
				}
			}

			const http = new HTTPClient()
			const provider = new HttpQuoteProvider(runtime, http, makeConfig())

			const result = await provider.fetchQuote(makeRequest())
			expect(result).toBeNull()
		})

		test('Should convert value string to bigint (default "0" when missing)', async () => {
			const runtime = newTestRuntime()
			const httpMock = HttpActionsMock.testInstance()
			let callCount = 0
			httpMock.sendRequest = (_req: Request) => {
				callCount++
				if (callCount === 1) {
					return {
						statusCode: 200,
						body: jsonBody({ quote: { output: { minimumAmount: '4500000' } } }),
						headers: {} as Record<string, string>,
					}
				}
				// value field is absent — should default to '0'
				return {
					statusCode: 200,
					body: jsonBody({ swap: { to: ROUTER, data: '0xabcdef' /* no value */ } }),
					headers: {} as Record<string, string>,
				}
			}

			const http = new HTTPClient()
			const provider = new HttpQuoteProvider(runtime, http, makeConfig())

			const result = await provider.fetchQuote(makeRequest())
			expect(result).not.toBeNull()
			expect(result!.value).toBe(0n)
		})
	})
})
