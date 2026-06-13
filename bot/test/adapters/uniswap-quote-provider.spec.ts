/**
 * Tests for adapters/uniswap-quote-provider.ts — UniswapQuoteProvider.
 *
 * Audit findings (verified against the adapter source):
 * - fetch is called twice per request (/v1/quote then /v1/swap).
 * - slippageTolerance is sent as a JSON NUMBER (= slippageBps / 100), not a
 *   string. routingPreference is 'BEST_PRICE' (this gateway's enum), not
 *   CLASSIC/UNISWAPX.
 * - minAmountOut is read verbatim from `quote.quote.output.minimumAmount`
 *   (the API already applied slippageTolerance); the adapter does NOT
 *   recompute it. A missing/zero floor would disable the on-chain
 *   defense-in-depth check, so the adapter REFUSES to trade: it logs a loud
 *   warn and returns null instead of forwarding a 0 floor (H-01).
 * - x-api-key header is only added when apiKey is non-empty.
 * - Returns null (not throws) when either HTTP call returns !ok, and when
 *   swap.to or swap.data is missing.
 * - value defaults to 0n when swap.value is absent.
 * - apiBase is used verbatim — trailing-slash trimming is the config layer's
 *   responsibility, not the adapter's.
 */

import { expect } from 'chai'
import sinon, { type SinonStub } from 'sinon'

import { UniswapQuoteProvider } from '../../src/adapters/uniswap-quote-provider.js'
import type { QuoteRequest } from '../../src/domain/models/quote.js'
import type { Logger } from '../../src/utils/logger.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
const WETH = '0x4200000000000000000000000000000000000006' as const
const SA = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01' as const
const ROUTER = '0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEAD0001' as const
const CALLDATA = '0xdeadbeef01020304' as const
const API_BASE = 'https://api.uniswap.org'

const validRequest: QuoteRequest = {
  tokenIn: USDC,
  tokenOut: WETH,
  amountIn: 5_000_000n,
  swapper: SA,
  slippageBps: 100, // 1%
}

// The adapter reads minAmountOut from quote.quote.output.minimumAmount.
const quoteBody = {
  quote: { output: { amount: '4900000', minimumAmount: '4850000' } },
  requestId: 'req-001',
}

const swapBody = {
  swap: {
    to: ROUTER,
    data: CALLDATA,
    value: '0',
  },
}

function makeLogger(): Logger {
  return {
    info: sinon.stub(),
    warn: sinon.stub(),
    error: sinon.stub(),
  }
}

type Resp = { ok: boolean; status?: number; body?: unknown; text?: string }

function makeFetchStub(quoteResponse: Resp, swapResponse: Resp): SinonStub {
  let call = 0
  return sinon.stub().callsFake(async (_url: string) => {
    call++
    const r = call === 1 ? quoteResponse : swapResponse
    const fallback = call === 1 ? quoteBody : swapBody
    return {
      ok: r.ok,
      status: r.status ?? 200,
      json: async () => r.body ?? fallback,
      text: async () => r.text ?? '',
    }
  })
}

