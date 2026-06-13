/**
 * Fase 1 (Ledger-aligned) — same atomic EIP-7702 setup as run.mjs, but using the
 * delegate the Ledger device actually whitelists: eth-infinitism's
 * **Simple7702Account** @ 0x4Cd241E8d1510e30b2076397afc7508Ae59C66c9 (all chains).
 *
 * Fase 2 proved the Ledger Ethereum app only signs a 7702 delegation to this
 * contract, so the production (Ledger) path must use it instead of the generic OZ
 * ERC-7821 delegate from run.mjs. Its batch entrypoint is
 * `executeBatch(Call[])` (Call{target,value,data}), gated to msg.sender ==
 * address(this) — i.e. the EOA calling itself — so the 7702 flow is identical.
 *
 * It is already deployed on Base (CREATE2, same address everywhere) — no deploy
 * step; we just point the 7702 authorization at it.
 *
 * Run against an anvil fork of Base mainnet (Prague):
 *   anvil --fork-url <base-rpc> --hardfork prague --port 8546
 *   node poc-7702/run-simple7702.mjs
 */
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

// Base mainnet addresses (present on the fork).
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDCX = '0xD04383398dD2426297da660F9CCA3d439AF9ce1b'
const WETH = '0x4200000000000000000000000000000000000006'
const CFA_FORWARDER = '0xcfA132E353cB4E398080B9700609bb008eceB125'
const STREAM_VAULTS = '0xaC556c528A52E8E239a50AAe8cA03F0e6b2e6fcC'
// The ONLY 7702 delegate the Ledger Ethereum app whitelists (Fase 2 finding L-09).
const SIMPLE_7702_ACCOUNT = '0x4Cd241E8d1510e30b2076397afc7508Ae59C66c9'

const UNDERLYING_AMOUNT = 200_000_000n // 200 USDC
const RATE = 33_333_333_333_333n // ~1 USDCx / 30s
const MIN_TRADE = 1_000_000n

// Simple7702Account batch entrypoint (eth-infinitism BaseAccount).
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
					{ name: 'data', type: 'bytes' }
				]
			}
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
			{ name: 's', type: 'address' },
			{ name: 'a', type: 'uint256' }
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
		inputs: [{ name: 'u', type: 'address' }],
		outputs: [{ type: 'address' }]
	}
]

const log = (...a) => console.log('[poc-simple7702]', ...a)
const transport = http(RPC)
const publicClient = createPublicClient({ chain: base, transport })
const usdcBalance = a =>
	publicClient.readContract({
		address: USDC,
		abi: USDC_ABI,
		functionName: 'balanceOf',
		args: [a]
	})

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

async function main() {
	log('forked chainId:', await publicClient.getChainId())

	// 0. The Ledger-whitelisted delegate must already be deployed on Base.
	const delegateCode = await publicClient.getCode({
		address: SIMPLE_7702_ACCOUNT
	})
	if (!delegateCode || delegateCode === '0x') {
		throw new Error(
			`Simple7702Account not deployed at ${SIMPLE_7702_ACCOUNT} on this fork`
		)
	}
	log(
		'Simple7702Account present on Base:',
		SIMPLE_7702_ACCOUNT,
		`(${(delegateCode.length - 2) / 2} bytes)`
	)

	// 1. Fresh EOA "Bob": fund ETH + 200 USDC.
	const bob = privateKeyToAccount(generatePrivateKey())
	const bobWallet = createWalletClient({ account: bob, chain: base, transport })
	await publicClient.request({
		method: 'anvil_setBalance',
		params: [bob.address, '0x21e19e0c9bab2400000']
	})
	await dealUSDC(bob.address, UNDERLYING_AMOUNT)
	log('bob:', bob.address, '| USDC:', await usdcBalance(bob.address))

	// 2. EIP-2612 permit (harmless under 7702; the batched approve is what works).
	const nonce = await publicClient.readContract({
		address: USDC,
		abi: USDC_ABI,
		functionName: 'nonces',
		args: [bob.address]
	})
	const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
	const permitSig = await bobWallet.signTypedData({
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
	const { r, s, v } = parseSignature(permitSig)

	// 3. 7702 authorization → Simple7702Account (executor self).
	const authorization = await bobWallet.signAuthorization({
		account: bob,
		contractAddress: SIMPLE_7702_ACCOUNT,
		executor: 'self'
	})
	log('signed 7702 authorization → Simple7702Account')

	// 4. ONE type-4 tx: Simple7702Account.executeBatch([grant, approve, startStreamBot]).
	const data = encodeFunctionData({
		abi: ACCOUNT_ABI,
		functionName: 'executeBatch',
		args: [
			[
				{
					target: CFA_FORWARDER,
					value: 0n,
					data: encodeFunctionData({
						abi: CFA_ABI,
						functionName: 'grantPermissions',
						args: [USDCX, STREAM_VAULTS]
					})
				},
				{
					target: USDC,
					value: 0n,
					data: encodeFunctionData({
						abi: USDC_ABI,
						functionName: 'approve',
						args: [STREAM_VAULTS, UNDERLYING_AMOUNT]
					})
				},
				{
					target: STREAM_VAULTS,
					value: 0n,
					data: encodeFunctionData({
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
			]
		]
	})
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

	// 5. Assertions.
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
	log(
		"bob's 7702 code:",
		code?.slice(0, 12) + '…',
		'→ delegates to',
		'0x' + (code ?? '').slice(8, 48)
	)
	log(
		'smartAccountOf(bob):',
		sa,
		'| flowrate:',
		flowrate,
		'(target',
		RATE + ')'
	)

	const pass =
		receipt.status === 'success' &&
		sa !== '0x0000000000000000000000000000000000000000' &&
		flowrate === RATE
	if (pass) {
		log(
			'✅ PASS — full atomic setup via the Ledger-whitelisted Simple7702Account.'
		)
		log(
			'   Same one-signature onboarding as run.mjs, now with the delegate the'
		)
		log(
			'   Ledger device actually signs (Fase 2). Fase 1 + Fase 2 are consistent.'
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
