/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import type { Address, PublicClient } from 'viem'

import type { SwapGatewayPort } from '../ports/swap-gateway-port'
import { streamVaultsAbi } from '../utils/abis'

export interface ViemSwapGatewayDeps {
	readonly publicClient: PublicClient
	readonly streamVaults: Address
}

/**
 * Driven adapter — reads the StreamVaults gateway cooldown state via a
 * viem PublicClient (`swapCooldownBlocks()` + `lastSwapBlock(sa)`).
 */
export class ViemSwapGatewayAdapter implements SwapGatewayPort {
	constructor(private readonly deps: ViemSwapGatewayDeps) {}

	async getSwapCooldownBlocks(): Promise<bigint> {
		return this.deps.publicClient.readContract({
			address: this.deps.streamVaults,
			abi: streamVaultsAbi,
			functionName: 'swapCooldownBlocks',
		}) as Promise<bigint>
	}

	async getLastSwapBlock(smartAccount: Address): Promise<bigint> {
		return this.deps.publicClient.readContract({
			address: this.deps.streamVaults,
			abi: streamVaultsAbi,
			functionName: 'lastSwapBlock',
			args: [smartAccount],
		}) as Promise<bigint>
	}

	async getStreamCloseThresholdBps(): Promise<bigint> {
		return this.deps.publicClient.readContract({
			address: this.deps.streamVaults,
			abi: streamVaultsAbi,
			functionName: 'streamCloseThresholdBps',
		}) as Promise<bigint>
	}
	/* c8 ignore next -- class-closing brace branch inserted by V8; not reachable */
}
