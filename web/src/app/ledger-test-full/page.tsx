'use client'

/**
 * Fase 4 — full onboarding test against a LOCAL Base fork (route: /ledger-test-full).
 *
 * Runs the WHOLE StreamVaults onboarding signed by a real Ledger, but broadcasts
 * to a local anvil fork of Base — so the device signs a real type-4 tx (the
 * unverified `signTransaction` path) and we see the SmartAccount deployed + the
 * stream go live, all with ZERO real funds.
 *
 * Prereqs (run in a terminal first):
 *   anvil --fork-url https://mainnet.base.org --hardfork prague --port 8546
 *   # then fund YOUR Ledger address on the fork (ETH for gas + 200 USDC):
 *   # see the helper script printed by the page / spec/ledger.
 *
 * Then: Chromium, Ledger Ethereum app with "smart account upgrade" enabled, open
 * this page, click. Two on-device approvals: the delegation + the type-4 tx.
 */
import { useState } from 'react'

const FORK_RPC = 'http://127.0.0.1:8546'
const WETH = '0x4200000000000000000000000000000000000006'
const BUDGET = 200_000_000n // 200 USDC
const RATE = 33_333_333_333_333n // ~1 USDCx / 30s
const MIN_TRADE = 1_000_000n // 1 USDC

type Result = { txHash: string; smartAccount: string; flowrate: string }

export default function LedgerTestFullPage() {
	const [status, setStatus] = useState<
		'idle' | 'connecting' | 'signing-auth' | 'signing-tx' | 'reading' | 'done' | 'error'
	>('idle')
	const [address, setAddress] = useState<string | null>(null)
	const [result, setResult] = useState<Result | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function run() {
		setStatus('connecting')
		setError(null)
		setResult(null)
		try {
			const lib = await import('@/lib/ledger-7702')
			const session = await lib.connectLedger()
			setAddress(session.address)
			setStatus('signing-auth')
			const txHash = await lib.startStreamBotWithLedger(session, {
				budget: BUDGET,
				rate: RATE,
				rpcUrl: FORK_RPC,
				rules: {
					maxSlippageBps: 100,
					minTradeAmount: MIN_TRADE,
					settlementAddress: session.address,
					targetTokens: [WETH as `0x${string}`],
				},
			})
			setStatus('reading')
			const { smartAccount, flowrate } = await lib.readOnboardingResult(
				session.address,
				FORK_RPC,
			)
			setResult({ txHash, smartAccount, flowrate: flowrate.toString() })
			setStatus('done')
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
			setStatus('error')
		}
	}

	const busy = status !== 'idle' && status !== 'done' && status !== 'error'

	return (
		<main style={{ maxWidth: 720, margin: '0 auto', padding: 32, fontFamily: 'system-ui' }}>
			<h1 style={{ fontSize: 24, fontWeight: 700 }}>Ledger 7702 — full onboarding (local fork)</h1>
			<p style={{ color: '#555', marginTop: 8 }}>
				Signs the WHOLE StreamVaults onboarding on your Ledger (delegation + the type-4
				transaction) and broadcasts to a <strong>local Base fork</strong> at{' '}
				<code>{FORK_RPC}</code>. <strong>No real funds</strong> — the SmartAccount is
				deployed and the stream opens on the fork only.
			</p>
			<ol style={{ color: '#555', fontSize: 14, marginTop: 8, paddingLeft: 18 }}>
				<li>
					Run: <code>anvil --fork-url https://mainnet.base.org --hardfork prague --port 8546</code>
				</li>
				<li>Fund your Ledger address on the fork (ETH + 200 USDC) — see spec/ledger.</li>
				<li>Chromium · Ledger Ethereum app · “smart account upgrade” enabled.</li>
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
				{busy ? 'Working… approve on your Ledger' : 'Connect Ledger & run full onboarding'}
			</button>

			<p style={{ marginTop: 12, fontSize: 14 }}>
				Status: <strong>{status}</strong>
				{address && (
					<>
						{' · '}device: <code>{address}</code>
					</>
				)}
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
				</pre>
			)}

			{result && (
				<div
					style={{
						marginTop: 16,
						padding: 16,
						background: '#f0fff4',
						border: '1px solid #3c9',
						borderRadius: 8,
						fontSize: 13,
						wordBreak: 'break-all',
					}}
				>
					<p style={{ fontWeight: 700 }}>✅ Onboarding landed on the fork</p>
					<p>Tx hash: {result.txHash}</p>
					<p>SmartAccount deployed: {result.smartAccount}</p>
					<p>
						Stream flowrate: {result.flowrate} (target {RATE.toString()})
					</p>
				</div>
			)}
		</main>
	)
}
