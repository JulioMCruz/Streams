/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import type {
	Account,
	Address,
	Hex,
	PublicClient,
	WalletClient,
} from 'viem'

import type { QuoteResult } from '../domain/models/quote'
import type { SwapDecision, SwapParams } from '../domain/models/swap'
import type { SwapExecutorPort } from '../ports/swap-executor-port'
import { streamVaultsAbi } from '../utils/abis'

export interface ViemSwapExecutorDeps {
	readonly publicClient: PublicClient
	readonly walletClient: WalletClient
	readonly account: Account
	readonly streamVaults: Address
}

/**
 * Driven adapter — submits the routed swap via `StreamVaults.executeSwap`,
 * signed by the bot hot key. Simulates first so a revert surfaces before
 * we spend gas. The smart account performs `downgrade → swap → settle to
 * user` atomically; this adapter only forwards the target/calldata.
 */
export class ViemSwapExecutorAdapter implements SwapExecutorPort {
	constructor(private readonly deps: ViemSwapExecutorDeps) {}

	async executeSwap(
		decision: SwapDecision,
		quote: QuoteResult,
	): Promise<Hex> {
		const params: SwapParams = {
			superTokenIn: decision.superTokenIn,
			superAmountIn: decision.superAmountIn,
			tokenIn: decision.tokenIn,
			tokenOut: decision.tokenOut,
			target: quote.to,
			value: quote.value,
			data: quote.data,
			minAmountOut: quote.minAmountOut,
		}

		const { request } = await this.deps.publicClient.simulateContract({
			account: this.deps.account,
			address: this.deps.streamVaults,
			abi: streamVaultsAbi,
			functionName: 'executeSwap',
			args: [decision.smartAccount, params],
			value: params.value,
		})

		return this.deps.walletClient.writeContract(request)
	}
	/* c8 ignore next -- class-closing brace branch inserted by V8; not reachable */
}
