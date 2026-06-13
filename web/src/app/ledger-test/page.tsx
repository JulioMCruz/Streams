'use client'

/**
 * Fase 4 — live Ledger test page (route: /ledger-test).
 *
 * SAFE dry-run: connects a Ledger over WebHID and signs ONLY the EIP-7702
 * delegation to Simple7702Account — NO transaction, NO funds move. Verifies the
 * device path on a real Ledger Flex and shows the clear-signed approval.
 *
 * The DMK module is imported DYNAMICALLY on click so nothing browser-only runs
 * during SSR/build. Requires Chromium (WebHID) and the Ledger Ethereum app with
 * "smart account upgrade" enabled in settings.
 */
import { useState } from 'react'

type Result = {
	address: string
	nonce: number
	r: string
	s: string
	v: number
	recovered: string
	ok: boolean
}

export default function LedgerTestPage() {
	const [status, setStatus] = useState<
		'idle' | 'connecting' | 'signing' | 'ok' | 'mismatch' | 'error'
	>('idle')
	const [result, setResult] = useState<Result | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function run() {
		setStatus('connecting')
		setError(null)
		setResult(null)
		try {
			// Dynamic import → DMK/WebHID loads only in the browser, on demand.
			const { signDelegationDryRun } = await import('@/lib/ledger-7702')
			setStatus('signing')
			const r = await signDelegationDryRun()
			setResult(r)
			setStatus(r.ok ? 'ok' : 'mismatch')
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
			setStatus('error')
		}
	}

	const busy = status === 'connecting' || status === 'signing'

	return (
		<main style={{ maxWidth: 680, margin: '0 auto', padding: 32, fontFamily: 'system-ui' }}>
			<h1 style={{ fontSize: 24, fontWeight: 700 }}>Ledger 7702 — dry-run test</h1>
			<p style={{ color: '#555', marginTop: 8 }}>
				Connects your Ledger over WebHID and signs the EIP-7702 delegation to{' '}
				<code>Simple7702Account</code> on Base. <strong>No transaction is sent and no
				funds move</strong> — this only verifies device signing + clear signing.
			</p>
			<ol style={{ color: '#555', fontSize: 14, marginTop: 8, paddingLeft: 18 }}>
				<li>Use a Chromium browser (WebHID).</li>
				<li>Plug in the Ledger, open the Ethereum app.</li>
				<li>
					Enable <strong>“smart account upgrade”</strong> in the Ethereum app settings
					(off by default).
				</li>
			</ol>

			<button
				type="button"
				onClick={run}
				disabled={busy}
				style={{
					marginTop: 16,
					padding: '10px 18px',
					borderRadius: 8,
					border: '1px solid #333',
					background: busy ? '#999' : '#111',
					color: '#fff',
					cursor: busy ? 'default' : 'pointer',
				}}
			>
				{status === 'connecting'
					? 'Connecting…'
					: status === 'signing'
						? 'Approve on your Ledger…'
						: 'Connect Ledger & sign delegation'}
			</button>

			<p style={{ marginTop: 12, fontSize: 14 }}>
				Status: <strong>{status}</strong>
			</p>

			{error && (
				<pre
					style={{
						marginTop: 12,
						padding: 12,
						background: '#fff0f0',
						border: '1px solid #f3b',
						borderRadius: 8,
						whiteSpace: 'pre-wrap',
						fontSize: 13,
					}}
				>
					{error}
					{'\n\n'}If this is an opaque device error, check that “smart account upgrade”
					is enabled (the 7702 setting is off by default).
				</pre>
			)}

			{result && (
				<div
					style={{
						marginTop: 16,
						padding: 16,
						background: result.ok ? '#f0fff4' : '#fffbe6',
						border: `1px solid ${result.ok ? '#3c9' : '#e9b'}`,
						borderRadius: 8,
						fontSize: 13,
						wordBreak: 'break-all',
					}}
				>
					<p style={{ fontWeight: 700 }}>
						{result.ok
							? '✅ Valid — signature recovers to the device address'
							: '⚠️ Mismatch — recovered ≠ device address'}
					</p>
					<p>Device address: {result.address}</p>
					<p>Recovered authority: {result.recovered}</p>
					<p>Nonce: {result.nonce}</p>
					<p>
						Signature: r={result.r} s={result.s} v={result.v}
					</p>
				</div>
			)}
		</main>
	)
}
