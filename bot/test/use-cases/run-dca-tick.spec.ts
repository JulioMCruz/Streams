/**
 * Tests for use-cases/run-dca-tick.ts — RunDcaTickUseCase.
 *
 * Audit findings:
 * - All ports are injected via constructor: fully stubbable.
 * - tick() now requires a `guard: StreamGuardPort` dependency (new).
 * - tick() now reads gateway.getStreamCloseThresholdBps() once per tick,
 *   alongside block + cooldown, sharing the parallel Promise.all read.
 * - Before the cooldown check, tick() reads chain.readStreamHealth for each
 *   account and calls shouldCloseStream (pure domain). When true, it calls
 *   guard.closeStream, logs stream_auto_closed, and continues to the next
 *   account (no swap).
 * - When stream is healthy (deposit===0 or availableBalance well above
 *   trigger), the guardian does NOT close; normal swap flow proceeds.
 * - A guard.closeStream rejection is caught by the per-account try/catch,
 *   logged as account_iteration_failed, and the tick continues.
 * - All existing cooldown/balance/quote/execute paths are unaffected; their
 *   tests are updated minimally to supply the new fakes with safe defaults.
 */

import { expect } from 'chai'
import sinon, { type SinonStub } from 'sinon'

import type { StrategyTokens } from '../../src/domain/strategy.js'
import type { ChainStatePort } from '../../src/ports/chain-state-port.js'
import type { QuoteProviderPort } from '../../src/ports/quote-provider-port.js'
import type { SmartAccountRegistryPort } from '../../src/ports/smart-account-registry-port.js'
import type { StreamGuardPort } from '../../src/ports/stream-guard-port.js'
import type { SwapExecutorPort } from '../../src/ports/swap-executor-port.js'
import type { SwapGatewayPort } from '../../src/ports/swap-gateway-port.js'
import { RunDcaTickUseCase } from '../../src/use-cases/run-dca-tick.js'
import type { Logger } from '../../src/utils/logger.js'

// ── Address fixtures ──────────────────────────────────────────────────────────
const SA1 = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01' as const
const SA2 = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB02' as const
const USER1 = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC03' as const
const USDCX = '0x1eFe44b4B786AAF3C6FEDF9B9d0BC0F64E1e60c' as const
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
const WETH = '0x4200000000000000000000000000000000000006' as const
const ROUTER = '0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEAD01' as const
const TX_HASH = '0xdeadbeef00000000000000000000000000000000000000000000000000000001' as const
const CLOSE_TX_HASH = '0xcafe000000000000000000000000000000000000000000000000000000000002' as const

// ── Port stubs builder ────────────────────────────────────────────────────────
interface Stubs {
	registry: { discover: SinonStub }
	chain: {
		getBlockNumber: SinonStub
		readSmartAccountState: SinonStub
		readErc20Balance: SinonStub
		readStreamHealth: SinonStub
	}
	gateway: {
		getSwapCooldownBlocks: SinonStub
		getLastSwapBlock: SinonStub
		getStreamCloseThresholdBps: SinonStub
	}
	quotes: { fetchQuote: SinonStub }
	executor: { executeSwap: SinonStub }
	guard: { closeStream: SinonStub }
	logger: { info: SinonStub; warn: SinonStub; error: SinonStub }
}

function buildStubs(): Stubs {
	return {
		registry: { discover: sinon.stub() },
		chain: {
			getBlockNumber: sinon.stub(),
			readSmartAccountState: sinon.stub(),
			readErc20Balance: sinon.stub(),
			readStreamHealth: sinon.stub(),
		},
		gateway: {
			getSwapCooldownBlocks: sinon.stub(),
			getLastSwapBlock: sinon.stub(),
			getStreamCloseThresholdBps: sinon.stub(),
		},
		quotes: { fetchQuote: sinon.stub() },
		executor: { executeSwap: sinon.stub() },
		guard: { closeStream: sinon.stub() },
		logger: {
			info: sinon.stub(),
			warn: sinon.stub(),
			error: sinon.stub(),
		},
	}
}

