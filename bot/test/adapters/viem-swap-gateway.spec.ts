/**
 * Tests for adapters/viem-swap-gateway.ts — ViemSwapGatewayAdapter.
 *
 * Audit findings:
 * - All reads delegate to publicClient.readContract against the
 *   StreamVaults address with the streamVaults ABI.
 * - getSwapCooldownBlocks calls swapCooldownBlocks() (no args).
 * - getLastSwapBlock forwards the smart account as the only arg.
 * - getStreamCloseThresholdBps calls streamCloseThresholdBps() (no args).
 * - Return values are propagated verbatim as bigint; rejections bubble up.
 */

import { expect } from 'chai'
import sinon, { type SinonStub } from 'sinon'
import { getAddress } from 'viem'

import { ViemSwapGatewayAdapter } from '../../src/adapters/viem-swap-gateway.js'

const STREAM_VAULTS = getAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01')
const SA = getAddress('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB02')

describe('ViemSwapGatewayAdapter', function () {
  let readContract: SinonStub

  beforeEach(function () {
    readContract = sinon.stub()
  })

  afterEach(function () {
    sinon.restore()
  })

  function build() {
    return new ViemSwapGatewayAdapter({
      publicClient: { readContract } as never,
      streamVaults: STREAM_VAULTS,
    })
  }

  describe('getSwapCooldownBlocks', function () {
    it('Should read swapCooldownBlocks() against the StreamVaults address', async function () {
      readContract.resolves(5n)
      const result = await build().getSwapCooldownBlocks()

      expect(result).to.equal(5n)
      const arg = readContract.firstCall.args[0]
      expect(arg.address).to.equal(STREAM_VAULTS)
      expect(arg.functionName).to.equal('swapCooldownBlocks')
      expect(arg.args).to.be.undefined
    })

    it('Should propagate the readContract rejection', async function () {
      readContract.rejects(new Error('rpc down'))
      await expect(build().getSwapCooldownBlocks()).to.be.rejectedWith('rpc down')
    })
  })

  describe('getLastSwapBlock', function () {
    it('Should read lastSwapBlock(smartAccount) forwarding the address', async function () {
      readContract.resolves(990n)
      const result = await build().getLastSwapBlock(SA)

      expect(result).to.equal(990n)
      const arg = readContract.firstCall.args[0]
      expect(arg.address).to.equal(STREAM_VAULTS)
      expect(arg.functionName).to.equal('lastSwapBlock')
      expect(arg.args).to.deep.equal([SA])
    })

    it('Should return 0n for a smart account that has never swapped', async function () {
      readContract.resolves(0n)
      expect(await build().getLastSwapBlock(SA)).to.equal(0n)
    })
  })

  describe('getStreamCloseThresholdBps', function () {
    it('Should read streamCloseThresholdBps() against the StreamVaults address', async function () {
      readContract.resolves(1_000n)
      const result = await build().getStreamCloseThresholdBps()

      expect(result).to.equal(1_000n)
      const arg = readContract.firstCall.args[0]
      expect(arg.address).to.equal(STREAM_VAULTS)
      expect(arg.functionName).to.equal('streamCloseThresholdBps')
      expect(arg.args).to.be.undefined
    })

    it('Should return 0n when the feature is disabled on-chain', async function () {
      readContract.resolves(0n)
      expect(await build().getStreamCloseThresholdBps()).to.equal(0n)
    })

    it('Should return 10000n when threshold is set to 100% of deposit', async function () {
      readContract.resolves(10_000n)
      expect(await build().getStreamCloseThresholdBps()).to.equal(10_000n)
    })

    it('Should propagate the readContract rejection', async function () {
      readContract.rejects(new Error('rpc down'))
      await expect(build().getStreamCloseThresholdBps()).to.be.rejectedWith('rpc down')
    })
  })
})
