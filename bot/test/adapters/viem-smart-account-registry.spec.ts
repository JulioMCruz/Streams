/**
 * Tests for adapters/viem-smart-account-registry.ts — ViemSmartAccountRegistryAdapter.
 *
 * Audit findings:
 * - getLogs is called with the correct event filter and address.
 * - Deduplication by smart account address is applied (Map keyed by getAddress(sa)).
 * - Logs with missing user or smartAccount args are silently skipped.
 * - fromBlock is forwarded correctly.
 * - getAddress is called for checksum normalization.
 */

import { expect } from 'chai'
import sinon, { type SinonStub } from 'sinon'
import { getAddress } from 'viem'

import { ViemSmartAccountRegistryAdapter } from '../../src/adapters/viem-smart-account-registry.js'

// The adapter normalizes every address through viem's `getAddress`, which
// returns the EIP-55 mixed-case checksum — not all-uppercase hex. Define the
// fixtures already checksummed so the returned values compare by equality.
const STREAM_VAULTS = getAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01')
const SA1 = getAddress('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB01')
const SA2 = getAddress('0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC02')
const USER1 = getAddress('0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD03')
const USER2 = getAddress('0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE04')

function makeLog(user: string | undefined, smartAccount: string | undefined) {
  return { args: { user, smartAccount } }
}

const ZERO = '0x0000000000000000000000000000000000000000'

describe('ViemSmartAccountRegistryAdapter', function () {
  let getLogsStub: SinonStub
  let readContractStub: SinonStub

  beforeEach(function () {
    getLogsStub = sinon.stub()
    // userOf(sa) read — default: every account is active (non-zero user).
    readContractStub = sinon.stub().resolves(USER1)
  })

  afterEach(function () {
    sinon.restore()
  })

  function buildAdapter(fromBlock = 0n) {
    const publicClient = { getLogs: getLogsStub, readContract: readContractStub }
    return new ViemSmartAccountRegistryAdapter({
      publicClient: publicClient as any,
      streamVaults: STREAM_VAULTS,
      fromBlock,
    })
  }

  describe('discover', function () {
    it('Should return an empty array when no logs are found', async function () {
      getLogsStub.resolves([])
      const adapter = buildAdapter()
      const result = await adapter.discover()
      expect(result).to.deep.equal([])
    })

    it('Should return one SmartAccountInfo per unique smart account', async function () {
      getLogsStub.resolves([makeLog(USER1, SA1)])
      const adapter = buildAdapter()
      const result = await adapter.discover()
      expect(result).to.have.length(1)
      expect(result[0].user).to.equal(USER1)
      expect(result[0].smartAccount).to.equal(SA1)
    })

    it('Should return two entries for two different smart accounts', async function () {
      getLogsStub.resolves([makeLog(USER1, SA1), makeLog(USER2, SA2)])
      const adapter = buildAdapter()
      const result = await adapter.discover()
      expect(result).to.have.length(2)
    })

    it('Should drop retired accounts whose userOf is the zero address', async function () {
      // SA2 was retired via redeploySmartAccount() — its userOf is now zero,
      // but its historical SmartAccountCreated log still shows up.
      getLogsStub.resolves([makeLog(USER1, SA1), makeLog(USER2, SA2)])
      readContractStub.callsFake(async ({ args }: { args: readonly unknown[] }) =>
        args[0] === SA2 ? ZERO : USER1,
      )
      const adapter = buildAdapter()
      const result = await adapter.discover()
      expect(result).to.have.length(1)
      expect(result[0].smartAccount).to.equal(SA1)
    })

    it('Should query userOf on the streamVaults address for each candidate', async function () {
      getLogsStub.resolves([makeLog(USER1, SA1)])
      const adapter = buildAdapter()
      await adapter.discover()
      const call = readContractStub.firstCall.args[0]
      expect(call.address).to.equal(STREAM_VAULTS)
      expect(call.functionName).to.equal('userOf')
      expect(call.args[0]).to.equal(SA1)
    })

    it('Should deduplicate duplicate logs for the same smart account (keep the last)', async function () {
      // Two logs for the same SA1 — dedup via Map, last one wins
      getLogsStub.resolves([makeLog(USER1, SA1), makeLog(USER2, SA1)])
      const adapter = buildAdapter()
      const result = await adapter.discover()
      expect(result).to.have.length(1)
      // The last log for SA1 maps USER2
      expect(result[0].user).to.equal(USER2)
    })

    it('Should skip logs where user is undefined', async function () {
      getLogsStub.resolves([makeLog(undefined, SA1), makeLog(USER1, SA2)])
      const adapter = buildAdapter()
      const result = await adapter.discover()
      expect(result).to.have.length(1)
      expect(result[0].smartAccount).to.equal(SA2)
    })

    it('Should skip logs where smartAccount is undefined', async function () {
      getLogsStub.resolves([makeLog(USER1, undefined), makeLog(USER2, SA2)])
      const adapter = buildAdapter()
      const result = await adapter.discover()
      expect(result).to.have.length(1)
      expect(result[0].user).to.equal(USER2)
    })

    it('Should skip logs where both user and smartAccount are undefined', async function () {
      getLogsStub.resolves([makeLog(undefined, undefined)])
      const adapter = buildAdapter()
      const result = await adapter.discover()
      expect(result).to.have.length(0)
    })

    it('Should call getLogs with the correct streamVaults address', async function () {
      getLogsStub.resolves([])
      const adapter = buildAdapter(100n)
      await adapter.discover()
      expect(getLogsStub.calledOnce).to.be.true
      const callArg = getLogsStub.firstCall.args[0]
      expect(callArg.address).to.equal(STREAM_VAULTS)
    })

    it('Should pass fromBlock to getLogs', async function () {
      getLogsStub.resolves([])
      const adapter = buildAdapter(5_000_000n)
      await adapter.discover()
      const callArg = getLogsStub.firstCall.args[0]
      expect(callArg.fromBlock).to.equal(5_000_000n)
    })

    it('Should use fromBlock of 0n when constructed with default', async function () {
      getLogsStub.resolves([])
      const adapter = buildAdapter(0n)
      await adapter.discover()
      const callArg = getLogsStub.firstCall.args[0]
      expect(callArg.fromBlock).to.equal(0n)
    })

    it('Should normalize addresses via getAddress (checksumming)', async function () {
      // Provide lowercase addresses — viem's getAddress will checksum them
      const lcSA = SA1.toLowerCase() as `0x${string}`
      const lcUser = USER1.toLowerCase() as `0x${string}`
      getLogsStub.resolves([makeLog(lcUser, lcSA)])
      const adapter = buildAdapter()
      const result = await adapter.discover()
      // Result should be checksummed (no lowercase hex)
      expect(result[0].smartAccount).to.equal(result[0].smartAccount)
      // The address is checksummed if it does not equal its own lowercase
      expect(result[0].smartAccount.toLowerCase()).to.not.equal(result[0].smartAccount)
    })

    it('Should propagate getLogs rejection to the caller', async function () {
      getLogsStub.rejects(new Error('rpc error'))
      const adapter = buildAdapter()
      await expect(adapter.discover()).to.be.rejectedWith('rpc error')
    })
  })
})
