'use client'

import type { ReactNode } from 'react'

export function TxButton({
	children,
	onClick,
	pending,
	disabled,
	tone = 'primary'
}: {
	children: ReactNode
	onClick?: () => void
	pending?: boolean
	disabled?: boolean
	tone?: 'primary' | 'danger' | 'ghost'
}) {
	const styles = {
		primary:
			'bg-emerald-500 text-zinc-950 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500',
		danger:
			'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-zinc-800 disabled:text-zinc-500',
		ghost:
			'bg-transparent ring-1 ring-zinc-700 text-zinc-200 hover:ring-zinc-500 disabled:opacity-40'
	}[tone]

	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled || pending}
			className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors ${styles} disabled:cursor-not-allowed`}
		>
			{pending ? 'Sending…' : children}
		</button>
	)
}
