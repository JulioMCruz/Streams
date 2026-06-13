/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import {
	type Address,
	getAddress,
	parseAbiItem,
	type PublicClient,
	zeroAddress,
} from 'viem'

import type { SmartAccountInfo } from '../domain/models/smart-account'
import type { SmartAccountRegistryPort } from '../ports/smart-account-registry-port'
import { streamVaultsAbi } from '../utils/abis'

const SmartAccountCreated = parseAbiItem(
	'event SmartAccountCreated(address indexed user, address indexed smartAccount)',
)

export interface ViemSmartAccountRegistryDeps {
	readonly publicClient: PublicClient
	readonly streamVaults: Address
	readonly fromBlock: bigint
}

/**
 * Driven adapter — discovers `SmartAccountDCA` clones by querying the
 * `SmartAccountCreated` events emitted by StreamVaults. Cheap on Base
 * Sepolia; swap in a subgraph-backed adapter for production scale.
 */
export class ViemSmartAccountRegistryAdapter implements SmartAccountRegistryPort {
	constructor(private readonly deps: ViemSmartAccountRegistryDeps) {}

	async discover(): Promise<SmartAccountInfo[]> {
		const logs = await this.deps.publicClient.getLogs({
			address: this.deps.streamVaults,
			event: SmartAccountCreated,
			fromBlock: this.deps.fromBlock,
		})

		const dedup = new Map<string, SmartAccountInfo>()
		for (const log of logs) {
			const { user, smartAccount } = log.args
			if (!user || !smartAccount) continue
			const sa = getAddress(smartAccount)
			dedup.set(sa, { user: getAddress(user), smartAccount: sa })
		}

		// Drop retired clones: `redeploySmartAccount()` zeroes `_userOf` for the
		// old clone, but its historical `SmartAccountCreated` log still surfaces
		// here. Operating on them reverts `SMART_ACCOUNT_NOT_FOUND` every tick, so
		// keep only the accounts the gateway still maps (`userOf(sa) != 0`).
		const candidates = Array.from(dedup.values())
		const active = await Promise.all(
			candidates.map(async (info) => {
				const user = (await this.deps.publicClient.readContract({
					address: this.deps.streamVaults,
					abi: streamVaultsAbi,
					functionName: 'userOf',
					args: [info.smartAccount],
				})) as Address
				return user && getAddress(user) !== zeroAddress ? info : null
			}),
		)
		return active.filter((info): info is SmartAccountInfo => info !== null)
	}
	/* c8 ignore next -- class-closing brace branch inserted by V8; not reachable */
}