function buildProvider(apiKey: string, logger?: Logger): UniswapQuoteProvider {
  return new UniswapQuoteProvider({
    apiBase: API_BASE,
    apiKey,
    chainId: 84532,
    logger,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('UniswapQuoteProvider', function () {
  let fetchStub: SinonStub
  let logger: Logger

  beforeEach(function () {
    logger = makeLogger()
  })

  afterEach(function () {
    sinon.restore()
  })

  function installFetch(quote: Resp, swap: Resp) {
    fetchStub = makeFetchStub(quote, swap)
    sinon.replace(globalThis, 'fetch', fetchStub as unknown as typeof fetch)
  }

  describe('fetchQuote', function () {
    it('Should return a QuoteResult on a fully successful two-step response', async function () {
      installFetch({ ok: true }, { ok: true })
      const result = await buildProvider('test-key', logger).fetchQuote(validRequest)

      expect(result).to.not.be.null
      expect(result!.to).to.equal(ROUTER)
      expect(result!.data).to.equal(CALLDATA)
      expect(result!.value).to.equal(0n)
      expect(result!.minAmountOut).to.equal(4_850_000n)
    })

    it('Should read minAmountOut verbatim from quote.quote.output.minimumAmount', async function () {
      installFetch(
        { ok: true, body: { quote: { output: { minimumAmount: '3960000' } } } },
        { ok: true },
      )
      const result = await buildProvider('', logger).fetchQuote(validRequest)
      expect(result!.minAmountOut).to.equal(3_960_000n)
    })

    it('Should return null and warn when minimumAmount is missing (refuses a 0 slippage floor)', async function () {
      installFetch(
        { ok: true, body: { quote: { output: {} }, requestId: 'r' } },
        { ok: true },
      )
      const result = await buildProvider('', logger).fetchQuote(validRequest)

      // H-01: a 0 floor disables the on-chain anti-slippage check, so the
      // adapter skips the trade rather than forwarding it.
      expect(result).to.be.null
      const warn = (logger.warn as SinonStub)
        .getCalls()
        .find(c => c.args[1] === 'uniswap_quote_missing_minimum_amount_skipping')
      expect(warn, 'expected uniswap_quote_missing_minimum_amount_skipping warn').to.exist
    })

    it('Should return null when the whole quote field is absent (no slippage floor)', async function () {
      installFetch({ ok: true, body: { requestId: 'r' } }, { ok: true })
      const result = await buildProvider('', logger).fetchQuote(validRequest)
      expect(result).to.be.null
    })

    it('Should NOT add x-api-key header when apiKey is an empty string', async function () {
      installFetch({ ok: true }, { ok: true })
      await buildProvider('', logger).fetchQuote(validRequest)

      const headers = fetchStub.firstCall.args[1].headers as Record<string, string>
      expect(headers['x-api-key']).to.be.undefined
      expect(headers['content-type']).to.equal('application/json')
    })

    it('Should add x-api-key header to both calls when apiKey is non-empty', async function () {
      installFetch({ ok: true }, { ok: true })
      await buildProvider('my-secret-key', logger).fetchQuote(validRequest)

      const quoteHeaders = fetchStub.firstCall.args[1].headers as Record<string, string>
      const swapHeaders = fetchStub.secondCall.args[1].headers as Record<string, string>
      expect(quoteHeaders['x-api-key']).to.equal('my-secret-key')
      expect(swapHeaders['x-api-key']).to.equal('my-secret-key')
    })

    it('Should POST to /v1/quote with the correct body fields', async function () {
      installFetch({ ok: true }, { ok: true })
      await buildProvider('', logger).fetchQuote(validRequest)

      const [quoteUrl, quoteOptions] = fetchStub.firstCall.args
      expect(quoteUrl).to.equal('https://api.uniswap.org/v1/quote')
      expect(quoteOptions.method).to.equal('POST')

      const body = JSON.parse(quoteOptions.body as string)
      expect(body.type).to.equal('EXACT_INPUT')
      expect(body.tokenInChainId).to.equal(84532)
      expect(body.tokenOutChainId).to.equal(84532)
      expect(body.tokenIn).to.equal(USDC)
      expect(body.tokenOut).to.equal(WETH)
      expect(body.amount).to.equal('5000000')
      expect(body.swapper).to.equal(SA)
      // Sent as a JSON number (percent), not a string.
      expect(body.slippageTolerance).to.equal(1)
      expect(body.routingPreference).to.equal('BEST_PRICE')
    })

    it('Should convert slippageBps to a percent number (50bps → 0.5)', async function () {
      installFetch({ ok: true }, { ok: true })
      await buildProvider('', logger).fetchQuote({ ...validRequest, slippageBps: 50 })

      const body = JSON.parse(fetchStub.firstCall.args[1].body as string)
      expect(body.slippageTolerance).to.equal(0.5)
    })

    it('Should POST to /v1/swap forwarding the nested quote and simulateTransaction=false', async function () {
      installFetch({ ok: true }, { ok: true })
      await buildProvider('', logger).fetchQuote(validRequest)

      const [swapUrl, swapOptions] = fetchStub.secondCall.args
      expect(swapUrl).to.equal('https://api.uniswap.org/v1/swap')
      const body = JSON.parse(swapOptions.body as string)
      expect(body.simulateTransaction).to.equal(false)
      expect(body.quote).to.deep.equal(quoteBody.quote)
    })

    it('Should return null and log warn (with status) when /v1/quote returns non-2xx', async function () {
      installFetch({ ok: false, status: 429, text: 'rate limited' }, { ok: true })
      const result = await buildProvider('', logger).fetchQuote(validRequest)

      expect(result).to.be.null
      const warn = (logger.warn as SinonStub)
        .getCalls()
        .find(c => c.args[1] === 'uniswap_quote_failed')
      expect(warn).to.exist
      expect(warn!.args[0].status).to.equal(429)
      expect(warn!.args[0].detail).to.equal('rate limited')
    })

    it('Should NOT call /v1/swap when /v1/quote fails', async function () {
      installFetch({ ok: false, status: 400, text: 'bad request' }, { ok: true })
      await buildProvider('', logger).fetchQuote(validRequest)
      expect(fetchStub.callCount).to.equal(1)
    })

    it('Should return null and log warn when /v1/swap returns non-2xx', async function () {
      installFetch({ ok: true }, { ok: false, status: 500, text: 'internal error' })
      const result = await buildProvider('', logger).fetchQuote(validRequest)

      expect(result).to.be.null
      const warn = (logger.warn as SinonStub)
        .getCalls()
        .find(c => c.args[1] === 'uniswap_swap_failed')
      expect(warn).to.exist
      expect(warn!.args[0].status).to.equal(500)
    })

    it('Should return null and warn uniswap_swap_missing_to_or_data when swap.to is missing', async function () {
      installFetch({ ok: true }, { ok: true, body: { swap: { data: CALLDATA, value: '0' } } })
      const result = await buildProvider('', logger).fetchQuote(validRequest)

      expect(result).to.be.null
      const warn = (logger.warn as SinonStub)
        .getCalls()
        .find(c => c.args[1] === 'uniswap_swap_missing_to_or_data')
      expect(warn).to.exist
    })

    it('Should return null when swap.data is missing', async function () {
      installFetch({ ok: true }, { ok: true, body: { swap: { to: ROUTER, value: '0' } } })
      const result = await buildProvider('', logger).fetchQuote(validRequest)
      expect(result).to.be.null
    })

    it('Should return null when the swap object itself is absent', async function () {
      installFetch({ ok: true }, { ok: true, body: {} })
      const result = await buildProvider('', logger).fetchQuote(validRequest)
      expect(result).to.be.null
    })

    it('Should default value to 0n when swap.value is absent', async function () {
      installFetch({ ok: true }, { ok: true, body: { swap: { to: ROUTER, data: CALLDATA } } })
      const result = await buildProvider('', logger).fetchQuote(validRequest)
      expect(result!.value).to.equal(0n)
    })

    it('Should parse swap.value as a bigint when present', async function () {
      installFetch(
        { ok: true },
        { ok: true, body: { swap: { to: ROUTER, data: CALLDATA, value: '1000000000000000' } } },
      )
      const result = await buildProvider('', logger).fetchQuote(validRequest)
      expect(result!.value).to.equal(1_000_000_000_000_000n)
    })

    it('Should use apiBase verbatim (trailing-slash trimming is the config layer)', async function () {
      installFetch({ ok: true }, { ok: true })
      await buildProvider('', logger).fetchQuote(validRequest)
      expect(fetchStub.firstCall.args[0]).to.equal(`${API_BASE}/v1/quote`)
      expect(fetchStub.secondCall.args[0]).to.equal(`${API_BASE}/v1/swap`)
    })

    it('Should use the injected logger for warnings when one is provided', async function () {
      installFetch({ ok: false, status: 503, text: 'service unavailable' }, { ok: true })
      const custom = makeLogger()
      await buildProvider('', custom).fetchQuote(validRequest)
      expect((custom.warn as SinonStub).calledOnce).to.be.true
    })

    it('Should construct its own logger when none is injected (no throw)', async function () {
      installFetch({ ok: true }, { ok: true })
      // No logger field passed → adapter builds its own via getLogger.
      const provider = new UniswapQuoteProvider({
        apiBase: API_BASE,
        apiKey: '',
        chainId: 84532,
      })
      const result = await provider.fetchQuote(validRequest)
      expect(result).to.not.be.null
    })
  })
})
