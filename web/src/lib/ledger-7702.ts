/**
 * Fase 4 — Ledger "Connect & Start" flow for the browser (EIP-7702 + DMK).
 *
 * ⚠️ ISOLATED MODULE — intentionally NOT imported by the app bundle yet. It is
 * the production wiring for the StreamVaults onboarding signed by a Ledger:
 *   1. connect a Ledger over WebHID (Device Management Kit),
 *   2. sign the EIP-7702 delegation to the Ledger-whitelisted Simple7702Account
 *      (`signDelegationAuthorization` — Fase 2),
 *   3. assemble ONE type-4 tx whose `executeBatch` runs
 *      [grantPermissions, approve, startStreamBot] atomically (Fase 1b),
 *   4. have the Ledger sign that tx (`signTransaction`) and broadcast it.
 *
 * The whole onboarding is two on-device approvals (the delegation + the tx),
 * each clear-signed via the ERC-7730 descriptor (Fase 3). The signing logic is
 * the exact flow verified in `contracts/poc-7702-ledger` (Speculos) and
 * `contracts/poc-7702/run-simple7702.mjs` (anvil Base fork); here it
 * runs against a real device in Chromium (WebHID).
 *
 * Status: TYPECHECK-verified only. A live run needs Chromium + WebHID + a Ledger
 * with the Ethereum app and "smart account upgrade" enabled in settings (Fase 2
 * finding L-10). See the wiring guide at the bottom.
 *
 * Requires (already added to web): @ledgerhq/device-management-kit,
 * @ledgerhq/device-signer-kit-ethereum, @ledgerhq/device-transport-kit-web-hid,
 * rxjs, viem.
 */
import {
	DeviceActionStatus,
	DeviceManagementKitBuilder,
} from '@ledgerhq/device-management-kit'
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum'
import {
	webHidIdentifier,
	webHidTransportFactory,
} from '@ledgerhq/device-transport-kit-web-hid'
import { firstValueFrom } from 'rxjs'
import {
	type Address,
	type Hex,
	createPublicClient,
	encodeFunctionData,
	hexToBytes,
	http,
	serializeTransaction,
} from 'viem'
import { base } from 'viem/chains'
import { recoverAuthorizationAddress } from 'viem/utils'

// ── Constants (wire to NEXT_PUBLIC_* / lib/contracts.ts when integrating) ──────
const CHAIN_ID = 8453 // Base mainnet
const DERIVATION_PATH = "44'/60'/0'/0/0"
// The ONLY 7702 delegate the Ledger Ethereum app whitelists (Fase 2 finding L-09).
const SIMPLE_7702_ACCOUNT: Address = '0x4Cd241E8d1510e30b2076397afc7508Ae59C66c9'

const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDCX: Address = '0xD04383398dD2426297da660F9CCA3d439AF9ce1b'
const STREAM_VAULTS: Address = '0xaC556c528A52E8E239a50AAe8cA03F0e6b2e6fcC'
const RPC_URL = 'https://mainnet.base.org'

const ACCOUNT_ABI = [
	{
		type: 'function',
		name: 'executeBatch',
		stateMutability: 'payable',
		inputs: [
			{
				name: 'calls',
				type: 'tuple[]',
				components: [
					{ name: 'target', type: 'address' },
					{ name: 'value', type: 'uint256' },
					{ name: 'data', type: 'bytes' },
				],
			},
		],
		outputs: [],
	},
] as const
const CFA_ABI = [
	{
		type: 'function',
		name: 'grantPermissions',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'token', type: 'address' },
			{ name: 'flowOperator', type: 'address' },
		],
		outputs: [{ type: 'bool' }],
	},
] as const
const USDC_ABI = [
	{
		type: 'function',
		name: 'approve',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		outputs: [{ type: 'bool' }],
	},
] as const
const SV_ABI = [
	{
		type: 'function',
		name: 'startStreamBot',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'superToken', type: 'address' },
			{ name: 'underlyingAmount', type: 'uint256' },
			{ name: 'rate', type: 'int96' },
			{
				name: 'rules',
				type: 'tuple',
				components: [
					{ name: 'maxSlippageBps', type: 'uint16' },
					{ name: 'minTradeAmount', type: 'uint256' },
					{ name: 'settlementAddress', type: 'address' },
					{ name: 'targetTokens', type: 'address[]' },
				],
			},
			{
				name: 'permitSig',
				type: 'tuple',
				components: [
					{ name: 'deadline', type: 'uint256' },
					{ name: 'v', type: 'uint8' },
					{ name: 'r', type: 'bytes32' },
					{ name: 's', type: 'bytes32' },
				],
			},
		],
		outputs: [{ name: 'smartAccount', type: 'address' }],
	},
] as const

