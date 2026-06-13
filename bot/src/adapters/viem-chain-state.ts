/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import type { Address, PublicClient } from 'viem'

import type { SmartAccountState } from '../domain/models/smart-account'
import type { StreamHealth } from '../domain/models/stream-health'
import type { ChainStatePort } from '../ports/chain-state-port'
import { erc20Abi, smartAccountAbi, superTokenAbi } from '../utils/abis'

/**
 * Driven adapter — read-only EVM state via a viem PublicClient.
 */
export class ViemChainStateAdapter implements ChainStatePort {
	constructor(private readonly publicClient: PublicClient) {}

	async getBlockNumber(): Promise<bigint> {
		return this.publicClient.getBlockNumber()
	}

	async readSmartAccountState(
		smartAccount: Address,
	): Promise<SmartAccountState> {
		const [owner, operator, rules, targetTokens] = await Promise.all([
			this.publicClient.readContract({
				address: smartAccount,
				abi: smartAccountAbi,
				functionName: 'owner',
			}) as Promise<Address>,
			this.publicClient.readContract({
				address: smartAccount,
				abi: smartAccountAbi,
				functionName: 'operator',
			}) as Promise<Address>,
			this.publicClient.readContract({
				address: smartAccount,
				abi: smartAccountAbi,
				functionName: 'rules',
			}) as Promise<readonly [number, bigint, Address]>,
			this.publicClient.readContract({
				address: smartAccount,
				abi: smartAccountAbi,
				functionName: 'targetTokens',
			}) as Promise<readonly Address[]>,
		])

		const [maxSlippageBps, minTradeAmount, settlementAddress] = rules

		return {
			smartAccount,
			owner,
			operator,
			maxSlippageBps,
			minTradeAmount,
			settlementAddress,
			targetTokens: [...targetTokens],
		}
	}

	async readErc20Balance(token: Address, holder: Address): Promise<bigint> {
		return this.publicClient.readContract({
			address: token,
			abi: erc20Abi,
			functionName: 'balanceOf',
			args: [holder],
		}) as Promise<bigint>
	}

	async readStreamHealth(
		superToken: Address,
		sender: Address,
	): Promise<StreamHealth> {
		const [availableBalance, deposit] = (await this.publicClient.readContract({
			address: superToken,
			abi: superTokenAbi,
			functionName: 'realtimeBalanceOfNow',
			args: [sender],
		})) as readonly [bigint, bigint, bigint, bigint]
		return { availableBalance, deposit }
	}
	/* c8 ignore next -- class-closing brace branch inserted by V8; not reachable */
}
