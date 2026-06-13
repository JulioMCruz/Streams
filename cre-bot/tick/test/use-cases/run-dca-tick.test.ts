/**
 * Tests for use-cases/run-dca-tick.ts — RunDcaTickUseCase.
 *
 * Ported from bot/test/use-cases/run-dca-tick.spec.ts, adapted to bun:test.
 * Uses hand-written port fakes (no chain / network) — the use case receives all
 * dependencies through constructor injection.
 *
 * Audit findings:
 * - All ports are injected via constructor: fully fakeable.
 * - tick() reads currentBlock, cooldownBlocks and closeThresholdBps once per tick
 *   in a shared Promise.all (not per-account).
 * - For each account: stream health → shouldCloseStream → cooldown check → state read
 *   → balance read → decideSwap → fetchQuote → executeSwap.
 * - A SWAP_COOLDOWN_ACTIVE revert is an expected race (H-07): logged as info, not error.
 * - A failure on one account is logged and skipped; the tick continues.
 */

import { describe, expect, it } from 'bun:test'

import type { QuoteResult } from '../../src/domain/models/quote'
import type { SmartAccountState } from '../../src/domain/models/smart-account'
import type { StreamHealth } from '../../src/domain/models/stream-health'
import type { StrategyTokens } from '../../src/domain/strategy'
import type { ChainStatePort } from '../../src/ports/chain-state-port'
import type { QuoteProviderPort } from '../../src/ports/quote-provider-port'
import type { SmartAccountRegistryPort } from '../../src/ports/smart-account-registry-port'
import type { StreamGuardPort } from '../../src/ports/stream-guard-port'
import type { SwapExecutorPort } from '../../src/ports/swap-executor-port'
import type { SwapGatewayPort } from '../../src/ports/swap-gateway-port'
import { RunDcaTickUseCase } from '../../src/use-cases/run-dca-tick'
import type { LogContext, Logger } from '../../src/utils/logger'

// ── Address fixtures ──────────────────────────────────────────────────────────
const SA1 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const
const SA2 = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' as const
const USER1 = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as const
const USDCX = '0x1eFe44b4B786AAF3C6FEDF9B9d0BC0F64E1e60c' as const
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
const WETH = '0x4200000000000000000000000000000000000006' as const
const ROUTER = '0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEAD01' as const
const TX_HASH = '0xdeadbeef00000000000000000000000000000000000000000000000000000001' as const
const CLOSE_TX_HASH = '0xcafe000000000000000000000000000000000000000000000000000000000002' as const

// ── Simple call recorder — bun:test has no sinon, we hand-roll minimal stubs ──

type Call = { args: unknown[] }

// ── Port fakes ────────────────────────────────────────────────────────────────

interface LogEntry {
	ctx: LogContext | string
	msg?: string
}

function makeLogger() {
	const infoLog: LogEntry[] = []
	const warnLog: LogEntry[] = []
	const errorLog: LogEntry[] = []

	const logger: Logger = {
		info: (ctx, msg) => infoLog.push({ ctx, msg }),
		warn: (ctx, msg) => warnLog.push({ ctx, msg }),
		error: (ctx, msg) => errorLog.push({ ctx, msg }),
	}

	return {
		logger,
		infoLog,
		warnLog,
		errorLog,
		findInfo: (event: string) => infoLog.find((e) => e.msg === event || e.ctx === event),
		findWarn: (event: string) => warnLog.find((e) => e.msg === event || e.ctx === event),
		findError: (event: string) => errorLog.find((e) => e.msg === event || e.ctx === event),
	}
}

const strategy: StrategyTokens = {
	superTokenIn: USDCX,
	tokenIn: USDC,
	superToUnderlyingDivisor: 10n ** 12n,
}

function validState(sa = SA1): SmartAccountState {
	return {
		smartAccount: sa,
		owner: USER1,
		operator: USER1,
		maxSlippageBps: 100,
		minTradeAmount: 1_000_000n,
		settlementAddress: USER1,
		targetTokens: [WETH],
	}
}

function healthyStream(): StreamHealth {
	return { availableBalance: 5_000_000_000_000_000_000n, deposit: 0n }
}

