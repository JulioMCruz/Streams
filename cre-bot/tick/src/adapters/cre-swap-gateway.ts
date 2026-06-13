import {
	encodeCallMsg,
	type EVMClient,
	LATEST_BLOCK_NUMBER,
	type Runtime,
} from '@chainlink/cre-sdk'
import {
	type Address,
	bytesToHex,
	decodeFunctionResult,
	encodeFunctionData,
	zeroAddress,
} from 'viem'

import type { SwapGatewayPort } from '../ports/swap-gateway-port'
import type { WorkflowConfig } from '../settings/config'
import { STREAM_VAULTS_ABI } from '../utils/abis'

/**
 * CRE replacement for `viem-swap-gateway.ts`. Read-only views on the
 * StreamVaults gateway (E-05 cooldown + auto-close threshold), via
 * `evm.callContract` instead of `publicClient.readContract`. Same eth_call →
 * `Uint8Array` reply → viem decode pattern as `cre-chain-state`.
 */
export class CreSwapGateway implements SwapGatewayPort {
	constructor(
		private readonly runtime: Runtime<unknown>,
		private readonly evm: EVMClient,
		private readonly cfg: WorkflowConfig,
	) {}

	private read<TName extends string>(functionName: TName, args?: readonly unknown[]) {
		const data = encodeFunctionData({
			abi: STREAM_VAULTS_ABI,
			functionName,
			...(args ? { args } : {}),
		} as Parameters<typeof encodeFunctionData>[0])

		const reply = this.evm
			.callContract(this.runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: this.cfg.addresses.streamVaults,
					data,
				}),
				blockNumber: LATEST_BLOCK_NUMBER,
			})
			.result()

		return decodeFunctionResult({
			abi: STREAM_VAULTS_ABI,
			functionName,
			data: bytesToHex(reply.data),
		} as Parameters<typeof decodeFunctionResult>[0])
	}

	async getSwapCooldownBlocks(): Promise<bigint> {
		return this.read('swapCooldownBlocks') as bigint
	}

	async getLastSwapBlock(smartAccount: Address): Promise<bigint> {
		return this.read('lastSwapBlock', [smartAccount]) as bigint
	}

	async getStreamCloseThresholdBps(): Promise<bigint> {
		return this.read('streamCloseThresholdBps') as bigint
	}
}
