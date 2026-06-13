'use client'

import { useState } from 'react'
import { formatEther, formatUnits } from 'viem'
import { useAccount, useChainId, useWalletClient } from 'wagmi'

import { ADDRESSES } from '@/lib/contracts'
import { fundLocalWallet } from '@/lib/faucet'
import { LOCAL_CHAIN_ID } from '@/lib/wagmi'

import { Card } from './Card'
import { TxButton } from './TxButton'

type Status = 'idle' | 'funding' | 'done' | 'error'

// Local mock USDC (MockERC20Permit): "Mock USDC" / mUSDC / 6 decimals.
const USDC_SYMBOL = 'mUSDC'
const USDC_DECIMALS = 6

/**
 * Local-only faucet. Tops up the connected wallet with ETH (for gas) and
 * USDC (to wrap + stream) straight from the Hardhat node, no wallet
 * signature required. After funding it asks the wallet to track the mock
 * USDC token (EIP-747 `wallet_watchAsset`) so the balance shows up without
 * a manual import. Renders nothing unless connected to the local chain.
 */
export function FaucetCard() {
	const { address, isConnected } = useAccount()
	const chainId = useChainId()
	const { data: walletClient } = useWalletClient()
	const [status, setStatus] = useState<Status>('idle')
	const [error, setError] = useState<string | null>(null)
	const [balances, setBalances] = useState<{ eth: bigint; usdc: bigint } | null>(
		null
	)

	if (!isConnected || !address || chainId !== LOCAL_CHAIN_ID) return null

	// Ask MetaMask to track the mock USDC so it appears in the asset list.
	// User-dismissable, so failure is non-fatal.
	const watchUsdc = async () => {
		if (!walletClient) return
		try {
			await walletClient.watchAsset({
				type: 'ERC20',
				options: {
					address: ADDRESSES.usdc,
					symbol: USDC_SYMBOL,
					decimals: USDC_DECIMALS
				}
			})
		} catch {
			// user dismissed the prompt — ignore
		}
	}

	const fund = async () => {
		setError(null)
		setStatus('funding')
		try {
			const result = await fundLocalWallet(address)
			setBalances(result)
			setStatus('done')
			await watchUsdc()
		} catch (err) {
			setStatus('error')
			setError(err instanceof Error ? err.message : String(err))
		}
	}

	return (
		<Card
			title="Local faucet"
			subtitle="You're on the local Hardhat chain. Top up your wallet with test ETH (gas) and USDC straight from the node — no signature needed."
			tone="active"
		>
			<div className="flex flex-col gap-2">
				<div className="flex flex-wrap gap-2">
					<TxButton onClick={() => void fund()} pending={status === 'funding'}>
						Fund my wallet (100 ETH + 10,000 USDC)
					</TxButton>
					<TxButton tone="ghost" onClick={() => void watchUsdc()}>
						Add mUSDC to wallet
					</TxButton>
				</div>
				{status === 'done' && balances ? (
					<p className="text-xs text-emerald-400">
						Funded ✓ — {formatEther(balances.eth)} ETH ·{' '}
						{formatUnits(balances.usdc, USDC_DECIMALS)} {USDC_SYMBOL}. Approve the
						“add token” prompt to see it in your wallet. If the balance looks
						stale, switch networks and back to refresh.
					</p>
				) : null}
				{error ? (
					<p className="text-xs text-rose-400 break-words">{error}</p>
				) : null}
			</div>
		</Card>
	)
}
