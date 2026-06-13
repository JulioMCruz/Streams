'use client'

import { useState } from 'react'
import { type Abi, type Address, encodeFunctionData } from 'viem'
import { usePublicClient, useWriteContract } from 'wagmi'

import { useWallet } from '@/lib/wallet-context'

/** A single contract write, expressed the same way for both backends. */
export type WriteRequest = {
	address: Address
	abi: Abi
	functionName: string
	args?: readonly unknown[]
	value?: bigint
}

/**
 * Routes a contract write through whichever wallet is active:
 *  - Reown / injected → wagmi `writeContractAsync`.
 *  - Ledger (DMK) → encode the calldata and sign+broadcast a type-2 tx via
 *    `signAndSendTx` (the device signs; we broadcast). The DMK module is
 *    imported dynamically so SSR/build stay clean.
 *
 * Both paths wait for the receipt, then call `onSuccess` so the panel can
 * refetch — giving call sites one uniform `{ write, isPending, error }` API and
 * letting the connect mode decide the signing path.
 */
export function useDualWrite(onSuccess?: () => void) {
	const { mode, ledgerSession } = useWallet()
	const publicClient = usePublicClient()
	const { writeContractAsync } = useWriteContract()
	const [isPending, setIsPending] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const write = async (req: WriteRequest): Promise<boolean> => {
		setError(null)
		setIsPending(true)
		try {
			let hash: `0x${string}`
			if (mode === 'ledger' && ledgerSession) {
				const { signAndSendTx } = await import('@/lib/ledger-7702')
				const data = encodeFunctionData({
					abi: req.abi,
					functionName: req.functionName,
					args: req.args ?? []
				})
				hash = await signAndSendTx(ledgerSession, {
					to: req.address,
					data,
					value: req.value
				})
			} else {
				hash = await writeContractAsync({
					address: req.address,
					abi: req.abi,
					functionName: req.functionName,
					args: req.args,
					value: req.value
				} as Parameters<typeof writeContractAsync>[0])
			}
			if (publicClient) await publicClient.waitForTransactionReceipt({ hash })
			onSuccess?.()
			return true
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
			return false
		} finally {
			setIsPending(false)
		}
	}

	return { write, isPending, error }
}
