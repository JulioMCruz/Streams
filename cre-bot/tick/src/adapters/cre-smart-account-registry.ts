import { create, fromJson } from '@bufbuild/protobuf'
import { blockNumber, type EVMClient, type Runtime } from '@chainlink/cre-sdk'
import { EVM_PB, VALUES_PB } from '@chainlink/cre-sdk/pb'
import {
	type Address,
	bytesToHex,
	decodeEventLog,
	getAddress,
	type Hex,
	parseAbiItem,
	toBytes,
	toEventSelector,
} from 'viem'

import type { SmartAccountInfo } from '../domain/models/smart-account'
import type { SmartAccountRegistryPort } from '../ports/smart-account-registry-port'
import type { WorkflowConfig } from '../settings/config'

/**
 * CRE replacement for `viem-smart-account-registry.ts`. Discovers
 * `SmartAccountDCA` clones from the `SmartAccountCreated` events emitted by
 * StreamVaults.
 *
 * Baseline: `publicClient.getLogs({ event, fromBlock })` (viem decodes args).
 * CRE: `evm.filterLogs(runtime, { filterQuery })` — the DON fetches the logs
 * and reaches consensus. The request is built as a protobuf message (bytes as
 * `Uint8Array`, not base64-JSON); the reply's `Log` bytes come back as
 * `Uint8Array`, so we re-hex them and decode with the same viem event ABI the
 * baseline uses. Dedup by smart-account address, exactly like the baseline.
 */
const SmartAccountCreated = parseAbiItem(
	'event SmartAccountCreated(address indexed user, address indexed smartAccount)',
)
const SMART_ACCOUNT_CREATED_TOPIC = toEventSelector(SmartAccountCreated)

export class CreSmartAccountRegistry implements SmartAccountRegistryPort {
	constructor(
		private readonly runtime: Runtime<unknown>,
		private readonly evm: EVMClient,
		private readonly cfg: WorkflowConfig,
	) {}

	async discover(): Promise<SmartAccountInfo[]> {
		const request = create(EVM_PB.FilterLogsRequestSchema, {
			filterQuery: {
				// Scan from the deploy block so the DON's getLogs stays within RPC
				// range limits (mirrors the baseline's DISCOVERY_FROM_BLOCK). The
				// BigInt message is obtained by re-parsing the helper's JSON form.
				fromBlock: fromJson(VALUES_PB.BigIntSchema, blockNumber(this.cfg.discoveryFromBlock)),
				addresses: [toBytes(this.cfg.addresses.streamVaults)],
				topics: [{ topic: [toBytes(SMART_ACCOUNT_CREATED_TOPIC)] }],
			},
		})

		const reply = this.evm.filterLogs(this.runtime, request).result()

		const dedup = new Map<string, SmartAccountInfo>()
		for (const log of reply.logs) {
			// Each indexed arg is a 32-byte topic; topic[0] is the event signature.
			// Skip anything that doesn't match our 3-topic shape.
			if (log.topics.length < 3) continue
			try {
				const decoded = decodeEventLog({
					abi: [SmartAccountCreated],
					data: bytesToHex(log.data),
					topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
				})
				const { user, smartAccount } = decoded.args as {
					user: Address
					smartAccount: Address
				}
				if (!user || !smartAccount) continue
				const sa = getAddress(smartAccount)
				dedup.set(sa, { user: getAddress(user), smartAccount: sa })
			} catch {
				// Not a SmartAccountCreated log we can decode — skip it.
				continue
			}
		}
		return Array.from(dedup.values())
	}
}
