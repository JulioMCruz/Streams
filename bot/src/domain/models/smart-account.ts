import type { Address } from 'viem'

/**
 * Minimal identity of a deployed `SmartAccountDCA` clone, as discovered
 * from the `SmartAccountCreated` event emitted by StreamVaults.
 */
export type SmartAccountInfo = {
	user: Address
	smartAccount: Address
}

/**
 * On-chain state of a single smart account: its owner/operator plus the
 * user-defined rules that constrain what the bot is allowed to do.
 *
 * This is a pure value object — no client, no I/O. The driven
 * `ChainStatePort` adapter is responsible for reading it from chain.
 */
export type SmartAccountState = {
	smartAccount: Address
	owner: Address
	operator: Address
	maxSlippageBps: number
	minTradeAmount: bigint
	settlementAddress: Address
	targetTokens: Address[]
}
