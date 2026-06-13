/**
 * Tests for adapters/viem-swap-executor.ts — ViemSwapExecutorAdapter.
 *
 * Audit findings:
 * - executeSwap builds the SwapParams struct from the decision + quote,
 *   simulates first (so reverts surface before gas is spent), then submits
 *   the simulated `request` via walletClient.writeContract.
 * - The outer tx value MUST equal the quote's value (native value routed
 *   through executeSwap).
 * - args are [decision.smartAccount, params]; functionName is executeSwap.
 * - A simulation revert propagates and writeContract is never called.
 */

import { expect } from 'chai'
import sinon, { type SinonStub } from 'sinon'
import { getAddress } from 'viem'

import { ViemSwapExecutorAdapter } from '../../src/adapters/viem-swap-executor.js'
import type { QuoteResult } from '../../src/domain/models/quote.js'
import type { SwapDecision } from '../../src/domain/models/swap.js'

const STREAM_VAULTS = getAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01')
const SA = getAddress('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB02')
const USDCX = getAddress('0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC03')
const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e')
const WETH = getAddress('0x4200000000000000000000000000000000000006')
const ROUTER = getAddress('0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEAD0001')
const ACCOUNT = { address: getAddress('0x1111111111111111111111111111111111111111') }
const TX_HASH = '0xfeed000000000000000000000000000000000000000000000000000000000001' as const
const CALLDATA = '0xabcdef' as const

const decision: SwapDecision = {
  smartAccount: SA,
  superTokenIn: USDCX,
  superAmountIn: 5_000_000_000_000_000_000n,
  tokenIn: USDC,
  tokenOut: WETH,
  underlyingAmountIn: 5_000_000n,
  maxSlippageBps: 100,
}

const quote: QuoteResult = {
  to: ROUTER,
  data: CALLDATA,
  value: 1_000_000_000n,
  minAmountOut: 4_850_000n,
}

describe('ViemSwapExecutorAdapter', function () {
  let simulateContract: SinonStub
  let writeContract: SinonStub

  beforeEach(function () {
    simulateContract = sinon.stub()
    writeContract = sinon.stub()
  })

  afterEach(function () {
    sinon.restore()
  })

  function build() {
    return new ViemSwapExecutorAdapter({
      publicClient: { simulateContract } as never,
      walletClient: { writeContract } as never,
      account: ACCOUNT as never,
      streamVaults: STREAM_VAULTS,
    })
  }

  describe('executeSwap', function () {
    it('Should simulate then submit and return the tx hash', async function () {
      const request = { sentinel: true }
      simulateContract.resolves({ request })
      writeContract.resolves(TX_HASH)

      const hash = await build().executeSwap(decision, quote)

      expect(hash).to.equal(TX_HASH)
      expect(simulateContract.calledOnce).to.be.true
      expect(writeContract.calledOnceWithExactly(request)).to.be.true
      expect(simulateContract.calledBefore(writeContract)).to.be.true
    })

    it('Should pass executeSwap(smartAccount, params) with the value forwarded', async function () {
      simulateContract.resolves({ request: {} })
      writeContract.resolves(TX_HASH)

      await build().executeSwap(decision, quote)

      const arg = simulateContract.firstCall.args[0]
      expect(arg.account).to.equal(ACCOUNT)
      expect(arg.address).to.equal(STREAM_VAULTS)
      expect(arg.functionName).to.equal('executeSwap')
      expect(arg.value).to.equal(quote.value)

      const [saArg, params] = arg.args
      expect(saArg).to.equal(SA)
      expect(params).to.deep.equal({
        superTokenIn: USDCX,
        superAmountIn: decision.superAmountIn,
        tokenIn: USDC,
        tokenOut: WETH,
        target: ROUTER,
        value: quote.value,
        data: CALLDATA,
        minAmountOut: quote.minAmountOut,
      })
    })

    it('Should propagate a simulation revert and never submit', async function () {
      simulateContract.rejects(new Error('execution reverted: COOLDOWN'))

      await expect(build().executeSwap(decision, quote)).to.be.rejectedWith('COOLDOWN')
      expect(writeContract.called).to.be.false
    })

    it('Should forward a zero value when the quote requires no native value', async function () {
      simulateContract.resolves({ request: {} })
      writeContract.resolves(TX_HASH)

      await build().executeSwap(decision, { ...quote, value: 0n })
      expect(simulateContract.firstCall.args[0].value).to.equal(0n)
    })
  })
})
