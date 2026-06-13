'use client'

import type { ReactNode } from 'react'

/**
 * A single metric tile for the KPI row. `tone` tints the value so the live
 * dashboard reads at a glance: emerald for healthy/active, amber for
 * attention, plain for neutral.
 */
export function KpiCard({
	label,
	value,
	unit,
	hint,
	tone = 'default',
	icon
}: {
	label: string
	value: ReactNode
	unit?: string
	hint?: ReactNode
	tone?: 'default' | 'positive' | 'warning'
	icon?: ReactNode
}) {
	const valueColor = {
		default: 'text-zinc-100',
		positive: 'text-emerald-400',
		warning: 'text-amber-400'
	}[tone]

	return (
		<div className="rounded-xl bg-zinc-950/40 p-4 ring-1 ring-zinc-800">
			<p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
				{icon ? <span className="shrink-0">{icon}</span> : null}
				{label}
			</p>
			<p className={`mt-2 font-mono text-2xl leading-none ${valueColor}`}>
				{value}
				{unit ? (
					<span className="ml-1 text-sm text-zinc-500">{unit}</span>
				) : null}
			</p>
			{hint ? <p className="mt-1.5 text-xs text-zinc-500">{hint}</p> : null}
		</div>
	)
}
