import type { EVMClient, Runtime } from '@chainlink/cre-sdk'
import { type Address, encodeFunctionData, type Hex } from 'viem'

import type { StreamGuardPort } from '../ports/stream-guard-port'
import type { WorkflowConfig } from '../settings/config'
import { STREAM_VAULTS_ABI } from '../utils/abis'
import { writeStreamVaultsReport } from '../utils/write-report'

/**
 * CRE replacement for `viem-stream-guard.ts` — the write side of the
 * auto-close guardian.
 *
 * Baseline: `walletClient.writeContract(closeStreamIfLow)` signed by the bot
 * hot key. CRE: the DON reaches consensus on a report and the forwarder lands
 * it (see {@link writeStreamVaultsReport}); there is no single signer.
 * `closeStreamIfLow` only stops the flow — it never moves the user's funds.
 */
export class CreStreamGuard implements StreamGuardPort {
	constructor(
		private readonly runtime: Runtime<unknown>,
		private readonly evm: EVMClient,
		private readonly cfg: WorkflowConfig,
	) {}

	async closeStream(smartAccount: Address, superToken: Address): Promise<Hex> {
		const innerCallData = encodeFunctionData({
			abi: STREAM_VAULTS_ABI,
			functionName: 'closeStreamIfLow',
			args: [smartAccount, superToken],
		})
		return writeStreamVaultsReport(
			this.runtime,
			this.evm,
			this.cfg.addresses.streamVaults,
			innerCallData,
		)
	}
}
