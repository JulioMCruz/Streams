import {
	bytesToHex,
	type EVMClient,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, type Hex } from 'viem'

/**
 * CRE report-receiver interface. A DON-signed report is delivered on-chain by
 * the KeystoneForwarder, which invokes `onReport(metadata, report)` on the
 * receiver contract — the forwarder builds that call itself (metadata is the
 * DON-populated workflow context; `report` is exactly the bytes we attest).
 *
 * ✅ StreamVaults implements `onReport(bytes,bytes)` (see StreamVaults.sol): it
 * is gated to `msg.sender == config.bot()`, reads the 4-byte selector off the
 * report, and dispatches to the same internal logic as the bot-only
 * `executeSwap` / `closeStreamIfLow` (every whitelist/cooldown/slippage guard
 * still applies). So the `report` we attest is exactly that StreamVaults
 * calldata — NOT wrapped in another `onReport(...)` envelope. Wrapping it
 * double-encodes the payload: `onReport` then reads the `onReport` selector
 * (`0x805f2132`) off `report[:4]` instead of `executeSwap`'s and reverts
 * `INVALID_REPORT`.
 *
 * ⚠️ DEPLOYMENT GAP (to land writes on mainnet, both are broadcast steps):
 *   1. upgrade the StreamVaults proxy to the impl that has `onReport`, and
 *   2. set `config.bot()` to the KeystoneForwarder address for this DON.
 */

/**
 * Submit a DON-signed report that drives one StreamVaults state change.
 *
 * Replaces the baseline's `walletClient.writeContract` (single hot key) with
 * the CRE consensus path: `runtime.report` produces the attested report and
 * `evm.writeReport` lands it via the forwarder — no single signer. `innerCallData`
 * is the abi-encoded StreamVaults call (executeSwap / closeStreamIfLow) the
 * receiver dispatches; it IS the report (the forwarder supplies the onReport
 * envelope). Returns the submitted tx hash; throws on non-SUCCESS so the use
 * case logs/skips the account.
 */
export function writeStreamVaultsReport(
	runtime: Runtime<unknown>,
	evm: EVMClient,
	receiver: Address,
	innerCallData: Hex,
): Hex {
	// Attest the StreamVaults calldata directly; the forwarder delivers it as the
	// `report` arg of onReport(metadata, report). Do NOT wrap it in onReport().
	const report = runtime.report(prepareReportRequest(innerCallData)).result()

	const reply = evm
		.writeReport(runtime, {
			receiver,
			report,
			// executeSwap drives a Uniswap (v4) swap + downgrade + settle; the
			// broadcast's auto gas estimate (~720k) is too low → the swap OOGs and
			// SmartAccountDCA reverts SWAP_CALL_FAILED. Pin a generous ceiling under
			// the DON's ChainWrite cap (5M).
			gasConfig: { gasLimit: '3000000' },
		} as Parameters<EVMClient['writeReport']>[1])
		.result()

	if (reply.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: ${reply.errorMessage ?? `status ${reply.txStatus}`}`)
	}
	return bytesToHex(reply.txHash ?? new Uint8Array(32))
}
