'use client'

import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

import { ADDRESSES, ENS_PARENT, registryAbi } from '@/lib/contracts'
import { isZeroAddress, truncate } from '@/lib/format'
import { type Bot, useAllBots } from '@/lib/useAllBots'

import { Field, inputCls } from './Field'
import { EnsLogo } from './Logos'
import { TxButton } from './TxButton'

/**
 * Public bot explorer for the landing page: an ENS searcher to jump straight
 * to a bot's dashboard, plus a gallery of every deployed StreamBot (by ENS
 * name or contract address). Selecting any one opens its read-only dashboard —
 * no wallet required.
 */
export function BotGallery({ onSelect }: { onSelect: (sa: Address) => void }) {
	const { data: bots = [], isLoading } = useAllBots()

	return (
		<section className="mx-auto w-full max-w-6xl px-6 py-20">
			<div className="font-mono text-xs uppercase tracking-widest text-emerald-400">
				Explore live bots
			</div>
			<h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
				Every StreamBot, on-chain.
			</h2>
			<p className="mt-3 max-w-2xl text-zinc-400">
				Search a bot by its ENS name, or browse them all. Open any one to watch
				it work — its live BTC chart, trades, and exposure — without connecting.
			</p>

			<EnsSearch onSelect={onSelect} />

			<div className="mt-8">
				{isLoading ? (
					<p className="text-sm text-zinc-500">Scanning the chain for bots…</p>
				) : bots.length === 0 ? (
					<p className="text-sm text-zinc-500">
						No bots deployed yet. Connect a wallet to launch the first one.
					</p>
				) : (
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{bots.map(b => (
							<BotCard key={b.smartAccount} bot={b} onSelect={onSelect} />
						))}
					</div>
				)}
			</div>
		</section>
	)
}

function BotCard({
	bot,
	onSelect
}: {
	bot: Bot
	onSelect: (sa: Address) => void
}) {
	const named = bot.label.length > 0
	return (
		<button
			type="button"
			onClick={() => onSelect(bot.smartAccount)}
			className="group flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/50 p-5 text-left transition-colors hover:border-emerald-500/40 hover:bg-zinc-900/40"
		>
			<div className="flex items-center justify-between">
				<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
					{named ? <EnsLogo className="h-5 w-5" /> : '⚙'}
				</span>
				<span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
					DCA · BTC
				</span>
			</div>
			<div>
				<div className="truncate font-mono text-sm text-emerald-400">
					{named ? `${bot.label}.${ENS_PARENT}` : truncate(bot.smartAccount)}
				</div>
				<div className="mt-0.5 font-mono text-[11px] text-zinc-500">
					owner {truncate(bot.owner)}
				</div>
			</div>
			<span className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors group-hover:text-emerald-400">
				View dashboard
				<span className="transition-transform group-hover:translate-x-0.5">
					→
				</span>
			</span>
		</button>
	)
}

function EnsSearch({ onSelect }: { onSelect: (sa: Address) => void }) {
	const [query, setQuery] = useState('')
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

	// Jump straight to the dashboard once a search resolves to a real bot.
	useEffect(() => {
		if (found && sa) onSelect(sa)
	}, [found, sa, onSelect])

	return (
		<div className="mt-8 max-w-xl">
			<div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-400">
				<EnsLogo className="h-4 w-4" />
				Resolve an ENS name
			</div>
			<div className="flex flex-wrap items-end gap-3">
				<Field label={`Find a bot by name · <name>.${ENS_PARENT}`} className="grow">
					<input
						value={query}
						onChange={e => setQuery(e.target.value.toLowerCase())}
						onKeyDown={e => {
							if (e.key === 'Enter') setSubmitted(query)
						}}
						placeholder="alice-btc-stacker"
						className={inputCls}
					/>
				</Field>
				<TxButton onClick={() => setSubmitted(query)}>Open</TxButton>
			</div>
			{submitted && !saQuery.isLoading && !found ? (
				<p className="mt-2 text-xs text-rose-400">
					No bot registered as {submitted}.{ENS_PARENT}.
				</p>
			) : null}
		</div>
	)
}
