import {
	type Address,
	createTestClient,
	createWalletClient,
	http,
	parseEther,
	parseUnits,
	publicActions
} from 'viem'

import { ADDRESSES } from './contracts'
import { hardhatLocal, LOCAL_RPC_URL } from './wagmi'

const erc20Abi = [
	{
		type: 'function',
		name: 'transfer',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'to', type: 'address' },
			{ name: 'amount', type: 'uint256' }
		],
		outputs: [{ type: 'bool' }]
	},
	{
		type: 'function',
		name: 'balanceOf',
		stateMutability: 'view',
		inputs: [{ name: 'a', type: 'address' }],
		outputs: [{ type: 'uint256' }]
	}
] as const

const mintAbi = [
	{
		type: 'function',
		name: 'mint',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'to', type: 'address' },
			{ name: 'amount', type: 'uint256' }
		],
		outputs: []
	}
] as const

// hardhat account #0 — funded, used to top up the router (mint is public).
const MINTER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

/** USDCx moved from the wallet into the smart account per tick (2 USDCx). */
export const STREAM_TICK_USDCX = parseUnits('2', 18)
/** WETH topped up to the mock router each tick so the bot's swap can pay out. */
const ROUTER_WETH_REFILL = parseUnits('0.05', 18)

/**
 * Simulate one Superfluid stream tick on the local chain. The mock CFA is a
 * stub (it never moves funds), so we emulate the flow by moving USDCx from
 * the user's wallet into their smart account — exactly what a real stream
 * does — which the bot then downgrades, swaps, and settles back to the
 * wallet as WETH. Also keeps the mock router funded with WETH. Zero wallet
 * popups (node admin RPC: impersonate + transfer/mint).
 *
 * Returns the amount actually streamed (0 when the wallet has no USDCx left —
 * the user needs to wrap more USDC → USDCx first).
 */
export async function simulateStreamTick(
	user: Address,
	smartAccount: Address
): Promise<bigint> {
	const test = createTestClient({
		mode: 'hardhat',
		chain: hardhatLocal,
		transport: http(LOCAL_RPC_URL)
	}).extend(publicActions)

	const balance = (await test.readContract({
		address: ADDRESSES.usdcx,
		abi: erc20Abi,
		functionName: 'balanceOf',
		args: [user]
	})) as bigint
	const amount = balance < STREAM_TICK_USDCX ? balance : STREAM_TICK_USDCX
	if (amount === 0n) return 0n

	// Keep the router solvent so each swap can pay out WETH.
	if (ADDRESSES.router !== '0x0000000000000000000000000000000000000000') {
		await test.setBalance({ address: MINTER, value: parseEther('100') })
		await test.impersonateAccount({ address: MINTER })
		try {
			const minter = createWalletClient({
				account: MINTER,
				chain: hardhatLocal,
				transport: http(LOCAL_RPC_URL)
			})
			const h = await minter.writeContract({
				address: ADDRESSES.weth,
				abi: mintAbi,
				functionName: 'mint',
				args: [ADDRESSES.router, ROUTER_WETH_REFILL]
			})
			await test.waitForTransactionReceipt({ hash: h })
		} finally {
			await test.stopImpersonatingAccount({ address: MINTER })
		}
	}

	// Stream: move USDCx from the wallet into the smart account.
	const ethBal = await test.getBalance({ address: user })
	if (ethBal < parseEther('1')) {
		await test.setBalance({ address: user, value: parseEther('10') })
	}
	await test.impersonateAccount({ address: user })
	try {
		const wallet = createWalletClient({
			account: user,
			chain: hardhatLocal,
			transport: http(LOCAL_RPC_URL)
		})
		const h = await wallet.writeContract({
			address: ADDRESSES.usdcx,
			abi: erc20Abi,
			functionName: 'transfer',
			args: [smartAccount, amount]
		})
		await test.waitForTransactionReceipt({ hash: h })
	} finally {
		await test.stopImpersonatingAccount({ address: user })
	}

	return amount
}
