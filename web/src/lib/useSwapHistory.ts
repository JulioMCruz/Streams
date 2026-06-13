'use client'

import { useQuery } from '@tanstack/react-query'
import { type Address, type Hex, formatUnits, parseAbiItem } from 'viem'
import { usePublicClient } from 'wagmi'

import { outputDecimals } from '@/lib/contracts'

/// The smart account emits this on every routed swap. amountIn is the
/// downgraded underlying (USDC, 6 dec); amountOut is the settled target
/// token (WETH, 18 dec). We read these logs for both the price chart and
/// the swap-history table.
const executedEvent = parseAbiItem(
	'event Executed(address indexed target, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)'
)

export type Swap = {
	txHash: Hex
	blockNumber: bigint
	/// Unix seconds — block timestamp, used as the chart's time axis.
	time: number
	tokenIn: Address
	tokenOut: Address
	amountIn: bigint
	amountOut: bigint
	/// Decimals of `tokenOut` (WBTC 8, WETH 18) — used to format `amountOut`.
	amountOutDecimals: number
	/// Realized execution price in USDC per 1 unit of the target token.
	price: number
}

const USDC_DECIMALS = 6

const priceOf = (
	amountIn: bigint,
	amountOut: bigint,
	outDecimals: number
): number => {
	if (amountOut === 0n) return 0
	const inUsdc = Number(formatUnits(amountIn, USDC_DECIMALS))
	const out = Number(formatUnits(amountOut, outDecimals))
	return out === 0 ? 0 : inUsdc / out
}

/**
 * Read the smart account's `Executed` logs and return them oldest-first with
 * a realized price and block timestamp attached. Polls every few seconds so
 * the chart and table pick up new swaps as the bot trades. Scans from genesis
 * (cheap on the local chain); if the RPC rejects the wide range it retries
 * over a bounded recent window so public testnet RPCs don't choke.
 */
export function useSwapHistory(smartAccount?: Address) {
	const publicClient = usePublicClient()

	return useQuery({
		queryKey: ['swap-history', smartAccount, publicClient?.chain?.id],
		enabled: Boolean(smartAccount && publicClient),
		refetchInterval: 5_000,
		queryFn: async (): Promise<Swap[]> => {
			if (!publicClient || !smartAccount) return []

			const getLogsFrom = (fromBlock: bigint | 'earliest') =>
				publicClient.getLogs({
					address: smartAccount,
					event: executedEvent,
					fromBlock,
					toBlock: 'latest'
				})

			let logs
			try {
				logs = await getLogsFrom('earliest')
			} catch {
				// Public RPCs often cap getLogs ranges — retry the last ~50k blocks.
				const latest = await publicClient.getBlockNumber()
				const from = latest > 50_000n ? latest - 50_000n : 0n
				logs = await getLogsFrom(from)
			}

			// Resolve block timestamps once per unique block.
			const blocks = [...new Set(logs.map(l => l.blockNumber))].filter(
				(b): b is bigint => b !== null
			)
			const timestamps = new Map<bigint, number>()
			await Promise.all(
				blocks.map(async b => {
					const block = await publicClient.getBlock({ blockNumber: b })
					timestamps.set(b, Number(block.timestamp))
				})
			)

			return logs
				.map(log => {
					const amountIn = log.args.amountIn ?? 0n
					const amountOut = log.args.amountOut ?? 0n
					const tokenOut = log.args.tokenOut as Address
					const amountOutDecimals = outputDecimals(tokenOut)
					return {
						txHash: log.transactionHash,
						blockNumber: log.blockNumber ?? 0n,
						time: timestamps.get(log.blockNumber ?? 0n) ?? 0,
						tokenIn: log.args.tokenIn as Address,
						tokenOut,
						amountIn,
						amountOut,
						amountOutDecimals,
						price: priceOf(amountIn, amountOut, amountOutDecimals)
					}
				})
				.sort((a, b) =>
					a.blockNumber === b.blockNumber
						? 0
						: a.blockNumber < b.blockNumber
							? -1
							: 1
				)
		}
	})
}
