import type { Address, Hex } from 'viem'

/**
 * Driven port — the write side of the auto-close guardian. The use case calls
 * `closeStream` once it has decided (off-chain, via `shouldCloseStream`) that a
 * sender's stream is near the buffer. The adapter submits
 * `StreamVaults.closeStreamIfLow`, which only stops the flow — it never moves
 * the user's funds. Kept separate from the swap executor: closing a stream is a
 * distinct, benign action with its own on-chain guard.
 */
export interface StreamGuardPort {
	/** Submit `closeStreamIfLow(smartAccount, superToken)`; returns the tx hash. */
	closeStream(smartAccount: Address, superToken: Address): Promise<Hex>
}
