import type { Address } from 'viem'

import type { SmartAccountState } from '../domain/models/smart-account'
import type { StreamHealth } from '../domain/models/stream-health'

/**
 * Driven port — read-only EVM state the strategy needs. Keeps the use
 * case oblivious to viem/RPC details.
 */
export interface ChainStatePort {
	/** Latest block number — used once at startup for an operational log line. */
	getBlockNumber(): Promise<bigint>

	/** Read a smart account's owner/operator + user rules. */
	readSmartAccountState(smartAccount: Address): Promise<SmartAccountState>

	/** ERC20 `balanceOf(holder)`. Used to read the SuperToken balance. */
	readErc20Balance(token: Address, holder: Address): Promise<bigint>

	/**
	 * SuperToken `realtimeBalanceOfNow(sender)` — the stream sender's spendable
	 * balance and locked buffer, for the auto-close guardian.
	 */
	readStreamHealth(superToken: Address, sender: Address): Promise<StreamHealth>
}
