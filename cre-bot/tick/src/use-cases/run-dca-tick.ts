/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import { isCooldownActive, isSwapCooldownRevert } from '../domain/cooldown'
import { decideSwap, type StrategyTokens } from '../domain/strategy'
import { shouldCloseStream } from '../domain/stream-guard'
import type { ChainStatePort } from '../ports/chain-state-port'
import type { QuoteProviderPort } from '../ports/quote-provider-port'
import type { SmartAccountRegistryPort } from '../ports/smart-account-registry-port'
import type { StreamGuardPort } from '../ports/stream-guard-port'
import type { SwapExecutorPort } from '../ports/swap-executor-port'
import type { SwapGatewayPort } from '../ports/swap-gateway-port'
import { formatError } from '../utils/format-error'
import type { Logger } from '../utils/logger'

export interface RunDcaTickDependencies {
	readonly registry: SmartAccountRegistryPort
	readonly chain: ChainStatePort
	readonly gateway: SwapGatewayPort
	readonly quotes: QuoteProviderPort
	readonly executor: SwapExecutorPort
	readonly guard: StreamGuardPort
	readonly strategy: StrategyTokens
	readonly logger: Logger
}

/**
 * Orchestrates one DCA tick. Receives every dependency through ports via
 * constructor injection — knows nothing about viem, fetch, the Uniswap
 * API or the filesystem. That makes it unit-testable with fakes and lets
 * the CRE workflow reuse it verbatim by swapping the signer adapter.
 *
 * Per smart account the flow is:
 *   1. skip if still within the E-05 cooldown window        [SwapGatewayPort]
 *   2. read on-chain state (rules + addresses)             [ChainStatePort]
 *   3. read the streamed SuperToken balance                 [ChainStatePort]
 *   4. decide whether/what to trade                         [pure domain]
 *   5. fetch routed calldata                                [QuoteProviderPort]
 *   6. submit executeSwap                                   [SwapExecutorPort]
 *
 * A failure on one account is logged and skipped; the tick continues
 * with the rest.
 */
export class RunDcaTickUseCase {
	constructor(private readonly deps: RunDcaTickDependencies) {}

	async tick(): Promise<void> {
		const { registry, chain, gateway, quotes, executor, guard, strategy, logger } = this.deps

		const accounts = await registry.discover()
		logger.info({ count: accounts.length }, 'discovered_smart_accounts')

		// Read block height + cooldown window + auto-close threshold once per
		// tick — all three are shared across every account in this pass.
		const [currentBlock, cooldownBlocks, closeThresholdBps] = await Promise.all([
			chain.getBlockNumber(),
			gateway.getSwapCooldownBlocks(),
			gateway.getStreamCloseThresholdBps(),
		])

		for (const { smartAccount, user } of accounts) {
			try {
				// Guardian first: if the sender's stream is near its Superfluid
				// buffer, close it pre-emptively so the user keeps the full deposit
				// (avoids the liquidation penalty), then skip swapping this account
				// — it is shutting down. Reading the sender's realtime balance is
				// cheap and independent of the swap path.
				const health = await chain.readStreamHealth(strategy.superTokenIn, user)
				if (shouldCloseStream(health, closeThresholdBps)) {
					const txHash = await guard.closeStream(smartAccount, strategy.superTokenIn)
					logger.info(
						{
							smartAccount,
							user,
							availableBalance: health.availableBalance,
							deposit: health.deposit,
							txHash,
						},
						'stream_auto_closed',
					)
					continue
				}

				// E-05: skip accounts still cooling down before doing any
				// expensive work (state read, Uniswap quote). The on-chain
				// guard would revert these anyway.
				const lastSwapBlock = await gateway.getLastSwapBlock(smartAccount)
				if (isCooldownActive(currentBlock, lastSwapBlock, cooldownBlocks)) {
					logger.info(
						{ smartAccount, lastSwapBlock, currentBlock, cooldownBlocks },
						'swap_cooldown_active_skipping',
					)
					continue
				}

				const state = await chain.readSmartAccountState(smartAccount)

				let superBalance: bigint
				try {
					superBalance = await chain.readErc20Balance(strategy.superTokenIn, smartAccount)
				} catch {
					logger.warn({ smartAccount }, 'super_token_balance_unavailable')
					continue
				}

				const decision = decideSwap(state, superBalance, strategy)
				if (!decision) {
					logger.info({ smartAccount, owner: user }, 'no_trade_insufficient_balance_or_no_targets')
					continue
				}

				logger.info(
					{
						smartAccount,
						superAmountIn: decision.superAmountIn,
						underlyingAmountIn: decision.underlyingAmountIn,
						tokenIn: decision.tokenIn,
						tokenOut: decision.tokenOut,
					},
					'trade_decided',
				)

				const quote = await quotes.fetchQuote({
					tokenIn: decision.tokenIn,
					tokenOut: decision.tokenOut,
					amountIn: decision.underlyingAmountIn,
					swapper: smartAccount,
					slippageBps: decision.maxSlippageBps,
				})
				if (!quote) {
					logger.warn({ smartAccount }, 'quote_unavailable_skipping')
					continue
				}

				const txHash = await executor.executeSwap(decision, quote)
				logger.info({ smartAccount, txHash }, 'execute_swap_submitted')
			} catch (err) {
				// H-07: a SWAP_COOLDOWN_ACTIVE revert is an expected race
				// (another bot swapped this SA between our cooldown read and
				// our submit), not a failure — log it as a skip, not an error.
				if (isSwapCooldownRevert(err)) {
					logger.info({ smartAccount }, 'swap_cooldown_revert_skipping')
					continue
				}
				logger.error({ smartAccount, err: formatError(err) }, 'account_iteration_failed')
			}
		}
	}
	/* c8 ignore next -- class-closing brace branch inserted by V8; not reachable */
}
