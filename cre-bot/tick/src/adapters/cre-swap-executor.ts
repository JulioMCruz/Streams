import type { EVMClient, Runtime } from '@chainlink/cre-sdk'
import { encodeFunctionData, type Hex } from 'viem'

import type { QuoteResult } from '../domain/models/quote'
import type { SwapDecision, SwapParams } from '../domain/models/swap'
import type { SwapExecutorPort } from '../ports/swap-executor-port'
import type { WorkflowConfig } from '../settings/config'
import { STREAM_VAULTS_ABI } from '../utils/abis'
import { writeStreamVaultsReport } from '../utils/write-report'

/**
 * CRE replacement for `viem-swap-executor.ts` — **THE one adapter** the CRE
 * migration swaps in. Domain, ports and the use case are
 * reused verbatim; only the signing path changes.
 *
 * Baseline: `walletClient.writeContract(StreamVaults.executeSwap)` signed by the
 * single bot hot key. CRE: the same `SwapParams` struct is assembled from the
 * quote, then submitted through the DON consensus path (see
 * {@link writeStreamVaultsReport}). The forwarder lands the tx — the single-key
 * risk is designed away.
 */
export class CreSwapExecutor implements SwapExecutorPort {
	constructor(
		private readonly runtime: Runtime<unknown>,
		private readonly evm: EVMClient,
		private readonly cfg: WorkflowConfig,
	) {}

	async executeSwap(decision: SwapDecision, quote: QuoteResult): Promise<Hex> {
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

		const innerCallData = encodeFunctionData({
			abi: STREAM_VAULTS_ABI,
			functionName: 'executeSwap',
			args: [decision.smartAccount, params],
		})

		return writeStreamVaultsReport(
			this.runtime,
			this.evm,
			this.cfg.addresses.streamVaults,
			innerCallData,
		)
	}
}
