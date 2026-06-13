/**
 * Tests for adapters/viem-chain-state.ts — ViemChainStateAdapter.
 *
 * Audit findings:
 * - getBlockNumber delegates straight to publicClient.getBlockNumber.
 * - readSmartAccountState fans out four parallel reads (owner, operator,
 *   rules, targetTokens) and destructures the `rules` tuple into
 *   [maxSlippageBps, minTradeAmount, settlementAddress].
 * - targetTokens is copied (spread) so the returned array is not the raw
 *   client result — mutating the result must not affect internal state.
 * - readErc20Balance forwards [holder] to balanceOf on the token address.
 * - A failure in any of the four parallel reads rejects the whole call.
 * - readStreamHealth calls realtimeBalanceOfNow(sender) on the superToken,
 *   destructures the first two elements of the 4-tuple
 *   [availableBalance, deposit, owedDeposit, timestamp], and returns
 *   { availableBalance, deposit }. owedDeposit and timestamp are discarded.
 */

import { expect } from 'chai'
import sinon, { type SinonStub } from 'sinon'
import { getAddress } from 'viem'

import { ViemChainStateAdapter } from '../../src/adapters/viem-chain-state.js'

const SA = getAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01')
const OWNER = getAddress('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB02')
const OPERATOR = getAddress('0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC03')
const SETTLEMENT = getAddress('0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD04')
const WETH = getAddress('0x4200000000000000000000000000000000000006')
const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e')
const USDCX = getAddress('0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE06')
const SENDER = getAddress('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF07')
const HOLDER = SA

