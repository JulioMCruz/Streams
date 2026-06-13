import {
	bytesToHex,
	type EVMClient,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, encodeFunctionData, type Hex } from 'viem'

/**
 * CRE report-receiver interface. A DON-signed report is delivered on-chain by
 * the KeystoneForwarder, which invokes `onReport(metadata, report)` on the
 * receiver contract.
 *
 * ✅ StreamVaults implements `onReport(bytes,bytes)` (see StreamVaults.sol): it
 * is gated to `msg.sender == config.bot()`, reads the 4-byte selector off the
 * report, and dispatches to the same internal logic as the bot-only
 * `executeSwap` / `closeStreamIfLow` (every whitelist/cooldown/slippage guard
 * still applies). So the `report` we send is exactly that calldata.
 *
 * ⚠️ DEPLOYMENT GAP (to land writes on mainnet, both are broadcast steps):
 *   1. upgrade the StreamVaults proxy to the impl that has `onReport`, and
 *   2. set `config.bot()` to the KeystoneForwarder address for this DON.
 */
const RECEIVER_ABI = [
	{
		type: 'function',
		name: 'onReport',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'metadata', type: 'bytes' },
			{ name: 'report', type: 'bytes' },
		],
		outputs: [],
	},
] as const

/**
 * Submit a DON-signed report that drives one StreamVaults state change.
 *
 * Replaces the baseline's `walletClient.writeContract` (single hot key) with
 * the CRE consensus path: `runtime.report` produces the attested report and
 * `evm.writeReport` lands it via the forwarder — no single signer. `innerCallData`
 * is the abi-encoded StreamVaults call (executeSwap / closeStreamIfLow) the
 * receiver dispatches. Returns the submitted tx hash; throws on non-SUCCESS so
 * the use case logs/skips the account.
 */
export function writeStreamVaultsReport(
	runtime: Runtime<unknown>,
	evm: EVMClient,
	receiver: Address,
	innerCallData: Hex,
): Hex {
	// The report payload is a call to the receiver's onReport(metadata, report);
	// metadata is empty, report carries the StreamVaults calldata to dispatch.
	const payload = encodeFunctionData({
		abi: RECEIVER_ABI,
		functionName: 'onReport',
		args: ['0x', innerCallData],
	})

	const report = runtime.report(prepareReportRequest(payload)).result()

	const reply = evm
		.writeReport(runtime, {
			receiver,
			report,
		} as Parameters<EVMClient['writeReport']>[1])
		.result()

	if (reply.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: ${reply.errorMessage ?? `status ${reply.txStatus}`}`)
	}
	return bytesToHex(reply.txHash ?? new Uint8Array(32))
}
