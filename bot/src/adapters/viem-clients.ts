/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import {
	type Account,
	type Address,
	createPublicClient,
	createWalletClient,
	http,
	type PublicClient,
	type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import type { BotConfig } from '../settings/config'

/**
 * viem clients shared by every driven adapter. Built once from
 * {@link BotConfig} in `entry-point/main.ts` and injected into the
 * adapter constructors — adapters never read config or env themselves.
 */
export interface ViemClients {
	readonly account: Account
	readonly botAddress: Address
	readonly publicClient: PublicClient
	/// Separate read client for `eth_getLogs` discovery (see `BotConfig.logsRpcUrl`).
	readonly logsPublicClient: PublicClient
	readonly walletClient: WalletClient
}

/* c8 ignore next -- function-declaration branch inserted by V8; not reachable from tests */
export function createClients(config: BotConfig): ViemClients {
	const account = privateKeyToAccount(config.botPrivateKey)
	const publicClient = createPublicClient({
		chain: config.chain,
		transport: http(config.rpcUrl),
	})
	const logsPublicClient = createPublicClient({
		chain: config.chain,
		transport: http(config.logsRpcUrl),
	})
	const walletClient = createWalletClient({
		account,
		chain: config.chain,
		transport: http(config.rpcUrl),
	})
	return {
		account,
		botAddress: account.address,
		publicClient,
		logsPublicClient,
		walletClient,
	}
}