describe('ViemChainStateAdapter', function () {
  let readContract: SinonStub
  let getBlockNumber: SinonStub

  beforeEach(function () {
    readContract = sinon.stub()
    getBlockNumber = sinon.stub()
  })

  afterEach(function () {
    sinon.restore()
  })

  function build() {
    return new ViemChainStateAdapter({ readContract, getBlockNumber } as never)
  }

  // readContract is dispatched by functionName.
  function wireState(rules: readonly [number, bigint, string], targets: readonly string[]) {
    readContract.callsFake(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case 'owner':
          return OWNER
        case 'operator':
          return OPERATOR
        case 'rules':
          return rules
        case 'targetTokens':
          return targets
        default:
          throw new Error(`unexpected functionName ${functionName}`)
      }
    })
  }

  describe('getBlockNumber', function () {
    it('Should delegate to publicClient.getBlockNumber', async function () {
      getBlockNumber.resolves(123_456n)
      expect(await build().getBlockNumber()).to.equal(123_456n)
      expect(getBlockNumber.calledOnce).to.be.true
    })
  })

  describe('readSmartAccountState', function () {
    it('Should assemble the state from the four contract reads', async function () {
      wireState([250, 1_000_000n, SETTLEMENT], [WETH, USDC])
      const state = await build().readSmartAccountState(SA)

      expect(state).to.deep.equal({
        smartAccount: SA,
        owner: OWNER,
        operator: OPERATOR,
        maxSlippageBps: 250,
        minTradeAmount: 1_000_000n,
        settlementAddress: SETTLEMENT,
        targetTokens: [WETH, USDC],
      })
    })

    it('Should read all four fields against the smart account address', async function () {
      wireState([100, 5n, SETTLEMENT], [WETH])
      await build().readSmartAccountState(SA)

      const fns = readContract.getCalls().map(c => c.args[0].functionName)
      expect(fns).to.have.members(['owner', 'operator', 'rules', 'targetTokens'])
      for (const call of readContract.getCalls()) {
        expect(call.args[0].address).to.equal(SA)
      }
    })

    it('Should return a copy of targetTokens (mutating the result is safe)', async function () {
      const targets = [WETH, USDC]
      wireState([100, 5n, SETTLEMENT], targets)
      const state = await build().readSmartAccountState(SA)

      state.targetTokens.push(getAddress('0x1111111111111111111111111111111111111111'))
      expect(targets).to.deep.equal([WETH, USDC]) // source untouched
    })

    it('Should handle an empty targetTokens array', async function () {
      wireState([100, 5n, SETTLEMENT], [])
      const state = await build().readSmartAccountState(SA)
      expect(state.targetTokens).to.deep.equal([])
    })

    it('Should reject when any of the parallel reads fails', async function () {
      readContract.callsFake(async ({ functionName }: { functionName: string }) => {
        if (functionName === 'rules') throw new Error('rules revert')
        return functionName === 'targetTokens' ? [] : OWNER
      })
      await expect(build().readSmartAccountState(SA)).to.be.rejectedWith('rules revert')
    })
  })

  describe('readErc20Balance', function () {
    it('Should call balanceOf with the holder and return the balance', async function () {
      readContract.resolves(7_777n)
      const result = await build().readErc20Balance(USDC, HOLDER)

      expect(result).to.equal(7_777n)
      const arg = readContract.firstCall.args[0]
      expect(arg.address).to.equal(USDC)
      expect(arg.functionName).to.equal('balanceOf')
      expect(arg.args).to.deep.equal([HOLDER])
    })

    it('Should propagate a balanceOf revert', async function () {
      readContract.rejects(new Error('not a token'))
      await expect(build().readErc20Balance(USDC, HOLDER)).to.be.rejectedWith('not a token')
    })
  })

  describe('readStreamHealth', function () {
    it('Should call realtimeBalanceOfNow on the superToken with the sender address', async function () {
      // realtimeBalanceOfNow returns [availableBalance, deposit, owedDeposit, timestamp]
      readContract.resolves([5_000_000_000_000_000_000n, 3_600_000_000_000_000_000n, 0n, 1_700_000_000n])
      const health = await build().readStreamHealth(USDCX, SENDER)

      expect(health).to.deep.equal({
        availableBalance: 5_000_000_000_000_000_000n,
        deposit: 3_600_000_000_000_000_000n,
      })
      const arg = readContract.firstCall.args[0]
      expect(arg.address).to.equal(USDCX)
      expect(arg.functionName).to.equal('realtimeBalanceOfNow')
      expect(arg.args).to.deep.equal([SENDER])
    })

    it('Should discard owedDeposit and timestamp — only availableBalance and deposit are returned', async function () {
      const owedDeposit = 99_000n
      const timestamp = 1_700_000_001n
      readContract.resolves([1_000n, 500n, owedDeposit, timestamp])
      const health = await build().readStreamHealth(USDCX, SENDER)

      expect(health).to.deep.equal({ availableBalance: 1_000n, deposit: 500n })
      expect(Object.keys(health)).to.have.members(['availableBalance', 'deposit'])
    })

    it('Should return deposit === 0n when the sender has no active stream', async function () {
      // Superfluid returns deposit=0 when there are no outgoing flows
      readContract.resolves([10_000_000_000_000_000_000n, 0n, 0n, 1_700_000_000n])
      const health = await build().readStreamHealth(USDCX, SENDER)

      expect(health.deposit).to.equal(0n)
      expect(health.availableBalance).to.equal(10_000_000_000_000_000_000n)
    })

    it('Should return a negative availableBalance when the stream is critical', async function () {
      // Superfluid availableBalance (int256) can go negative once critical
      readContract.resolves([-1_000_000_000_000_000n, 3_600_000_000_000_000_000n, 0n, 1_700_000_000n])
      const health = await build().readStreamHealth(USDCX, SENDER)

      expect(health.availableBalance).to.equal(-1_000_000_000_000_000n)
    })

    it('Should propagate a realtimeBalanceOfNow revert', async function () {
      readContract.rejects(new Error('super token not supported'))
      await expect(build().readStreamHealth(USDCX, SENDER)).to.be.rejectedWith('super token not supported')
    })
  })
})
