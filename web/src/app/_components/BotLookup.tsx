'use client'

import { useState } from 'react'
import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

import { ADDRESSES, ENS_PARENT, registryAbi } from '@/lib/contracts'
import { isZeroAddress, truncate } from '@/lib/format'

import { Card } from './Card'
import { Field, inputCls } from './Field'
import { TxButton } from './TxButton'

/**
 * Public discovery: resolve any user's bot label to its smart account, the
 * same indirection ENS gives across web3.
 */
export function BotLookup() {
	const [pending, setPending] = useState('')
	const [submitted, setSubmitted] = useState('')

	const saQuery = useReadContract({
		address: ADDRESSES.smartAccountRegistry,
		abi: registryAbi,
		functionName: 'smartAccountOf',
		args: [submitted],
		query: { enabled: submitted.length > 0 }
	})

	const sa = saQuery.data as Address | undefined
	const found = sa && !isZeroAddress(sa)

	return (
		<Card
			title="Discover bots"
			subtitle="Resolve any label without knowing the address."
		>
			<div className="flex flex-wrap items-end gap-3">
				<Field label="Label" className="grow">
					<input
						value={pending}
						onChange={e => setPending(e.target.value.toLowerCase())}
						placeholder="alice-eth-stacker"
						className={inputCls}
					/>
				</Field>
				<TxButton tone="ghost" onClick={() => setSubmitted(pending)}>
					Resolve
				</TxButton>
			</div>
			{submitted ? (
				<div className="mt-4 grid gap-2 text-sm">
					<div className="flex flex-wrap items-center gap-2 font-mono">
						<span className="text-zinc-500">
							{submitted}.{ENS_PARENT}
						</span>
						<span className="text-zinc-700">→</span>
						<span className={found ? 'text-emerald-400' : 'text-zinc-600'}>
							{saQuery.isLoading ? 'resolving…' : sa ? truncate(sa) : '—'}
						</span>
					</div>
					{!saQuery.isLoading && !found && sa ? (
						<p className="text-xs text-rose-400">
							No bot registered with this label.
						</p>
					) : null}
				</div>
			) : null}
		</Card>
	)
}