const CFA_FORWARDER: Address = '0xcfA132E353cB4E398080B9700609bb008eceB125'
const ZERO_BYTES32: Hex = `0x${'0'.repeat(64)}`

export type StreamBotRules = {
	maxSlippageBps: number
	minTradeAmount: bigint
	settlementAddress: Address
	targetTokens: Address[]
}

export type LedgerSession = {
	signerEth: ReturnType<SignerEthBuilder['build']>
	address: Address
}

/** Build a read/broadcast client. `rpcUrl` lets a test point at a local Base
 *  fork (e.g. http://127.0.0.1:8546) instead of mainnet. */
const mkClient = (rpcUrl?: string) =>
	createPublicClient({ chain: base, transport: http(rpcUrl ?? RPC_URL) })

/** Drive a DMK device-action observable to its terminal output (or throw). */
async function runDeviceAction<T>(returnType: {
	observable: import('rxjs').Observable<{ status: DeviceActionStatus; output?: T; error?: unknown }>
}): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		returnType.observable.subscribe({
			next: (state) => {
				if (state.status === DeviceActionStatus.Completed) resolve(state.output as T)
				else if (state.status === DeviceActionStatus.Error) reject(state.error)
			},
			error: reject,
		})
	})
}

/** Connect a Ledger over WebHID and return its Ethereum signer + address. */
export async function connectLedger(): Promise<LedgerSession> {
	const dmk = new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build()
	const device = await firstValueFrom(dmk.startDiscovering({ transport: webHidIdentifier }))
	const sessionId = await dmk.connect({ device })
	const signerEth = new SignerEthBuilder({ dmk, sessionId }).build()
	const { address } = await runDeviceAction<{ address: Address }>(signerEth.getAddress(DERIVATION_PATH))
	return { signerEth, address }
}

/**
 * SAFE dry-run: connect the Ledger and sign ONLY the EIP-7702 delegation to
 * Simple7702Account — no transaction is broadcast and no funds move. Verifies the
 * whole device path (WebHID → DMK → signDelegationAuthorization → clear signing)
 * and that the signature recovers to the device's own address. Ideal first test
 * on a real Ledger Flex. Requires "smart account upgrade" enabled in app settings.
 */
export async function signDelegationDryRun(rpcUrl?: string): Promise<{
	address: Address
	nonce: number
	r: Hex
	s: Hex
	v: number
	recovered: Address
	ok: boolean
}> {
	const publicClient = mkClient(rpcUrl)
	const { signerEth, address } = await connectLedger()
	const nonce = await publicClient.getTransactionCount({ address })
	const sig = await runDeviceAction<{ r: Hex; s: Hex; v: number }>(
		signerEth.signDelegationAuthorization(DERIVATION_PATH, CHAIN_ID, SIMPLE_7702_ACCOUNT, nonce),
	)
	const yParity = sig.v >= 27 ? sig.v - 27 : sig.v
	const recovered = await recoverAuthorizationAddress({
		authorization: {
			chainId: CHAIN_ID,
			address: SIMPLE_7702_ACCOUNT,
			nonce,
			r: sig.r,
			s: sig.s,
			yParity,
		},
	})
	return {
		address,
		nonce,
		r: sig.r,
		s: sig.s,
		v: sig.v,
		recovered,
		ok: recovered.toLowerCase() === address.toLowerCase(),
	}
}

/**
 * Sign + broadcast the one-tx StreamVaults onboarding with a connected Ledger.
 * `budget` is the USDC amount (6 dec) to stream; `rate` is the int96 USDCx/sec.
 * Returns the submitted transaction hash.
 */