const strategy: StrategyTokens = {
	superTokenIn: USDCX,
	tokenIn: USDC,
	superToUnderlyingDivisor: 10n ** 12n,
}

function buildUseCase(stubs: Stubs): RunDcaTickUseCase {
	return new RunDcaTickUseCase({
		registry: stubs.registry as unknown as SmartAccountRegistryPort,
		chain: stubs.chain as unknown as ChainStatePort,
		gateway: stubs.gateway as unknown as SwapGatewayPort,
		quotes: stubs.quotes as unknown as QuoteProviderPort,
		executor: stubs.executor as unknown as SwapExecutorPort,
		guard: stubs.guard as unknown as StreamGuardPort,
		strategy,
		logger: stubs.logger as unknown as Logger,
	})
}

function validState() {
	return {
		smartAccount: SA1,
		owner: USER1,
		operator: USER1,
		maxSlippageBps: 100,
		minTradeAmount: 1_000_000n,
		settlementAddress: USER1,
		targetTokens: [WETH],
	}
}

/**
 * Default healthy stream: deposit === 0n → shouldCloseStream returns false,
 * guardian path is never triggered.  All existing swap tests rely on this.
 */
function defaultSetup(stubs: Stubs) {
	stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
	stubs.chain.getBlockNumber.resolves(1000n)
	stubs.gateway.getSwapCooldownBlocks.resolves(5n)
	stubs.gateway.getLastSwapBlock.resolves(0n) // never swapped → not cooling down
	stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n) // 10%
	// deposit=0 → shouldCloseStream returns false → guardian skipped
	stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
	stubs.chain.readSmartAccountState.resolves(validState())
	stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n) // 5 USDCx
	stubs.quotes.fetchQuote.resolves({
		to: ROUTER,
		data: '0xdeadbeef',
		value: 0n,
		minAmountOut: 4_500_000n,
	})
	stubs.executor.executeSwap.resolves(TX_HASH)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RunDcaTickUseCase', function () {
	describe('tick', function () {
		let stubs: Stubs
		let useCase: RunDcaTickUseCase

		beforeEach(function () {
			stubs = buildStubs()
			useCase = buildUseCase(stubs)
		})

		afterEach(function () {
			sinon.restore()
		})

		// ── Full happy path ──────────────────────────────────────────────

		it('Should execute a complete swap for a single valid account', async function () {
			defaultSetup(stubs)

			await useCase.tick()

			expect(stubs.executor.executeSwap.calledOnce).to.be.true
			const [decision, quote] = stubs.executor.executeSwap.firstCall.args
			expect(decision.smartAccount).to.equal(SA1)
			expect(decision.tokenOut).to.equal(WETH)
			expect(quote.to).to.equal(ROUTER)
		})

		it('Should log discovered_smart_accounts with the correct count', async function () {
			defaultSetup(stubs)
			await useCase.tick()

			const infoCalls = stubs.logger.info.getCalls()
			const discoveryCall = infoCalls.find(
				c => c.args[1] === 'discovered_smart_accounts',
			)
			expect(discoveryCall).to.exist
			expect(discoveryCall!.args[0]).to.deep.include({ count: 1 })
		})

		it('Should log trade_decided with amounts and tokens before submitting', async function () {
			defaultSetup(stubs)
			await useCase.tick()

			const tradeLog = stubs.logger.info
				.getCalls()
				.find(c => c.args[1] === 'trade_decided')
			expect(tradeLog).to.exist
			expect(tradeLog!.args[0]).to.include.keys(
				'smartAccount', 'superAmountIn', 'underlyingAmountIn', 'tokenIn', 'tokenOut',
			)
		})

		it('Should log execute_swap_submitted with the tx hash on success', async function () {
			defaultSetup(stubs)
			await useCase.tick()

			const submitLog = stubs.logger.info
				.getCalls()
				.find(c => c.args[1] === 'execute_swap_submitted')
			expect(submitLog).to.exist
			expect(submitLog!.args[0]).to.deep.include({ txHash: TX_HASH, smartAccount: SA1 })
		})

		it('Should read currentBlock, cooldownBlocks, and closeThresholdBps once per tick (shared across accounts)', async function () {
			stubs.registry.discover.resolves([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState.resolves(validState())
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)
			stubs.quotes.fetchQuote.resolves({ to: ROUTER, data: '0xdeadbeef', value: 0n, minAmountOut: 4_500_000n })
			stubs.executor.executeSwap.resolves(TX_HASH)

			await useCase.tick()

			expect(stubs.chain.getBlockNumber.callCount).to.equal(1)
			expect(stubs.gateway.getSwapCooldownBlocks.callCount).to.equal(1)
			expect(stubs.gateway.getStreamCloseThresholdBps.callCount).to.equal(1)
		})

		it('Should call fetchQuote with the correct request derived from the decision', async function () {
			defaultSetup(stubs)
			await useCase.tick()

			expect(stubs.quotes.fetchQuote.calledOnce).to.be.true
			const req = stubs.quotes.fetchQuote.firstCall.args[0]
			expect(req.tokenIn).to.equal(USDC)
			expect(req.tokenOut).to.equal(WETH)
			expect(req.amountIn).to.equal(4_500_000n) // 90% margin: (5 USDCx * 0.9) / 1e12
			expect(req.swapper).to.equal(SA1)
			expect(req.slippageBps).to.equal(100)
		})

		// ── Cooldown skip ────────────────────────────────────────────────

		it('Should skip an account still within the cooldown window', async function () {
			// lastSwapBlock=1000, cooldown=5: window=[1000,1004]; currentBlock=1000 → active
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(1000n) // just swapped
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			// readSmartAccountState should NOT be called for a cooling-down account
			stubs.chain.readSmartAccountState.resolves(validState())
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)

			await useCase.tick()

			expect(stubs.chain.readSmartAccountState.called).to.be.false
			expect(stubs.executor.executeSwap.called).to.be.false
		})

		it('Should log swap_cooldown_active_skipping when skipping a cooling account', async function () {
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(1000n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })

			await useCase.tick()

			const cooldownLog = stubs.logger.info
				.getCalls()
				.find(c => c.args[1] === 'swap_cooldown_active_skipping')
			expect(cooldownLog).to.exist
			expect(cooldownLog!.args[0]).to.include.keys('smartAccount', 'lastSwapBlock', 'currentBlock', 'cooldownBlocks')
		})

		it('Should not skip an account whose cooldown just expired', async function () {
			// lastSwapBlock=990, cooldown=5: window ends at 994. currentBlock=995 → inactive.
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(995n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(990n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState.resolves(validState())
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)
			stubs.quotes.fetchQuote.resolves({ to: ROUTER, data: '0xdeadbeef', value: 0n, minAmountOut: 4_500_000n })
			stubs.executor.executeSwap.resolves(TX_HASH)

			await useCase.tick()

			expect(stubs.chain.readSmartAccountState.calledOnce).to.be.true
			expect(stubs.executor.executeSwap.calledOnce).to.be.true
		})

		// ── Balance unavailable ──────────────────────────────────────────

		it('Should log warn and skip an account when readErc20Balance throws', async function () {
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState.resolves(validState())
			stubs.chain.readErc20Balance.rejects(new Error('rpc timeout'))

			await useCase.tick()

			const warnLog = stubs.logger.warn
				.getCalls()
				.find(c => c.args[1] === 'super_token_balance_unavailable')
			expect(warnLog).to.exist
			expect(stubs.executor.executeSwap.called).to.be.false
		})

		it('Should continue to the next account after a balance read failure', async function () {
			stubs.registry.discover.resolves([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState.resolves(validState())
			// SA1 fails, SA2 succeeds
			stubs.chain.readErc20Balance
				.onFirstCall().rejects(new Error('rpc timeout'))
				.onSecondCall().resolves(5_000_000_000_000_000_000n)
			stubs.quotes.fetchQuote.resolves({ to: ROUTER, data: '0xdeadbeef', value: 0n, minAmountOut: 4_500_000n })
			stubs.executor.executeSwap.resolves(TX_HASH)

			await useCase.tick()

			// SA2 should have been processed
			expect(stubs.executor.executeSwap.calledOnce).to.be.true
		})

		// ── No trade decision ────────────────────────────────────────────

		it('Should not call fetchQuote when decideSwap returns null (empty targetTokens)', async function () {
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState.resolves({
				...validState(),
				targetTokens: [], // no targets → decideSwap returns null
			})
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)

			await useCase.tick()

			expect(stubs.quotes.fetchQuote.called).to.be.false
			expect(stubs.executor.executeSwap.called).to.be.false
		})

		it('Should log no_trade_insufficient_balance_or_no_targets when decision is null', async function () {
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState.resolves({
				...validState(),
				targetTokens: [],
			})
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)

			await useCase.tick()

			const noTradeLog = stubs.logger.info
				.getCalls()
				.find(c => c.args[1] === 'no_trade_insufficient_balance_or_no_targets')
			expect(noTradeLog).to.exist
		})

		it('Should not call fetchQuote when balance is below minTradeAmount', async function () {
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState.resolves({
				...validState(),
				minTradeAmount: 10_000_000n, // 10 USDC
			})
			// Only 0.5 USDCx = 500_000 USDC-equivalent < 10_000_000
			stubs.chain.readErc20Balance.resolves(500_000_000_000_000_000n)

			await useCase.tick()

			expect(stubs.quotes.fetchQuote.called).to.be.false
		})

		// ── Quote unavailable ────────────────────────────────────────────

		it('Should not call executeSwap when fetchQuote returns null', async function () {
			defaultSetup(stubs)
			stubs.quotes.fetchQuote.resolves(null)

			await useCase.tick()

			expect(stubs.executor.executeSwap.called).to.be.false
		})

		it('Should log quote_unavailable_skipping when quote is null', async function () {
			defaultSetup(stubs)
			stubs.quotes.fetchQuote.resolves(null)

			await useCase.tick()

			const warnLog = stubs.logger.warn
				.getCalls()
				.find(c => c.args[1] === 'quote_unavailable_skipping')
			expect(warnLog).to.exist
			expect(warnLog!.args[0]).to.deep.include({ smartAccount: SA1 })
		})

		// ── Outer error catch (per-account) ──────────────────────────────

		it('Should catch errors from readSmartAccountState and log account_iteration_failed', async function () {
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState.rejects(new Error('contract reverted'))
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)

			await useCase.tick()

			const errLog = stubs.logger.error
				.getCalls()
				.find(c => c.args[1] === 'account_iteration_failed')
			expect(errLog).to.exist
			expect(errLog!.args[0]).to.include.keys('smartAccount', 'err')
			expect(errLog!.args[0].err).to.include('contract reverted')
		})

		it('Should catch executeSwap errors and continue with remaining accounts', async function () {
			stubs.registry.discover.resolves([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState.resolves(validState())
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)
			stubs.quotes.fetchQuote.resolves({ to: ROUTER, data: '0xdeadbeef', value: 0n, minAmountOut: 4_500_000n })
			// SA1 fails to execute, SA2 succeeds
			stubs.executor.executeSwap
				.onFirstCall().rejects(new Error('simulation failed'))
				.onSecondCall().resolves(TX_HASH)

			await useCase.tick()

			expect(stubs.executor.executeSwap.callCount).to.equal(2)
			const errLog = stubs.logger.error
				.getCalls()
				.find(c => c.args[1] === 'account_iteration_failed')
			expect(errLog).to.exist
		})

		it('Should log non-Error throws as stringified values', async function () {
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			// Throw a plain string (not an Error instance)
			stubs.chain.readSmartAccountState.rejects('plain string throw')
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)

			await useCase.tick()

			const errLog = stubs.logger.error
				.getCalls()
				.find(c => c.args[1] === 'account_iteration_failed')
			expect(errLog).to.exist
			expect(typeof errLog!.args[0].err).to.equal('string')
		})

		it('Should stringify a non-Error thrown value via String() when err is not an Error instance', async function () {
			// Covers the `String(err)` branch in:
			//   err: err instanceof Error ? err.message : String(err)
			// sinon.stub().rejects(string) wraps the string in an Error, so `instanceof Error`
			// is always true there. We need callsFake to throw a raw non-Error value (a number).
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			// Throw a plain number — not an Error instance
			stubs.chain.readSmartAccountState.callsFake(() => Promise.reject(404))
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)

			await useCase.tick()

			const errLog = stubs.logger.error
				.getCalls()
				.find(c => c.args[1] === 'account_iteration_failed')
			expect(errLog).to.exist
			// String(404) = '404'
			expect(errLog!.args[0].err).to.equal('404')
		})

		it('Should log a SWAP_COOLDOWN_ACTIVE revert as an expected skip, not a failure (H-07)', async function () {
			defaultSetup(stubs)
			// Race: another bot swapped this SA between our cooldown read and submit.
			stubs.executor.executeSwap.rejects(
				new Error('execution reverted: SWAP_COOLDOWN_ACTIVE()'),
			)

			await useCase.tick()

			const skipLog = stubs.logger.info
				.getCalls()
				.find(c => c.args[1] === 'swap_cooldown_revert_skipping')
			expect(skipLog, 'expected swap_cooldown_revert_skipping info log').to.exist
			expect(skipLog!.args[0]).to.deep.include({ smartAccount: SA1 })
			// Must NOT be escalated to the error channel.
			const errLog = stubs.logger.error
				.getCalls()
				.find(c => c.args[1] === 'account_iteration_failed')
			expect(errLog, 'cooldown revert must not log account_iteration_failed').to.not.exist
		})

		// ── Empty registry ────────────────────────────────────────────────

		it('Should do nothing except log when no accounts are discovered', async function () {
			stubs.registry.discover.resolves([])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)

			await useCase.tick()

			expect(stubs.chain.readSmartAccountState.called).to.be.false
			expect(stubs.executor.executeSwap.called).to.be.false
			const discoveryLog = stubs.logger.info
				.getCalls()
				.find(c => c.args[1] === 'discovered_smart_accounts')
			expect(discoveryLog!.args[0]).to.deep.include({ count: 0 })
		})

		// ── Multi-account sequential processing ──────────────────────────

		it('Should process multiple accounts independently in sequence', async function () {
			const state2 = { ...validState(), smartAccount: SA2 }
			stubs.registry.discover.resolves([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState
				.onFirstCall().resolves(validState())
				.onSecondCall().resolves(state2)
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)
			stubs.quotes.fetchQuote.resolves({ to: ROUTER, data: '0xdeadbeef', value: 0n, minAmountOut: 4_500_000n })
			stubs.executor.executeSwap.resolves(TX_HASH)

			await useCase.tick()

			expect(stubs.executor.executeSwap.callCount).to.equal(2)
		})

		// ── Cooldown with zero blocks (disabled) ──────────────────────────

		it('Should not skip any account when cooldownBlocks is 0', async function () {
			defaultSetup(stubs)
			stubs.gateway.getSwapCooldownBlocks.resolves(0n)
			// last swap was at the same block as current
			stubs.gateway.getLastSwapBlock.resolves(1000n)

			await useCase.tick()

			// isCooldownActive(1000, 1000, 0) = false → should proceed
			expect(stubs.chain.readSmartAccountState.calledOnce).to.be.true
			expect(stubs.executor.executeSwap.calledOnce).to.be.true
		})

		// ── Stream guardian: auto-close path ─────────────────────────────

		it('Should call guard.closeStream and skip swap when shouldCloseStream is true', async function () {
			// deposit=10_000n, threshold=1000bps → trigger=1000n
			// availableBalance=500 ≤ trigger → shouldCloseStream returns true
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({
				availableBalance: 500n,
				deposit: 10_000n,
			})
			stubs.guard.closeStream.resolves(CLOSE_TX_HASH)
			// readSmartAccountState and executeSwap must NOT be called
			stubs.chain.readSmartAccountState.resolves(validState())
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)

			await useCase.tick()

			expect(stubs.guard.closeStream.calledOnce).to.be.true
			expect(stubs.chain.readSmartAccountState.called).to.be.false
			expect(stubs.executor.executeSwap.called).to.be.false
		})

		it('Should call guard.closeStream with (smartAccount, superTokenIn)', async function () {
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 500n, deposit: 10_000n })
			stubs.guard.closeStream.resolves(CLOSE_TX_HASH)

			await useCase.tick()

			expect(stubs.guard.closeStream.calledOnce).to.be.true
			const [saArg, tokenArg] = stubs.guard.closeStream.firstCall.args
			expect(saArg).to.equal(SA1)
			expect(tokenArg).to.equal(USDCX) // strategy.superTokenIn
		})

		it('Should log stream_auto_closed with the correct payload when closing a stream', async function () {
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 500n, deposit: 10_000n })
			stubs.guard.closeStream.resolves(CLOSE_TX_HASH)

			await useCase.tick()

			const closeLog = stubs.logger.info
				.getCalls()
				.find(c => c.args[1] === 'stream_auto_closed')
			expect(closeLog).to.exist
			expect(closeLog!.args[0]).to.include.keys(
				'smartAccount', 'user', 'availableBalance', 'deposit', 'txHash',
			)
			expect(closeLog!.args[0].smartAccount).to.equal(SA1)
			expect(closeLog!.args[0].user).to.equal(USER1)
			expect(closeLog!.args[0].availableBalance).to.equal(500n)
			expect(closeLog!.args[0].deposit).to.equal(10_000n)
			expect(closeLog!.args[0].txHash).to.equal(CLOSE_TX_HASH)
		})

		it('Should NOT call guard.closeStream when stream is healthy (deposit > 0 but balance well above trigger)', async function () {
			// deposit=10_000n, threshold=1000bps → trigger=1000n
			// availableBalance=5000 > trigger → shouldCloseStream returns false
			defaultSetup(stubs)
			stubs.chain.readStreamHealth.resolves({
				availableBalance: 5_000n,
				deposit: 10_000n,
			})

			await useCase.tick()

			expect(stubs.guard.closeStream.called).to.be.false
			// Normal swap proceeds
			expect(stubs.executor.executeSwap.calledOnce).to.be.true
		})

		it('Should NOT call guard.closeStream when deposit is 0 (no active stream)', async function () {
			// deposit=0 → shouldCloseStream returns false regardless of balance
			defaultSetup(stubs)
			stubs.chain.readStreamHealth.resolves({
				availableBalance: 0n,
				deposit: 0n,
			})

			await useCase.tick()

			expect(stubs.guard.closeStream.called).to.be.false
			// Normal swap proceeds
			expect(stubs.executor.executeSwap.calledOnce).to.be.true
		})

		it('Should close stream when availableBalance exactly equals the trigger (boundary inclusive)', async function () {
			// deposit=10_000n, threshold=1000bps → trigger=1000n
			// availableBalance=1000 === trigger → shouldCloseStream returns true
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 1_000n, deposit: 10_000n })
			stubs.guard.closeStream.resolves(CLOSE_TX_HASH)

			await useCase.tick()

			expect(stubs.guard.closeStream.calledOnce).to.be.true
			expect(stubs.executor.executeSwap.called).to.be.false
		})

		it('Should not close stream when availableBalance is exactly one above the trigger (boundary exclusive)', async function () {
			// deposit=10_000n, threshold=1000bps → trigger=1000n
			// availableBalance=1001 > trigger → shouldCloseStream returns false
			defaultSetup(stubs)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 1_001n, deposit: 10_000n })

			await useCase.tick()

			expect(stubs.guard.closeStream.called).to.be.false
			expect(stubs.executor.executeSwap.calledOnce).to.be.true
		})

		it('Should close stream when availableBalance is negative (critically low)', async function () {
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: -1n, deposit: 10_000n })
			stubs.guard.closeStream.resolves(CLOSE_TX_HASH)

			await useCase.tick()

			expect(stubs.guard.closeStream.calledOnce).to.be.true
			expect(stubs.executor.executeSwap.called).to.be.false
		})

		it('Should catch a closeStream rejection and log account_iteration_failed, then continue', async function () {
			// guard.closeStream throws → per-account try/catch logs the error and moves on
			stubs.registry.discover.resolves([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			// SA1: stream low → guard throws
			// SA2: healthy stream → swap proceeds
			stubs.chain.readStreamHealth
				.onFirstCall().resolves({ availableBalance: 500n, deposit: 10_000n })
				.onSecondCall().resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.guard.closeStream.rejects(new Error('STREAM_NOT_ACTIVE'))
			stubs.chain.readSmartAccountState.resolves(validState())
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)
			stubs.quotes.fetchQuote.resolves({ to: ROUTER, data: '0xdeadbeef', value: 0n, minAmountOut: 4_500_000n })
			stubs.executor.executeSwap.resolves(TX_HASH)

			await useCase.tick()

			// SA1 failed via closeStream → account_iteration_failed
			const errLog = stubs.logger.error
				.getCalls()
				.find(c => c.args[1] === 'account_iteration_failed')
			expect(errLog).to.exist
			expect(errLog!.args[0].smartAccount).to.equal(SA1)
			// SA2 should still have been swapped
			expect(stubs.executor.executeSwap.calledOnce).to.be.true
		})

		it('Should handle one account closing stream and another executing swap in the same tick', async function () {
			// SA1: stream near buffer → close; SA2: healthy → swap
			stubs.registry.discover.resolves([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			// SA1 health: needs closing
			stubs.chain.readStreamHealth
				.onFirstCall().resolves({ availableBalance: 500n, deposit: 10_000n })
				.onSecondCall().resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.guard.closeStream.resolves(CLOSE_TX_HASH)
			stubs.chain.readSmartAccountState.resolves({ ...validState(), smartAccount: SA2 })
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)
			stubs.quotes.fetchQuote.resolves({ to: ROUTER, data: '0xdeadbeef', value: 0n, minAmountOut: 4_500_000n })
			stubs.executor.executeSwap.resolves(TX_HASH)

			await useCase.tick()

			// SA1 closed, SA2 swapped
			expect(stubs.guard.closeStream.calledOnce).to.be.true
			expect(stubs.executor.executeSwap.calledOnce).to.be.true
			// readSmartAccountState should only have been called for SA2, not SA1
			expect(stubs.chain.readSmartAccountState.callCount).to.equal(1)
		})

		it('Should read readStreamHealth for every account on each tick', async function () {
			stubs.registry.discover.resolves([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState.resolves(validState())
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)
			stubs.quotes.fetchQuote.resolves({ to: ROUTER, data: '0xdeadbeef', value: 0n, minAmountOut: 4_500_000n })
			stubs.executor.executeSwap.resolves(TX_HASH)

			await useCase.tick()

			// One readStreamHealth call per account
			expect(stubs.chain.readStreamHealth.callCount).to.equal(2)
		})

		it('Should pass (superTokenIn, user) to readStreamHealth', async function () {
			stubs.registry.discover.resolves([{ user: USER1, smartAccount: SA1 }])
			stubs.chain.getBlockNumber.resolves(1000n)
			stubs.gateway.getSwapCooldownBlocks.resolves(5n)
			stubs.gateway.getLastSwapBlock.resolves(0n)
			stubs.gateway.getStreamCloseThresholdBps.resolves(1_000n)
			stubs.chain.readStreamHealth.resolves({ availableBalance: 5_000_000_000_000_000_000n, deposit: 0n })
			stubs.chain.readSmartAccountState.resolves(validState())
			stubs.chain.readErc20Balance.resolves(5_000_000_000_000_000_000n)
			stubs.quotes.fetchQuote.resolves({ to: ROUTER, data: '0xdeadbeef', value: 0n, minAmountOut: 4_500_000n })
			stubs.executor.executeSwap.resolves(TX_HASH)

			await useCase.tick()

			const [superToken, sender] = stubs.chain.readStreamHealth.firstCall.args
			expect(superToken).to.equal(USDCX) // strategy.superTokenIn
			expect(sender).to.equal(USER1)     // the user, not the smart account
		})
	})
})
