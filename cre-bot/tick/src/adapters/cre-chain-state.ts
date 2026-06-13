import {
	encodeCallMsg,
	type EVMClient,
	LATEST_BLOCK_NUMBER,
	protoBigIntToBigint,
	type Runtime,
} from '@chainlink/cre-sdk'
import {
	type Address,
	bytesToHex,
	decodeFunctionResult,
	encodeFunctionData,
	getAddress,
	zeroAddress,
} from 'viem'

import type { SmartAccountState } from '../domain/models/smart-account'
import type { StreamHealth } from '../domain/models/stream-health'
import type { ChainStatePort } from '../ports/chain-state-port'
import type { WorkflowConfig } from '../settings/config'
import { ERC20_ABI, SMART_ACCOUNT_DCA_ABI, SUPER_TOKEN_ABI } from '../utils/abis'
import { multicallRead } from '../utils/multicall'

/**
 * CRE replacement for `viem-chain-state.ts` — read-only EVM state.
 *
 * Baseline: `publicClient.readContract(...)` per call.
 * CRE: `evm.callContract(runtime, { call: encodeCallMsg({...}), blockNumber })`
 * — the DON performs the eth_call at the latest block and aggregates. Calldata
 * is encoded with viem against the inlined ABIs; the reply's `data` comes back
 * as `Uint8Array`, so it is re-hexed and decoded with viem, exactly mirroring
 * the baseline's typed reads.
 */
export class CreChainState implements ChainStatePort {
	constructor(
		private readonly runtime: Runtime<unknown>,
		private readonly evm: EVMClient,
		// Addresses arrive as method args; kept for a uniform adapter signature.
		private readonly _cfg: WorkflowConfig,
	) {}

	/** One eth_call at the latest block; returns the decoded function result. */
	private read<const TAbi extends readonly unknown[], TName extends string>(
		address: Address,
		abi: TAbi,
		functionName: TName,
		args?: readonly unknown[],
	) {
		const data = encodeFunctionData({
			abi,
			functionName,
			...(args ? { args } : {}),
		} as Parameters<typeof encodeFunctionData>[0])

		const reply = this.evm
			.callContract(this.runtime, {
				call: encodeCallMsg({ from: zeroAddress, to: address, data }),
				blockNumber: LATEST_BLOCK_NUMBER,
			})
			.result()

		return decodeFunctionResult({
			abi,
			functionName,
			data: bytesToHex(reply.data),
		} as Parameters<typeof decodeFunctionResult>[0])
	}

	async getBlockNumber(): Promise<bigint> {
		const reply = this.evm.headerByNumber(this.runtime, { blockNumber: LATEST_BLOCK_NUMBER }).result()
		// header.blockNumber is a proto BigInt; absent only on a malformed reply.
		return reply.header?.blockNumber ? protoBigIntToBigint(reply.header.blockNumber) : 0n
	}

	async readSmartAccountState(smartAccount: Address): Promise<SmartAccountState> {
		// All four reads target the same clone and are always needed together —
		// batch them into ONE callContract via Multicall3 to stay under CRE's
		// per-workflow CallContract limit (a per-field eth_call doesn't scale).
		const [owner, operator, rules, targetTokens] = multicallRead(this.runtime, this.evm, [
			{ target: smartAccount, abi: SMART_ACCOUNT_DCA_ABI, functionName: 'owner' },
			{ target: smartAccount, abi: SMART_ACCOUNT_DCA_ABI, functionName: 'operator' },
			{ target: smartAccount, abi: SMART_ACCOUNT_DCA_ABI, functionName: 'rules' },
			{
				target: smartAccount,
				abi: SMART_ACCOUNT_DCA_ABI,
				functionName: 'targetTokens',
			},
		]) as [Address, Address, readonly [number, bigint, Address], readonly Address[]]

		const [maxSlippageBps, minTradeAmount, settlementAddress] = rules

		return {
			smartAccount,
			owner: getAddress(owner),
			operator: getAddress(operator),
			maxSlippageBps,
			minTradeAmount,
			settlementAddress: getAddress(settlementAddress),
			targetTokens: targetTokens.map((t) => getAddress(t)),
		}
	}

	async readErc20Balance(token: Address, holder: Address): Promise<bigint> {
		return this.read(token, ERC20_ABI, 'balanceOf', [holder]) as bigint
	}

	async readStreamHealth(superToken: Address, sender: Address): Promise<StreamHealth> {
		const [availableBalance, deposit] = this.read(
			superToken,
			SUPER_TOKEN_ABI,
			'realtimeBalanceOfNow',
			[sender],
		) as readonly [bigint, bigint, bigint, bigint]
		return { availableBalance, deposit }
	}
}