export async function startStreamBotWithLedger(
	session: LedgerSession,
	args: { budget: bigint; rate: bigint; rules: StreamBotRules; rpcUrl?: string },
): Promise<Hex> {
	const { signerEth, address } = session
	const { budget, rate, rules } = args
	const publicClient = mkClient(args.rpcUrl)

	// Self-executed type-4 tx: the outer tx consumes `txNonce`, so the 7702
	// authorization must carry `txNonce + 1` (the well-known self-sponsor rule).
	const txNonce = await publicClient.getTransactionCount({ address })
	const authNonce = txNonce + 1

	// 1. Ledger signs the EIP-7702 delegation → Simple7702Account.
	const authSig = await runDeviceAction<{ r: Hex; s: Hex; v: number }>(
		signerEth.signDelegationAuthorization(DERIVATION_PATH, CHAIN_ID, SIMPLE_7702_ACCOUNT, authNonce),
	)
	const authorization = {
		chainId: CHAIN_ID,
		address: SIMPLE_7702_ACCOUNT,
		nonce: authNonce,
		r: authSig.r,
		s: authSig.s,
		yParity: authSig.v >= 27 ? authSig.v - 27 : authSig.v,
	} as const

	// 2. executeBatch([grantPermissions, approve, startStreamBot]) — all run with
	//    msg.sender == the EOA. permitSig is zeroed: under 7702 the contract's
	//    internal EIP-2612 permit fails-safe (ERC-1271 routing, L-08), and the
	//    batched approve provides the allowance instead.
	const data = encodeFunctionData({
		abi: ACCOUNT_ABI,
		functionName: 'executeBatch',
		args: [
			[
				{ target: CFA_FORWARDER, value: 0n, data: encodeFunctionData({ abi: CFA_ABI, functionName: 'grantPermissions', args: [USDCX, STREAM_VAULTS] }) },
				{ target: USDC, value: 0n, data: encodeFunctionData({ abi: USDC_ABI, functionName: 'approve', args: [STREAM_VAULTS, budget] }) },
				{
					target: STREAM_VAULTS,
					value: 0n,
					data: encodeFunctionData({
						abi: SV_ABI,
						functionName: 'startStreamBot',
						args: [USDCX, budget, rate, rules, { deadline: 0n, v: 0, r: ZERO_BYTES32, s: ZERO_BYTES32 }],
					}),
				},
			],
		],
	})

	// 3. Assemble the type-4 tx (to self), let the Ledger sign it, broadcast.
	const fees = await publicClient.estimateFeesPerGas()
	const txParams = {
		type: 'eip7702',
		chainId: CHAIN_ID,
		nonce: txNonce,
		to: address,
		value: 0n,
		data,
		authorizationList: [authorization],
		// PoC measured ~1.03M gas; a fixed ceiling avoids 7702 estimateGas quirks.
		gas: 1_500_000n,
		maxFeePerGas: fees.maxFeePerGas,
		maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
	} as const

	const unsigned = serializeTransaction(txParams)
	const txSig = await runDeviceAction<{ r: Hex; s: Hex; v: number }>(
		signerEth.signTransaction(DERIVATION_PATH, hexToBytes(unsigned)),
	)
	const signed = serializeTransaction(txParams, {
		r: txSig.r,
		s: txSig.s,
		yParity: txSig.v >= 27 ? txSig.v - 27 : txSig.v,
	})
	return publicClient.sendRawTransaction({ serializedTransaction: signed })
}

/** Read the onboarding result (deployed SmartAccount + live stream rate) for an
 *  address — used by the fork test to confirm the tx landed. */
export async function readOnboardingResult(
	address: Address,
	rpcUrl?: string,
): Promise<{ smartAccount: Address; flowrate: bigint }> {
	const publicClient = mkClient(rpcUrl)
	const smartAccount = (await publicClient.readContract({
		address: STREAM_VAULTS,
		abi: [
			{
				type: 'function',
				name: 'smartAccountOf',
				stateMutability: 'view',
				inputs: [{ name: 'u', type: 'address' }],
				outputs: [{ type: 'address' }],
			},
		] as const,
		functionName: 'smartAccountOf',
		args: [address],
	})) as Address
	const flowrate = (await publicClient.readContract({
		address: CFA_FORWARDER,
		abi: [
			{
				type: 'function',
				name: 'getFlowrate',
				stateMutability: 'view',
				inputs: [
					{ name: 'token', type: 'address' },
					{ name: 'sender', type: 'address' },
					{ name: 'receiver', type: 'address' },
				],
				outputs: [{ name: 'flowrate', type: 'int96' }],
			},
		] as const,
		functionName: 'getFlowrate',
		args: [USDCX, address, smartAccount],
	})) as bigint
	return { smartAccount, flowrate }
}

/*
 * ─── WIRING GUIDE (to surface this in the UI) ──────────────────────────────────
 *
 * 1. Add a "Connect Ledger" button next to the existing Reown/EIP-5792 path in
 *    `app/page.tsx`'s Start-StreamBot section (progressive enhancement: Ledger →
 *    true atomic 7702; everything else → the current 5792 fallback).
 *
 * 2. Use the hook in `lib/use-ledger-stream-bot.ts`:
 *      const { connect, start, address, status, txHash, error } = useLedgerStreamBot()
 *    - `connect()` → connectLedger() (prompts the WebHID device picker).
 *    - `start({ budget, rate, rules })` → startStreamBotWithLedger(...).
 *
 * 3. Requirements to run live: Chromium (WebHID), a Ledger with the Ethereum app
 *    and "smart account upgrade" enabled in app settings (L-10). Move the addresses
 *    above to NEXT_PUBLIC_* / lib/contracts.ts. Confirm the Ethereum app signs a
 *    type-4 (EIP-7702) transaction via signTransaction; if not, send via a sponsor
 *    that submits the tx while the Ledger only signs the authorization.
 */