function validQuote(): QuoteResult {
	return { to: ROUTER, data: '0xdeadbeef', value: 0n, minAmountOut: 4_500_000n }
}

interface PortFakes {
	registry: SmartAccountRegistryPort
	chain: ChainStatePort & {
		getBlockNumberFn: (v: bigint) => void
		setHealth: (h: StreamHealth) => void
		setHealthSeq: (hs: StreamHealth[]) => void
		setBalance: (b: bigint) => void
		setBalanceSeq: (bs: (bigint | Error)[]) => void
		setState: (s: SmartAccountState) => void
		setStateSeq: (ss: (SmartAccountState | Error)[]) => void
	}
	gateway: SwapGatewayPort & {
		setCooldownBlocks: (n: bigint) => void
		setLastSwapBlock: (n: bigint) => void
		setThreshold: (n: bigint) => void
	}
	quotes: QuoteProviderPort & { setQuote: (q: QuoteResult | null) => void }
	executor: SwapExecutorPort & {
		executeSwapCalls: Call[]
		setResult: (r: string | Error) => void
		setResultSeq: (rs: (string | Error)[]) => void
	}
	guard: StreamGuardPort & {
		closeStreamCalls: Call[]
		setResult: (r: string | Error) => void
	}
	logs: ReturnType<typeof makeLogger>
}

function buildFakes(
	accountList: Array<{ user: string; smartAccount: string }> = [{ user: USER1, smartAccount: SA1 }],
): PortFakes {
	let blockNumber = 1000n
	let cooldownBlocks = 5n
	let lastSwapBlock = 0n
	let threshold = 1_000n
	let health: StreamHealth = healthyStream()
	let healthSeq: StreamHealth[] | null = null
	let healthIdx = 0
	let balance: bigint = 5_000_000_000_000_000_000n
	let balanceSeq: (bigint | Error)[] | null = null
	let balanceIdx = 0
	let state: SmartAccountState = validState()
	let stateSeq: (SmartAccountState | Error)[] | null = null
	let stateIdx = 0
	let quote: QuoteResult | null = validQuote()
	let executeResult: string | Error = TX_HASH
	let executeSeq: (string | Error)[] | null = null
	let executeIdx = 0
	let closeResult: string | Error = CLOSE_TX_HASH
	const executeSwapCalls: Call[] = []
	const closeStreamCalls: Call[] = []

	const logs = makeLogger()

	const chain: PortFakes['chain'] = {
		async getBlockNumber() {
			return blockNumber
		},
		async readSmartAccountState(_sa) {
			if (stateSeq !== null) {
				const v = stateSeq[stateIdx++ % stateSeq.length]
				if (v instanceof Error) throw v
				return v!
			}
			return state
		},
		async readErc20Balance(_token, _holder) {
			if (balanceSeq !== null) {
				const v = balanceSeq[balanceIdx++ % balanceSeq.length]
				if (v instanceof Error) throw v
				return v as bigint
			}
			return balance
		},
		async readStreamHealth(_super, _sender) {
			if (healthSeq !== null) {
				const v = healthSeq[healthIdx++ % healthSeq.length]
				return v!
			}
			return health
		},
		getBlockNumberFn: (v: bigint) => {
			blockNumber = v
		},
		setHealth: (h: StreamHealth) => {
			health = h
			healthSeq = null
			healthIdx = 0
		},
		setHealthSeq: (hs: StreamHealth[]) => {
			healthSeq = hs
			healthIdx = 0
		},
		setBalance: (b: bigint) => {
			balance = b
			balanceSeq = null
			balanceIdx = 0
		},
		setBalanceSeq: (bs: (bigint | Error)[]) => {
			balanceSeq = bs
			balanceIdx = 0
		},
		setState: (s: SmartAccountState) => {
			state = s
			stateSeq = null
			stateIdx = 0
		},
		setStateSeq: (ss: (SmartAccountState | Error)[]) => {
			stateSeq = ss
			stateIdx = 0
		},
	}

	const gateway: PortFakes['gateway'] = {
		async getSwapCooldownBlocks() {
			return cooldownBlocks
		},
		async getLastSwapBlock(_sa) {
			return lastSwapBlock
		},
		async getStreamCloseThresholdBps() {
			return threshold
		},
		setCooldownBlocks: (n) => {
			cooldownBlocks = n
		},
		setLastSwapBlock: (n) => {
			lastSwapBlock = n
		},
		setThreshold: (n) => {
			threshold = n
		},
	}

	const quotes: PortFakes['quotes'] = {
		async fetchQuote(_req) {
			return quote
		},
		setQuote: (q) => {
			quote = q
		},
	}

	const executor: PortFakes['executor'] = {
		async executeSwap(decision, q) {
			executeSwapCalls.push({ args: [decision, q] })
			if (executeSeq !== null) {
				const v = executeSeq[executeIdx++ % executeSeq.length]
				if (v instanceof Error) throw v
				return v as `0x${string}`
			}
			if (executeResult instanceof Error) throw executeResult
			return executeResult as `0x${string}`
		},
		executeSwapCalls,
		setResult: (r) => {
			executeResult = r
			executeSeq = null
			executeIdx = 0
		},
		setResultSeq: (rs) => {
			executeSeq = rs
			executeIdx = 0
		},
	}

	const guard: PortFakes['guard'] = {
		async closeStream(sa, token) {
			closeStreamCalls.push({ args: [sa, token] })
			if (closeResult instanceof Error) throw closeResult
			return closeResult as `0x${string}`
		},
		closeStreamCalls,
		setResult: (r) => {
			closeResult = r
		},
	}

	return {
		registry: {
			discover: async () =>
				accountList.map((a) => ({
					user: a.user as `0x${string}`,
					smartAccount: a.smartAccount as `0x${string}`,
				})),
		},
		chain,
		gateway,
		quotes,
		executor,
		guard,
		logs,
	}
}

