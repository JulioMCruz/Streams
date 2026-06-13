/**
 * Fase 2 PoC — sign the EIP-7702 delegation authorization on a Ledger (emulated
 * via Speculos), using the SAME stack the Ledger bounty references (DMK +
 * device-signer-kit-ethereum) and the official Speculos transport.
 *
 * Proves the concrete Ledger primitive `signDelegationAuthorization`: the device
 * produces a valid 7702 authorization for OUR delegate, and the signature
 * recovers to the device's own address — i.e. the authorization the Fase 1 tx
 * needs, now signed in hardware instead of by a plain key.
 *
 * It ALSO empirically probes finding L-08/whitelist: if the app refuses a
 * non-Ethereum-Foundation delegate, signing fails here with that reason.
 *
 * Prereqs:
 *   - Speculos running the Ethereum app (HTTP API on :5000), e.g.
 *       docker run --rm -p 5000:5000 -v <elf-dir>:/app ghcr.io/ledgerhq/speculos \
 *         --model flex --display headless --api-port 5000 /app/app.elf --automation 'file:/app/auto.json'
 *   - DELEGATE env = the Batch7702Delegate address (any address works to verify
 *     the signature; use the real one to also exercise the device whitelist).
 *
 * Run: SPECULOS_URL=http://127.0.0.1:5000 DELEGATE=0x... node sign-with-ledger.mjs
 */
import {
	DeviceActionStatus,
	DeviceManagementKitBuilder,
	DeviceModelId,
} from '@ledgerhq/device-management-kit'
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum'
import {
	speculosIdentifier,
	speculosTransportFactory,
} from '@ledgerhq/device-transport-kit-speculos'
import { firstValueFrom } from 'rxjs'
import { recoverAuthorizationAddress } from 'viem/utils'

const SPECULOS_URL = process.env.SPECULOS_URL ?? 'http://127.0.0.1:5000'
const DELEGATE = process.env.DELEGATE ?? '0x0000000000000000000000000000000000007702'
const DERIVATION_PATH = "44'/60'/0'/0/0"
const CHAIN_ID = 8453 // Base
const NONCE = 0

const log = (...a) => console.log('[fase2-ledger]', ...a)

/** Drive a DMK DeviceAction observable to its terminal state and return output. */
function runDeviceAction(returnType, label) {
	return new Promise((resolve, reject) => {
		returnType.observable.subscribe({
			next: (state) => {
				if (state.status === DeviceActionStatus.Completed) resolve(state.output)
				else if (state.status === DeviceActionStatus.Error) reject(state.error)
				else log(`${label}: ${state.status}`)
			},
			error: reject,
		})
	})
}

async function main() {
	// isE2E=true → the Speculos transport auto-approves device prompts.
	const dmk = new DeviceManagementKitBuilder()
		.addTransport(speculosTransportFactory(SPECULOS_URL, true, DeviceModelId.FLEX))
		.build()

	log('discovering Speculos device...')
	const device = await firstValueFrom(dmk.startDiscovering({ transport: speculosIdentifier }))
	const sessionId = await dmk.connect({ device })
	log('connected, session:', sessionId)

	const signerEth = new SignerEthBuilder({ dmk, sessionId }).build()

	// 1. The EOA the device controls (this becomes "Bob").
	const addr = await runDeviceAction(signerEth.getAddress(DERIVATION_PATH), 'getAddress')
	log('device EOA:', addr.address)

	// 2. Sign the 7702 delegation authorization for OUR delegate (the novel primitive).
	log(`signing 7702 delegation → delegate ${DELEGATE} (chainId ${CHAIN_ID}, nonce ${NONCE})...`)
	const sig = await runDeviceAction(
		signerEth.signDelegationAuthorization(DERIVATION_PATH, CHAIN_ID, DELEGATE, NONCE),
		'signDelegationAuthorization',
	)
	log('device signature:', { r: sig.r, s: sig.s, v: sig.v })

	// 3. Verify: the signed authorization must recover to the device's own EOA.
	const yParity = Number(sig.v) >= 27 ? Number(sig.v) - 27 : Number(sig.v)
	const recovered = await recoverAuthorizationAddress({
		authorization: { chainId: CHAIN_ID, address: DELEGATE, nonce: NONCE, r: sig.r, s: sig.s, yParity },
	})
	log('recovered authority:', recovered)

	const pass = recovered.toLowerCase() === addr.address.toLowerCase()
	if (pass) {
		log('✅ PASS — Ledger (Speculos) signed a valid EIP-7702 authorization for our')
		log('   delegate; it recovers to the device EOA. This is the Fase 1 authorization,')
		log('   now produced in hardware via DMK signDelegationAuthorization.')
		await dmk.disconnect({ sessionId }).catch(() => {})
	} else {
		log('❌ FAIL — recovered authority != device EOA')
		process.exit(1)
	}
}

main().catch((e) => {
	console.error('[fase2-ledger] device action failed:', e?.message ?? e)
	console.error(
		'If this is a 7702 whitelist rejection, it confirms L-08: the app only allows',
		'the Ethereum Foundation delegate. Try DELEGATE=<EF allowed address>.',
	)
	process.exit(1)
})
