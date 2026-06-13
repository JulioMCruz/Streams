/**
 * Fase 1 PoC (full E2E) — EIP-7702 atomic setup, WITHOUT Ledger.
 *
 * Proves the WHOLE StreamVaults onboarding runs in ONE device-signable type-4 tx:
 * an EOA delegated (7702) to the audited OZ ERC-7821 batch executor runs
 *   [ CFAv1Forwarder.grantPermissions(USDCx, StreamVaults),
 *     StreamVaults.startStreamBot(USDCx, amount, rate, rules, permitSig) ]
 * atomically, with `msg.sender == the EOA` for both. grantPermissions (call 1)
 * authorizes the operator that startStreamBot's internal setFlowrateFrom (call 2)
 * relies on — so the ordering inside one tx is what makes it work.
 *
 * Signing is plain viem (a 7702 authorization is just an EOA signature over
 * (chainId, delegate, nonce) — identical artifact to Ledger's
 * `signDelegationAuthorization`). Fase 2 swaps the signer for the Ledger DMK.
 *
 * Run against an anvil fork of Base mainnet (Prague):
 *   anvil --fork-url <base-rpc> --hardfork prague --port 8546
 *   node poc-7702/run.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
	createPublicClient,
	createWalletClient,
	encodeAbiParameters,
	encodeFunctionData,
	http,
	keccak256,
	parseSignature,
	toHex
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'

const RPC = process.env.ANVIL_RPC ?? 'http://127.0.0.1:8546'
const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Base mainnet addresses (present on the fork) ────────────────────────────
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDCX = '0xD04383398dD2426297da660F9CCA3d439AF9ce1b'
const WETH = '0x4200000000000000000000000000000000000006'
const CFA_FORWARDER = '0xcfA132E353cB4E398080B9700609bb008eceB125'
const STREAM_VAULTS = '0xaC556c528A52E8E239a50AAe8cA03F0e6b2e6fcC'

const DEPLOYER_PK =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Demo parameters (mirror spec §7): 200 USDC budget, ~1 USDCx/30s, 1% slippage.
const UNDERLYING_AMOUNT = 200_000_000n // 200 USDC (6 dec)
const RATE = 33_333_333_333_333n // int96 wei/sec ≈ 1 USDCx / 30s
const MIN_TRADE = 1_000_000n // 1 USDC

const BATCH_MODE =
	'0x0100000000000000000000000000000000000000000000000000000000000000'

const ERC7821_ABI = [
	{
		type: 'function',
		name: 'execute',
		stateMutability: 'payable',
		inputs: [
			{ name: 'mode', type: 'bytes32' },
			{ name: 'executionData', type: 'bytes' }
		],
		outputs: []
	}
]
const CFA_ABI = [
	{
		type: 'function',
		name: 'grantPermissions',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'token', type: 'address' },
			{ name: 'flowOperator', type: 'address' }
		],
		outputs: [{ type: 'bool' }]
	},
	{
		type: 'function',
		name: 'getFlowrate',
		stateMutability: 'view',
		inputs: [
			{ name: 'token', type: 'address' },
			{ name: 'sender', type: 'address' },
			{ name: 'receiver', type: 'address' }
		],
		outputs: [{ name: 'flowrate', type: 'int96' }]
	}
]
const USDC_ABI = [
	{
		type: 'function',
		name: 'balanceOf',
		stateMutability: 'view',
		inputs: [{ name: 'a', type: 'address' }],
		outputs: [{ type: 'uint256' }]
	},
	{
		type: 'function',
		name: 'approve',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' }
		],
		outputs: [{ type: 'bool' }]
	},
	{
		type: 'function',
		name: 'nonces',
		stateMutability: 'view',
		inputs: [{ name: 'a', type: 'address' }],
		outputs: [{ type: 'uint256' }]
	}
]
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
					{ name: 'targetTokens', type: 'address[]' }
				]
			},
			{
				name: 'permitSig',
				type: 'tuple',
				components: [
					{ name: 'deadline', type: 'uint256' },
					{ name: 'v', type: 'uint8' },
					{ name: 'r', type: 'bytes32' },
					{ name: 's', type: 'bytes32' }
				]
			}
		],
		outputs: [{ name: 'smartAccount', type: 'address' }]
	},
	{
		type: 'function',
		name: 'smartAccountOf',
		stateMutability: 'view',
		inputs: [{ name: 'user', type: 'address' }],
		outputs: [{ type: 'address' }]
	}
]

const artifact = JSON.parse(
	readFileSync(
		join(
			__dirname,
			'../artifacts/contracts/poc/Batch7702Delegate.sol/Batch7702Delegate.json'
		),
		'utf8'
	)
)

const log = (...a) => console.log('[poc-7702]', ...a)
const transport = http(RPC)
const publicClient = createPublicClient({ chain: base, transport })

const usdcBalance = a =>
	publicClient.readContract({
		address: USDC,
		abi: USDC_ABI,
		functionName: 'balanceOf',
		args: [a]
	})

/** Deal ERC20 balance by brute-forcing the balanceOf storage slot (foundry's
 *  stdStorage trick), restoring misses to keep storage clean. */
