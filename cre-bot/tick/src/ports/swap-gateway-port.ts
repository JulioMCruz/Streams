import type { Address } from 'viem'

/**
 * Driven port — reads the StreamVaults gateway's per-account swap-rate
 * state (the E-05 cooldown). Kept separate from `ChainStatePort` because
 * it targets the gateway contract, not the smart account.
 */
export interface SwapGatewayPort {
	/** Protocol-wide cooldown window, in blocks. */
	getSwapCooldownBlocks(): Promise<bigint>

	/** Block of the last swap executed for this smart account (`0` if never). */
	getLastSwapBlock(smartAccount: Address): Promise<bigint>

	/** Auto-close threshold, in bps of the buffer (mirrors the on-chain guard). */
	getStreamCloseThresholdBps(): Promise<bigint>
}
