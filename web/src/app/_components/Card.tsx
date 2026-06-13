import type { ReactNode } from 'react'

export function Card({
	title,
	subtitle,
	children,
	tone = 'default',
	className = ''
}: {
	title: string
	subtitle?: string
	children?: ReactNode
	tone?: 'default' | 'active' | 'success' | 'muted'
	className?: string
}) {
	const ringByTone = {
		default: 'ring-zinc-800',
		active: 'ring-emerald-500/50',
		success: 'ring-emerald-700/50 bg-emerald-950/20',
		muted: 'ring-zinc-900 bg-zinc-950/50 opacity-70'
	}[tone]

	return (
		<section
			className={`rounded-2xl ring-1 ${ringByTone} bg-zinc-950/40 p-6 backdrop-blur ${className}`}
		>
			<header className="mb-4">
				<h2 className="text-lg font-semibold text-zinc-50">{title}</h2>
				{subtitle ? (
					<p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
				) : null}
			</header>
			{children}
		</section>
	)
}
