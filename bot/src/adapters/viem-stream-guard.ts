/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import type {
	Account,
	Address,
	Hex,
	PublicClient,
	WalletClient,
} from 'viem'

import type { StreamGuardPort } from '../ports/stream-guard-port'
import { streamVaultsAbi } from '../utils/abis'

export interface ViemStreamGuardDeps {
	readonly publicClient: PublicClient
	readonly walletClient: WalletClient
	readonly account: Account
	readonly streamVaults: Address
}

/**
 * Driven adapter — submits `StreamVaults.closeStreamIfLow`, signed by the bot
 * hot key, to pre-emptively close a stream near its buffer. Simulates first so
 * an on-chain guard revert (`STREAM_NOT_LOW` / `STREAM_NOT_ACTIVE`) surfaces
 * before spending gas. Closing only stops the flow — it never moves funds.
 */
export class ViemStreamGuardAdapter implements StreamGuardPort {
	constructor(private readonly deps: ViemStreamGuardDeps) {}

	async closeStream(smartAccount: Address, superToken: Address): Promise<Hex> {
		const { request } = await this.deps.publicClient.simulateContract({
			account: this.deps.account,
			address: this.deps.streamVaults,
			abi: streamVaultsAbi,
			functionName: 'closeStreamIfLow',
			args: [smartAccount, superToken],
		})
		return this.deps.walletClient.writeContract(request)
	}
	/* c8 ignore next -- class-closing brace branch inserted by V8; not reachable */
}
