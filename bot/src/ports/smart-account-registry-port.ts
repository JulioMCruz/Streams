import type { SmartAccountInfo } from '../domain/models/smart-account'

/**
 * Driven port — enumerates the smart accounts the bot should operate on.
 *
 * The baseline adapter scans `SmartAccountCreated` logs; a production
 * deployment can swap in a subgraph-backed adapter without touching the
 * use case.
 */
export interface SmartAccountRegistryPort {
	discover(): Promise<SmartAccountInfo[]>
}
