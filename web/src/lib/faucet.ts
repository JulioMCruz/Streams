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

/// MockERC20Permit.mint is public on the local mocks — anyone can mint.
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

export const FAUCET_ETH = parseEther('100')
export const FAUCET_USDC = parseUnits('10000', 6) // USDC, 6 decimals

/**
 * Fund `address` on the local Hardhat node with ETH and USDC, with zero
 * wallet popups: ETH via the `hardhat_setBalance` admin RPC, USDC by
 * impersonating the (now gas-funded) address and minting to itself. Only
 * meaningful on the local chain — the admin RPCs don't exist on a real
 * network. Returns the resulting balances for display.
 */
export async function fundLocalWallet(
	address: Address
): Promise<{ eth: bigint; usdc: bigint }> {
	const test = createTestClient({
		mode: 'hardhat',
		chain: hardhatLocal,
		transport: http(LOCAL_RPC_URL)
	}).extend(publicActions)

	// 1. ETH — set the balance directly (no sender, no gas needed).
	await test.setBalance({ address, value: FAUCET_ETH })

	// 2. USDC — impersonate the address (now funded) and mint to itself.
	await test.impersonateAccount({ address })
	try {
		const wallet = createWalletClient({
			account: address,
			chain: hardhatLocal,
			transport: http(LOCAL_RPC_URL)
		})
		const hash = await wallet.writeContract({
			address: ADDRESSES.usdc,
			abi: mintAbi,
			functionName: 'mint',
			args: [address, FAUCET_USDC]
		})
		await test.waitForTransactionReceipt({ hash })
	} finally {
		await test.stopImpersonatingAccount({ address })
	}

	const [eth, usdc] = await Promise.all([
		test.getBalance({ address }),
		test.readContract({
			address: ADDRESSES.usdc,
			abi: [
				{
					type: 'function',
					name: 'balanceOf',
					stateMutability: 'view',
					inputs: [{ name: 'a', type: 'address' }],
					outputs: [{ name: '', type: 'uint256' }]
				}
			] as const,
			functionName: 'balanceOf',
			args: [address]
		})
	])
	return { eth, usdc }
}
