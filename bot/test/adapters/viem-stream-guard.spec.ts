/**
 * Tests for adapters/viem-stream-guard.ts — ViemStreamGuardAdapter.
 *
 * Audit findings:
 * - closeStream(smartAccount, superToken) simulates via publicClient first
 *   so an on-chain guard revert (STREAM_NOT_LOW / STREAM_NOT_ACTIVE) surfaces
 *   before gas is spent — identical pattern to ViemSwapExecutorAdapter.
 * - The simulated `request` is forwarded verbatim to walletClient.writeContract.
 * - A simulation revert must propagate and writeContract must never be called.
 * - args passed to simulateContract must be [smartAccount, superToken]; the
 *   functionName must be 'closeStreamIfLow'.
 */

import { expect } from 'chai'
import sinon, { type SinonStub } from 'sinon'
import { getAddress } from 'viem'

import { ViemStreamGuardAdapter } from '../../src/adapters/viem-stream-guard.js'

const STREAM_VAULTS = getAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01')
const SA = getAddress('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB02')
const USDCX = getAddress('0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC03')
const ACCOUNT = { address: getAddress('0x1111111111111111111111111111111111111111') }
const TX_HASH = '0xfeed000000000000000000000000000000000000000000000000000000000001' as const

describe('ViemStreamGuardAdapter', function () {
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
		return new ViemStreamGuardAdapter({
			publicClient: { simulateContract } as never,
			walletClient: { writeContract } as never,
			account: ACCOUNT as never,
			streamVaults: STREAM_VAULTS,
		})
	}

	describe('closeStream', function () {
		it('Should simulate then submit and return the tx hash', async function () {
			const request = { sentinel: true }
			simulateContract.resolves({ request })
			writeContract.resolves(TX_HASH)

			const hash = await build().closeStream(SA, USDCX)

			expect(hash).to.equal(TX_HASH)
			expect(simulateContract.calledOnce).to.be.true
			expect(writeContract.calledOnceWithExactly(request)).to.be.true
			expect(simulateContract.calledBefore(writeContract)).to.be.true
		})

		it('Should call simulateContract with closeStreamIfLow(smartAccount, superToken)', async function () {
			simulateContract.resolves({ request: {} })
			writeContract.resolves(TX_HASH)

			await build().closeStream(SA, USDCX)

			const arg = simulateContract.firstCall.args[0]
			expect(arg.account).to.equal(ACCOUNT)
			expect(arg.address).to.equal(STREAM_VAULTS)
			expect(arg.functionName).to.equal('closeStreamIfLow')
			expect(arg.args).to.deep.equal([SA, USDCX])
		})

		it('Should propagate a simulation revert and never call writeContract', async function () {
			simulateContract.rejects(new Error('execution reverted: STREAM_NOT_LOW'))

			await expect(build().closeStream(SA, USDCX)).to.be.rejectedWith('STREAM_NOT_LOW')
			expect(writeContract.called).to.be.false
		})

		it('Should propagate a STREAM_NOT_ACTIVE simulation revert and never call writeContract', async function () {
			simulateContract.rejects(new Error('execution reverted: STREAM_NOT_ACTIVE'))

			await expect(build().closeStream(SA, USDCX)).to.be.rejectedWith('STREAM_NOT_ACTIVE')
			expect(writeContract.called).to.be.false
		})

		it('Should forward the simulated request object verbatim to writeContract', async function () {
			// The request from simulateContract may carry nonce/gas overrides;
			// the adapter must not modify it.
			const request = { nonce: 42, gas: 100_000n, someField: 'opaque' }
			simulateContract.resolves({ request })
			writeContract.resolves(TX_HASH)

			await build().closeStream(SA, USDCX)

			expect(writeContract.firstCall.args[0]).to.equal(request)
		})

		it('Should propagate a writeContract rejection', async function () {
			simulateContract.resolves({ request: {} })
			writeContract.rejects(new Error('nonce too low'))

			await expect(build().closeStream(SA, USDCX)).to.be.rejectedWith('nonce too low')
		})
	})
})
