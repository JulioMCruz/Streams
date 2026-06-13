import type { ReactNode } from 'react'

export const inputCls =
	'h-10 w-full rounded-lg bg-zinc-900 px-3 font-mono text-sm text-zinc-100 ring-1 ring-zinc-800 placeholder:text-zinc-600 focus:outline-none focus:ring-emerald-500'

export function Field({
	label,
	children,
	className
}: {
	label: string
	children: ReactNode
	className?: string
}) {
	return (
		<label className={`flex flex-col gap-1 ${className ?? ''}`}>
			<span className="text-xs uppercase tracking-wide text-zinc-500">
				{label}
			</span>
			{children}
		</label>
	)
}