async function dealUSDC(holder, amount) {
	const valHex = toHex(amount, { size: 32 })
	for (let i = 0; i < 40; i++) {
		const key = keccak256(
			encodeAbiParameters(
				[{ type: 'address' }, { type: 'uint256' }],
				[holder, BigInt(i)]
			)
		)
		const orig = await publicClient.getStorageAt({ address: USDC, slot: key })
		await publicClient.request({
			method: 'anvil_setStorageAt',
			params: [USDC, key, valHex]
		})
		if ((await usdcBalance(holder)) === amount) return i
		await publicClient.request({
			method: 'anvil_setStorageAt',
			params: [USDC, key, orig ?? `0x${'0'.repeat(64)}`]
		})
	}
	throw new Error('USDC balanceOf slot not found')
}

function encodeExecute(calls) {
	const executionData = encodeAbiParameters(
		[
			{
				type: 'tuple[]',
				components: [
					{ name: 'target', type: 'address' },
					{ name: 'value', type: 'uint256' },
					{ name: 'callData', type: 'bytes' }
				]
			}
		],
		[calls]
	)
	return encodeFunctionData({
		abi: ERC7821_ABI,
		functionName: 'execute',
		args: [BATCH_MODE, executionData]
	})
}

async function main() {
	log('forked chainId:', await publicClient.getChainId())

	// 1. Deploy the audited OZ ERC-7821 delegate.
	const deployer = privateKeyToAccount(DEPLOYER_PK)
	const deployerWallet = createWalletClient({
		account: deployer,
		chain: base,
		transport
	})
	const deployHash = await deployerWallet.deployContract({
		abi: artifact.abi,
		bytecode: artifact.bytecode
	})
	const { contractAddress: delegate } =
		await publicClient.waitForTransactionReceipt({ hash: deployHash })
	log('deployed Batch7702Delegate:', delegate)

	// 2. Fresh EOA "Bob": fund ETH + 200 USDC on the fork.
	const bob = privateKeyToAccount(generatePrivateKey())
	const bobWallet = createWalletClient({ account: bob, chain: base, transport })
	await publicClient.request({
		method: 'anvil_setBalance',
		params: [bob.address, '0x21e19e0c9bab2400000']
	})
	const slot = await dealUSDC(bob.address, UNDERLYING_AMOUNT)
	log(
		'bob:',
		bob.address,
		'| USDC:',
		await usdcBalance(bob.address),
		'(balance slot',
		slot + ')'
	)

	// 3. Bob signs the EIP-2612 permit over USDC (authorizes StreamVaults to pull).
	const nonce = await publicClient.readContract({
		address: USDC,
		abi: USDC_ABI,
		functionName: 'nonces',
		args: [bob.address]
	})
	const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
	const permitSignature = await bobWallet.signTypedData({
		account: bob,
		domain: {
			name: 'USD Coin',
			version: '2',
			chainId: 8453,
			verifyingContract: USDC
		},
		types: {
			Permit: [
				{ name: 'owner', type: 'address' },
				{ name: 'spender', type: 'address' },
				{ name: 'value', type: 'uint256' },
				{ name: 'nonce', type: 'uint256' },
				{ name: 'deadline', type: 'uint256' }
			]
		},
		primaryType: 'Permit',
		message: {
			owner: bob.address,
			spender: STREAM_VAULTS,
			value: UNDERLYING_AMOUNT,
			nonce,
			deadline
		}
	})
	const { r, s, v } = parseSignature(permitSignature)
	log('signed EIP-2612 permit (nonce', nonce + ')')

	// 4. Bob signs the 7702 authorization (self-executor).
	const authorization = await bobWallet.signAuthorization({
		account: bob,
		contractAddress: delegate,
		executor: 'self'
	})
	log('signed 7702 authorization → delegate', authorization.address)

	// 5. ONE type-4 tx, all msg.sender == Bob:
	//    [grantPermissions, USDC.approve, startStreamBot].
	//    NOTE: startStreamBot's internal EIP-2612 permit fails-safe under 7702
	//    (Circle USDC routes permit through ERC-1271 once the EOA has code, which
	//    the bare ERC-7821 delegate doesn't implement). Atomic batching makes the
	//    permit unnecessary — we just batch a direct `approve`, the classic
	//    approve+action that 7702 collapses into one tx.
	const data = encodeExecute([
		{
			target: CFA_FORWARDER,
			value: 0n,
			callData: encodeFunctionData({
				abi: CFA_ABI,
				functionName: 'grantPermissions',
				args: [USDCX, STREAM_VAULTS]
			})
		},
		{
			target: USDC,
			value: 0n,
			callData: encodeFunctionData({
				abi: USDC_ABI,
				functionName: 'approve',
				args: [STREAM_VAULTS, UNDERLYING_AMOUNT]
			})
		},
		{
			target: STREAM_VAULTS,
			value: 0n,
			callData: encodeFunctionData({
				abi: SV_ABI,
				functionName: 'startStreamBot',
				args: [
					USDCX,
					UNDERLYING_AMOUNT,
					RATE,
					{
						maxSlippageBps: 100,
						minTradeAmount: MIN_TRADE,
						settlementAddress: bob.address,
						targetTokens: [WETH]
					},
					{ deadline, v: Number(v), r, s }
				]
			})
		}
	])
	const txHash = await bobWallet.sendTransaction({
		to: bob.address,
		data,
		authorizationList: [authorization]
	})
	const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
	log(
		'type-4 tx:',
		txHash,
		'| status:',
		receipt.status,
		'| type:',
		receipt.type,
		'| gas:',
		receipt.gasUsed
	)

	// 6. Assertions: SmartAccount deployed + stream open from Bob into it.
	const sa = await publicClient.readContract({
		address: STREAM_VAULTS,
		abi: SV_ABI,
		functionName: 'smartAccountOf',
		args: [bob.address]
	})
	const flowrate = await publicClient.readContract({
		address: CFA_FORWARDER,
		abi: CFA_ABI,
		functionName: 'getFlowrate',
		args: [USDCX, bob.address, sa]
	})
	const code = await publicClient.getCode({ address: bob.address })
	log("bob's 7702 code:", code?.slice(0, 12) + '…')
	log('smartAccountOf(bob):', sa)
	log('stream flowrate (USDCx/sec):', flowrate, '(target', RATE + ')')

	const pass =
		receipt.status === 'success' &&
		!!sa &&
		sa !== '0x0000000000000000000000000000000000000000' &&
		flowrate === RATE
	if (pass) {
		log('✅ PASS — full StreamVaults setup (grantPermissions + startStreamBot)')
		log(
			'   ran ATOMICALLY in one 7702 tx: SmartAccount deployed and the stream'
		)
		log(
			'   is live from Bob into it. One device signature = the whole onboarding.'
		)
	} else {
		log('❌ FAIL — see values above')
		process.exit(1)
	}
}

main().catch(e => {
	console.error(e)
	process.exit(1)
})