function buildUseCase(fakes: PortFakes): RunDcaTickUseCase {
	return new RunDcaTickUseCase({
		registry: fakes.registry,
		chain: fakes.chain,
		gateway: fakes.gateway,
		quotes: fakes.quotes,
		executor: fakes.executor,
		guard: fakes.guard,
		strategy,
		logger: fakes.logs.logger,
	})
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RunDcaTickUseCase', () => {
	describe('tick', () => {
		// ── Full happy path ──────────────────────────────────────────────

		it('Should execute a complete swap for a single valid account', async () => {
			const fakes = buildFakes()
			await buildUseCase(fakes).tick()

			expect(fakes.executor.executeSwapCalls).toHaveLength(1)
			const [decision] = fakes.executor.executeSwapCalls[0]!.args as [ReturnType<typeof validState>]
			expect((decision as { smartAccount: string }).smartAccount).toBe(SA1)
		})

		it('Should log discovered_smart_accounts with the correct count', async () => {
			const fakes = buildFakes()
			await buildUseCase(fakes).tick()

			const log = fakes.logs.findInfo('discovered_smart_accounts')
			expect(log).toBeDefined()
			expect((log!.ctx as LogContext).count).toBe(1)
		})

		it('Should log trade_decided with amounts and tokens before submitting', async () => {
			const fakes = buildFakes()
			await buildUseCase(fakes).tick()

			const log = fakes.logs.findInfo('trade_decided')
			expect(log).toBeDefined()
			const ctx = log!.ctx as LogContext
			expect(ctx).toHaveProperty('smartAccount')
			expect(ctx).toHaveProperty('superAmountIn')
			expect(ctx).toHaveProperty('underlyingAmountIn')
			expect(ctx).toHaveProperty('tokenIn')
			expect(ctx).toHaveProperty('tokenOut')
		})

		it('Should log execute_swap_submitted with the tx hash on success', async () => {
			const fakes = buildFakes()
			await buildUseCase(fakes).tick()

			const log = fakes.logs.findInfo('execute_swap_submitted')
			expect(log).toBeDefined()
			expect((log!.ctx as LogContext).txHash).toBe(TX_HASH)
			expect((log!.ctx as LogContext).smartAccount).toBe(SA1)
		})

		it('Should call fetchQuote with the correct request derived from the decision', async () => {
			const fakes = buildFakes()
			let capturedReq: unknown = null
			const origFetch = fakes.quotes.fetchQuote.bind(fakes.quotes)
			fakes.quotes = {
				...fakes.quotes,
				fetchQuote: async (req) => {
					capturedReq = req
					return origFetch(req)
				},
			} as typeof fakes.quotes
			const uc = buildUseCase(fakes)
			await uc.tick()

			const req = capturedReq as {
				tokenIn: string
				tokenOut: string
				amountIn: bigint
				swapper: string
				slippageBps: number
			}
			expect(req.tokenIn).toBe(USDC)
			expect(req.tokenOut).toBe(WETH)
			expect(req.amountIn).toBe(4_500_000n) // 90% margin: (5 USDCx * 0.9) / 1e12
			expect(req.swapper).toBe(SA1)
			expect(req.slippageBps).toBe(100)
		})

		// ── Read shared values once per tick ─────────────────────────────

		it('Should read currentBlock, cooldownBlocks, and closeThresholdBps once per tick', async () => {
			const fakes = buildFakes([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			// Track calls
			let blockCalls = 0
			let cooldownCalls = 0
			let threshCalls = 0
			const origBlock = fakes.chain.getBlockNumber.bind(fakes.chain)
			const origCooldown = fakes.gateway.getSwapCooldownBlocks.bind(fakes.gateway)
			const origThresh = fakes.gateway.getStreamCloseThresholdBps.bind(fakes.gateway)
			fakes.chain = {
				...fakes.chain,
				getBlockNumber: async () => {
					blockCalls++
					return origBlock()
				},
			} as typeof fakes.chain
			fakes.gateway = {
				...fakes.gateway,
				getSwapCooldownBlocks: async () => {
					cooldownCalls++
					return origCooldown()
				},
				getStreamCloseThresholdBps: async () => {
					threshCalls++
					return origThresh()
				},
			} as typeof fakes.gateway
			await buildUseCase(fakes).tick()

			expect(blockCalls).toBe(1)
			expect(cooldownCalls).toBe(1)
			expect(threshCalls).toBe(1)
		})

		// ── Cooldown skip ────────────────────────────────────────────────

		it('Should skip an account still within the cooldown window', async () => {
			const fakes = buildFakes()
			fakes.gateway.setLastSwapBlock(1000n) // just swapped at current block
			await buildUseCase(fakes).tick()

			// readSmartAccountState must NOT be called for a cooling-down account
			expect(fakes.executor.executeSwapCalls).toHaveLength(0)
		})

		it('Should log swap_cooldown_active_skipping when skipping a cooling account', async () => {
			const fakes = buildFakes()
			fakes.gateway.setLastSwapBlock(1000n)
			await buildUseCase(fakes).tick()

			const log = fakes.logs.findInfo('swap_cooldown_active_skipping')
			expect(log).toBeDefined()
			const ctx = log!.ctx as LogContext
			expect(ctx).toHaveProperty('smartAccount')
			expect(ctx).toHaveProperty('lastSwapBlock')
			expect(ctx).toHaveProperty('currentBlock')
			expect(ctx).toHaveProperty('cooldownBlocks')
		})

		it('Should not skip an account whose cooldown just expired', async () => {
			const fakes = buildFakes()
			// lastSwapBlock=990, cooldown=5: window ends at 994. currentBlock=995 → inactive.
			fakes.chain.getBlockNumberFn(995n)
			fakes.gateway.setLastSwapBlock(990n)
			await buildUseCase(fakes).tick()

			expect(fakes.executor.executeSwapCalls).toHaveLength(1)
		})

		it('Should not skip any account when cooldownBlocks is 0', async () => {
			const fakes = buildFakes()
			fakes.gateway.setCooldownBlocks(0n)
			fakes.gateway.setLastSwapBlock(1000n) // same block as current
			await buildUseCase(fakes).tick()

			// isCooldownActive(1000, 1000, 0) = false → should proceed
			expect(fakes.executor.executeSwapCalls).toHaveLength(1)
		})

		// ── Balance unavailable ──────────────────────────────────────────

		it('Should log warn and skip an account when readErc20Balance throws', async () => {
			const fakes = buildFakes()
			fakes.chain.setBalanceSeq([new Error('rpc timeout')])
			await buildUseCase(fakes).tick()

			const log = fakes.logs.findWarn('super_token_balance_unavailable')
			expect(log).toBeDefined()
			expect(fakes.executor.executeSwapCalls).toHaveLength(0)
		})

		it('Should continue to the next account after a balance read failure', async () => {
			const fakes = buildFakes([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			// SA1 fails, SA2 succeeds
			fakes.chain.setBalanceSeq([new Error('rpc timeout'), 5_000_000_000_000_000_000n])
			await buildUseCase(fakes).tick()

			// SA2 should have been processed
			expect(fakes.executor.executeSwapCalls).toHaveLength(1)
		})

		// ── No trade decision ────────────────────────────────────────────

		it('Should not call fetchQuote when decideSwap returns null (empty targetTokens)', async () => {
			const fakes = buildFakes()
			fakes.chain.setState({ ...validState(), targetTokens: [] })
			let quoteCalled = false
			fakes.quotes = {
				...fakes.quotes,
				fetchQuote: async () => {
					quoteCalled = true
					return null
				},
			}
			await buildUseCase(fakes).tick()

			expect(quoteCalled).toBe(false)
			expect(fakes.executor.executeSwapCalls).toHaveLength(0)
		})

		it('Should log no_trade_insufficient_balance_or_no_targets when decision is null', async () => {
			const fakes = buildFakes()
			fakes.chain.setState({ ...validState(), targetTokens: [] })
			await buildUseCase(fakes).tick()

			const log = fakes.logs.findInfo('no_trade_insufficient_balance_or_no_targets')
			expect(log).toBeDefined()
		})

		it('Should not call fetchQuote when balance is below minTradeAmount', async () => {
			const fakes = buildFakes()
			fakes.chain.setState({ ...validState(), minTradeAmount: 10_000_000n })
			fakes.chain.setBalance(500_000_000_000_000_000n) // 0.5 USDCx = 500_000 < 10_000_000
			let quoteCalled = false
			fakes.quotes = {
				...fakes.quotes,
				fetchQuote: async () => {
					quoteCalled = true
					return null
				},
			}
			await buildUseCase(fakes).tick()

			expect(quoteCalled).toBe(false)
		})

		// ── Quote unavailable ────────────────────────────────────────────

		it('Should not call executeSwap when fetchQuote returns null', async () => {
			const fakes = buildFakes()
			fakes.quotes.setQuote(null)
			await buildUseCase(fakes).tick()

			expect(fakes.executor.executeSwapCalls).toHaveLength(0)
		})

		it('Should log quote_unavailable_skipping when quote is null', async () => {
			const fakes = buildFakes()
			fakes.quotes.setQuote(null)
			await buildUseCase(fakes).tick()

			const log = fakes.logs.findWarn('quote_unavailable_skipping')
			expect(log).toBeDefined()
			expect((log!.ctx as LogContext).smartAccount).toBe(SA1)
		})

		// ── Outer error catch (per-account) ──────────────────────────────

		it('Should catch errors from readSmartAccountState and log account_iteration_failed', async () => {
			const fakes = buildFakes()
			fakes.chain.setStateSeq([new Error('contract reverted')])
			await buildUseCase(fakes).tick()

			const log = fakes.logs.findError('account_iteration_failed')
			expect(log).toBeDefined()
			const ctx = log!.ctx as LogContext
			expect(ctx).toHaveProperty('smartAccount')
			expect(ctx).toHaveProperty('err')
			expect(String(ctx.err)).toContain('contract reverted')
		})

		it('Should catch executeSwap errors and continue with remaining accounts', async () => {
			const fakes = buildFakes([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			fakes.executor.setResultSeq([new Error('simulation failed'), TX_HASH])
			await buildUseCase(fakes).tick()

			expect(fakes.executor.executeSwapCalls).toHaveLength(2)
			expect(fakes.logs.findError('account_iteration_failed')).toBeDefined()
		})

		it('Should stringify a non-Error thrown value as a string in account_iteration_failed', async () => {
			const fakes = buildFakes()
			// Override readSmartAccountState to throw a raw number
			fakes.chain = {
				...fakes.chain,
				readSmartAccountState: async () => {
					throw 404
				},
			} as typeof fakes.chain
			await buildUseCase(fakes).tick()

			const log = fakes.logs.findError('account_iteration_failed')
			expect(log).toBeDefined()
			// String(404) = '404'
			expect((log!.ctx as LogContext).err).toBe('404')
		})

		it('Should log a SWAP_COOLDOWN_ACTIVE revert as an expected skip, not a failure (H-07)', async () => {
			const fakes = buildFakes()
			fakes.executor.setResult(new Error('execution reverted: SWAP_COOLDOWN_ACTIVE()'))
			await buildUseCase(fakes).tick()

			const skipLog = fakes.logs.findInfo('swap_cooldown_revert_skipping')
			expect(skipLog).toBeDefined()
			expect((skipLog!.ctx as LogContext).smartAccount).toBe(SA1)

			// Must NOT be escalated to the error channel
			expect(fakes.logs.findError('account_iteration_failed')).toBeUndefined()
		})

		// ── Empty registry ────────────────────────────────────────────────

		it('Should do nothing except log when no accounts are discovered', async () => {
			const fakes = buildFakes([])
			await buildUseCase(fakes).tick()

			expect(fakes.executor.executeSwapCalls).toHaveLength(0)
			const log = fakes.logs.findInfo('discovered_smart_accounts')
			expect((log!.ctx as LogContext).count).toBe(0)
		})

		// ── Multi-account sequential processing ──────────────────────────

		it('Should process multiple accounts independently in sequence', async () => {
			const fakes = buildFakes([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			await buildUseCase(fakes).tick()

			expect(fakes.executor.executeSwapCalls).toHaveLength(2)
		})

		// ── Stream guardian: auto-close path ─────────────────────────────

		it('Should call guard.closeStream and skip swap when shouldCloseStream is true', async () => {
			// deposit=10_000n, threshold=1000bps → trigger=1000n; 500 ≤ trigger → close
			const fakes = buildFakes()
			fakes.chain.setHealth({ availableBalance: 500n, deposit: 10_000n })
			await buildUseCase(fakes).tick()

			expect(fakes.guard.closeStreamCalls).toHaveLength(1)
			expect(fakes.executor.executeSwapCalls).toHaveLength(0)
		})

		it('Should call guard.closeStream with (smartAccount, superTokenIn)', async () => {
			const fakes = buildFakes()
			fakes.chain.setHealth({ availableBalance: 500n, deposit: 10_000n })
			await buildUseCase(fakes).tick()

			expect(fakes.guard.closeStreamCalls).toHaveLength(1)
			const [saArg, tokenArg] = fakes.guard.closeStreamCalls[0]!.args
			expect(saArg).toBe(SA1)
			expect(tokenArg).toBe(USDCX) // strategy.superTokenIn
		})

		it('Should log stream_auto_closed with the correct payload when closing a stream', async () => {
			const fakes = buildFakes()
			fakes.chain.setHealth({ availableBalance: 500n, deposit: 10_000n })
			await buildUseCase(fakes).tick()

			const log = fakes.logs.findInfo('stream_auto_closed')
			expect(log).toBeDefined()
			const ctx = log!.ctx as LogContext
			expect(ctx).toHaveProperty('smartAccount')
			expect(ctx).toHaveProperty('user')
			expect(ctx).toHaveProperty('availableBalance')
			expect(ctx).toHaveProperty('deposit')
			expect(ctx).toHaveProperty('txHash')
			expect(ctx.smartAccount).toBe(SA1)
			expect(ctx.user).toBe(USER1)
			expect(ctx.availableBalance).toBe(500n)
			expect(ctx.deposit).toBe(10_000n)
			expect(ctx.txHash).toBe(CLOSE_TX_HASH)
		})

		it('Should NOT call guard.closeStream when stream is healthy (balance well above trigger)', async () => {
			// deposit=10_000n, threshold=1000bps → trigger=1000n; 5000 > 1000 → healthy
			const fakes = buildFakes()
			fakes.chain.setHealth({ availableBalance: 5_000n, deposit: 10_000n })
			await buildUseCase(fakes).tick()

			expect(fakes.guard.closeStreamCalls).toHaveLength(0)
			expect(fakes.executor.executeSwapCalls).toHaveLength(1)
		})

		it('Should NOT call guard.closeStream when deposit is 0 (no active stream)', async () => {
			const fakes = buildFakes()
			fakes.chain.setHealth({ availableBalance: 0n, deposit: 0n })
			await buildUseCase(fakes).tick()

			expect(fakes.guard.closeStreamCalls).toHaveLength(0)
			expect(fakes.executor.executeSwapCalls).toHaveLength(1)
		})

		it('Should close stream when availableBalance exactly equals the trigger (boundary inclusive)', async () => {
			// deposit=10_000n, threshold=1000bps → trigger=1000n; 1000 === trigger → close
			const fakes = buildFakes()
			fakes.chain.setHealth({ availableBalance: 1_000n, deposit: 10_000n })
			await buildUseCase(fakes).tick()

			expect(fakes.guard.closeStreamCalls).toHaveLength(1)
			expect(fakes.executor.executeSwapCalls).toHaveLength(0)
		})

		it('Should not close stream when availableBalance is exactly one above the trigger', async () => {
			// deposit=10_000n, threshold=1000bps → trigger=1000n; 1001 > 1000 → healthy
			const fakes = buildFakes()
			fakes.chain.setHealth({ availableBalance: 1_001n, deposit: 10_000n })
			await buildUseCase(fakes).tick()

			expect(fakes.guard.closeStreamCalls).toHaveLength(0)
			expect(fakes.executor.executeSwapCalls).toHaveLength(1)
		})

		it('Should close stream when availableBalance is negative (critically low)', async () => {
			const fakes = buildFakes()
			fakes.chain.setHealth({ availableBalance: -1n, deposit: 10_000n })
			await buildUseCase(fakes).tick()

			expect(fakes.guard.closeStreamCalls).toHaveLength(1)
			expect(fakes.executor.executeSwapCalls).toHaveLength(0)
		})

		it('Should catch a closeStream rejection and log account_iteration_failed, then continue', async () => {
			const fakes = buildFakes([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			// SA1: stream low → guard throws; SA2: healthy stream → swap proceeds
			fakes.chain.setHealthSeq([{ availableBalance: 500n, deposit: 10_000n }, healthyStream()])
			fakes.guard.setResult(new Error('STREAM_NOT_ACTIVE'))
			await buildUseCase(fakes).tick()

			// SA1 failed via closeStream → account_iteration_failed
			const errLog = fakes.logs.findError('account_iteration_failed')
			expect(errLog).toBeDefined()
			expect((errLog!.ctx as LogContext).smartAccount).toBe(SA1)
			// SA2 should still have been swapped
			expect(fakes.executor.executeSwapCalls).toHaveLength(1)
		})

		it('Should handle one account closing stream and another executing swap in the same tick', async () => {
			// SA1: stream near buffer → close; SA2: healthy → swap
			const fakes = buildFakes([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			fakes.chain.setHealthSeq([{ availableBalance: 500n, deposit: 10_000n }, healthyStream()])
			await buildUseCase(fakes).tick()

			expect(fakes.guard.closeStreamCalls).toHaveLength(1)
			expect(fakes.executor.executeSwapCalls).toHaveLength(1)
		})

		it('Should read readStreamHealth for every account on each tick', async () => {
			const fakes = buildFakes([
				{ user: USER1, smartAccount: SA1 },
				{ user: USER1, smartAccount: SA2 },
			])
			let healthCalls = 0
			fakes.chain = {
				...fakes.chain,
				readStreamHealth: async (_super, _sender) => {
					healthCalls++
					return healthyStream()
				},
			} as typeof fakes.chain
			await buildUseCase(fakes).tick()

			// One readStreamHealth call per account
			expect(healthCalls).toBe(2)
		})

		it('Should pass (superTokenIn, user) to readStreamHealth', async () => {
			const fakes = buildFakes()
			let capturedArgs: unknown[] = []
			fakes.chain = {
				...fakes.chain,
				readStreamHealth: async (superToken, sender) => {
					capturedArgs = [superToken, sender]
					return healthyStream()
				},
			} as typeof fakes.chain
			await buildUseCase(fakes).tick()

			expect(capturedArgs[0]).toBe(USDCX) // strategy.superTokenIn
			expect(capturedArgs[1]).toBe(USER1) // the user, not the smart account
		})
	})
})
