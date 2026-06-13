'use client'

import { useQuery } from '@tanstack/react-query'
import { type Address, parseAbiItem } from 'viem'
import { usePublicClient } from 'wagmi'

import { ADDRESSES, registryAbi } from './contracts'
import { isZeroAddress } from './format'

/// Emitted by StreamVaults whenever a per-user smart account is deployed —
/// the same event the bot uses to discover accounts to operate.
const createdEvent = parseAbiItem(
	'event SmartAccountCreated(address indexed user, address indexed smartAccount)'
)

export type Bot = {
	smartAccount: Address
	owner: Address
	/// Registered ENS label (without the parent), or '' if unnamed.
	label: string
}

/**
 * Discover every StreamBot on the network by scanning `SmartAccountCreated`
 * logs, then resolve each one's ENS label from the registry. Powers the public
 * gallery on the landing page — anyone can browse live bots without connecting.
 * Scans from genesis (cheap locally); falls back to a bounded recent window if
 * a public RPC rejects the wide range.
 */
export function useAllBots() {
	const publicClient = usePublicClient()

	return useQuery({
		queryKey: ['all-bots', publicClient?.chain?.id],
		enabled: Boolean(publicClient) && !isZeroAddress(ADDRESSES.streamVaults),
		refetchInterval: 10_000,
		queryFn: async (): Promise<Bot[]> => {
			if (!publicClient) return []

			const scan = (fromBlock: bigint | 'earliest') =>
				publicClient.getLogs({
					address: ADDRESSES.streamVaults,
					event: createdEvent,
					fromBlock,
					toBlock: 'latest'
				})

			let logs
			try {
				logs = await scan('earliest')
			} catch {
				const latest = await publicClient.getBlockNumber()
				logs = await scan(latest > 50_000n ? latest - 50_000n : 0n)
			}

			// Dedupe by smart account (latest wins), preserving discovery order.
			const seen = new Map<Address, Address>()
			for (const log of logs) {
				const sa = log.args.smartAccount as Address
				const user = log.args.user as Address
				if (sa) seen.set(sa, user)
			}

			const entries = [...seen.entries()]
			const labels = await Promise.all(
				entries.map(([sa]) =>
					publicClient
						.readContract({
							address: ADDRESSES.smartAccountRegistry,
							abi: registryAbi,
							functionName: 'labelOf',
							args: [sa]
						})
						.catch(() => '')
				)
			)

			return entries.map(([smartAccount, owner], i) => ({
				smartAccount,
				owner,
				label: (labels[i] as string) ?? ''
			}))
		}
	})
}
