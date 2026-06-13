'use client'

import { useState } from 'react'

import { useWallet } from '@/lib/wallet-context'

import { TxButton } from './TxButton'

/**
 * One-click recovery for funds stranded on the PREVIOUS StreamVaults deployment
 * (an onboarding that ran before the address fix). Signs a single EIP-7702
 * `executeBatch` with the Ledger: close the stream (returns the buffer) +
 * withdraw the old SmartAccount's USDCx. Only shown in Ledger mode.
 */
// Destination for the converted USDC.
const SEND_TO = '0xd7A4467a26d26d00cB6044CE09eBD69EDAC0564C' as const

export function RecoverOldFunds() {
	const { mode, ledgerSession } = useWallet()
	const [pending, setPending] = useState<null | 'recover' | 'convert'>(null)
	const [tx, setTx] = useState<string | null>(null)
	const [err, setErr] = useState<string | null>(null)

	if (mode !== 'ledger' || !ledgerSession) return null

	const run = async (
		kind: 'recover' | 'convert',
		fn: () => Promise<string>,
	) => {
		setPending(kind)
		setErr(null)
		setTx(null)
		try {
			setTx(await fn())
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e))
		} finally {
			setPending(null)
		}
	}

	const onClick = () =>
		run('recover', async () => {
			const { recoverOldStream } = await import('@/lib/ledger-7702')
			return recoverOldStream(ledgerSession)
		})

	const onConvert = () =>
		run('convert', async () => {
			const { convertUsdcxAndSend } = await import('@/lib/ledger-7702')
			return convertUsdcxAndSend(ledgerSession, { to: SEND_TO })
		})

	return (
		<div className="rounded-xl bg-amber-950/20 p-4 text-sm ring-1 ring-amber-700/40">
			<div className="font-medium text-amber-200">Recover funds · old contract</div>
			<p className="mt-1 text-zinc-400">
				Close the stream and withdraw the USDCx stranded on the previous
				StreamVaults. Signs one EIP-7702 batch with your Ledger.
			</p>
			<div className="mt-3 flex flex-wrap gap-2">
				<TxButton tone="danger" pending={pending === 'recover'} disabled={pending !== null} onClick={onClick}>
					Recover with Ledger
				</TxButton>
				<TxButton tone="primary" pending={pending === 'convert'} disabled={pending !== null} onClick={onConvert}>
					Convert USDCx → USDC & send
				</TxButton>
			</div>
			<p className="mt-2 text-xs text-zinc-500">
				Convert sends your USDC to {SEND_TO.slice(0, 6)}…{SEND_TO.slice(-4)}
			</p>
			{tx && (
				<p className="mt-2 break-all text-emerald-400">
					✓ tx:{' '}
					<a
						className="underline"
						href={`https://basescan.org/tx/${tx}`}
						target="_blank"
						rel="noreferrer"
					>
						{tx}
					</a>
				</p>
			)}
			{err && <p className="mt-2 break-all text-rose-400">✗ {err}</p>}
		</div>
	)
}
