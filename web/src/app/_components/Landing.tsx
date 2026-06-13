'use client'

import { useAppKit } from '@reown/appkit/react'
import type { CSSProperties, ReactNode } from 'react'

import { useWallet } from '@/lib/wallet-context'

import {
	BtcLogo,
	ChainlinkLogo,
	LedgerLogo,
	UniswapLogo,
	UsdcLogo
} from './Logos'

// Stagger helper: returns an inline animation-delay for `.sv-reveal`.
const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` })

/**
 * Marketing landing shown when no wallet is connected. The whole page is one
 * idea executed precisely: capital *flowing* over time, and the bounded
 * exposure that flow buys you. Dark trading-terminal aesthetic — zinc canvas,
 * emerald signal, mono data labels — to match the dashboard it gates.
 *
 * Trust layer: the bot is set up and funded in ONE device-signed EIP-7702
 * transaction on your Ledger, clear-signed via ERC-7730 — see {@link LedgerSection}.
 */
/** A button-shaped piece of state — same shape for both connect paths. The
 *  mutex (one wallet active at a time) is enforced at the lib level
 *  (`wallet-context.connectLedger` throws when wagmi is already connected);
 *  here we mirror that policy in the UI so the "other" CTA is visibly
 *  disabled with a label that tells the user *why*. */
type CtaState = {
	label: string
	onClick: () => void
	disabled: boolean
}

export function Landing({
	isConnected,
	onEnter
}: {
	isConnected: boolean
	onEnter: () => void
}) {
	const { open } = useAppKit()
	const { mode, connectLedger, ledgerConnecting, ledgerSession } = useWallet()

	// `isConnected` from the context is unified (true if either side has a
	// session). Split it into the two sides so each CTA reflects its OWN state.
	const reownActive = isConnected && mode === 'reown'
	const ledgerActive = mode === 'ledger' && !!ledgerSession

	const reown: CtaState = {
		label: reownActive
			? 'Open dashboard'
			: ledgerActive
				? 'Ledger connected'
				: 'Connect wallet',
		onClick: reownActive ? onEnter : () => open(),
		disabled: ledgerActive,
	}

	const ledger: CtaState = {
		label: ledgerConnecting
			? 'Connecting…'
			: ledgerActive
				? 'Open dashboard'
				: reownActive
					? 'Wallet connected'
					: 'Connect Ledger',
		onClick: ledgerActive ? onEnter : () => connectLedger().catch(() => {}),
		disabled: ledgerConnecting || reownActive,
	}

	return (
		<div className="relative isolate overflow-hidden">
			{/* Atmosphere: trading grid + a breathing emerald glow. */}
			<div className="pointer-events-none absolute inset-0 -z-10">
				<div className="sv-grid absolute inset-0" />
				<div className="sv-glow absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full bg-emerald-500/20 blur-[120px]" />
				<div className="absolute -bottom-40 left-[-10%] h-[420px] w-[420px] rounded-full bg-emerald-500/5 blur-[120px]" />
			</div>

			<Hero reown={reown} ledger={ledger} />
			<ExposureCompare />
			<HowItWorks />
			<LedgerSection ledger={ledger} />
			<Security />
			<BottomCta reown={reown} />
			<footer className="border-t border-zinc-900 px-6 py-8 text-center text-xs text-zinc-600">
				StreamVaults · capital streaming as a security layer for DeFi · DCA into
				BTC on Base · Ledger is the trust layer
			</footer>
		</div>
	)
}

function Hero({ reown, ledger }: { reown: CtaState; ledger: CtaState }) {
	return (
		<section className="mx-auto grid min-h-[calc(100dvh-3.5rem)] w-full max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr]">
			<div className="flex flex-col gap-7">
				<p
					className="sv-reveal font-mono text-xs uppercase tracking-[0.25em] text-emerald-400"
					style={delay(0)}
				>
					Capital streaming · security layer for DeFi
				</p>

				<h1
					className="sv-reveal text-balance text-5xl font-semibold leading-[1.04] tracking-tight text-zinc-50 sm:text-6xl"
					style={delay(80)}
				>
					Pay your bot
					<br />
					<span className="text-emerald-400">while you use it.</span>
				</h1>

				<p
					className="sv-reveal max-w-xl text-pretty text-base leading-relaxed text-zinc-400"
					style={delay(160)}
				>
					Don&apos;t lock 10,000 USDC in a vault and pray. Stream it at a rate
					you set to an autonomous bot that dollar-cost-averages into BTC. The
					protocol only ever holds what has{' '}
					<span className="text-zinc-200">already flowed in</span> — your
					exposure is hours of flow, not a full TVL.
				</p>

				<div
					className="sv-reveal flex flex-wrap items-center gap-3"
					style={delay(240)}
				>
					<button
						type="button"
						onClick={reown.onClick}
						disabled={reown.disabled}
						title={
							reown.disabled
								? 'Disconnect the Ledger to use another wallet'
								: undefined
						}
						className="group inline-flex h-12 items-center gap-2 rounded-xl bg-emerald-500 px-6 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/25 transition-all hover:bg-emerald-400 hover:shadow-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-emerald-500 disabled:hover:shadow-emerald-500/25"
					>
						{reown.label}
						<span className="transition-transform group-hover:translate-x-0.5">
							→
						</span>
					</button>
					<button
						type="button"
						onClick={ledger.onClick}
						disabled={ledger.disabled}
						title={
							ledger.disabled && !ledger.label.startsWith('Connecting')
								? 'Disconnect the other wallet to use a Ledger'
								: undefined
						}
						className="inline-flex h-12 items-center gap-2 rounded-xl border border-amber-500/40 bg-zinc-900 px-5 text-sm font-medium text-amber-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-900"
					>
						<LedgerLogo className="h-4 w-4" />
						{ledger.label}
					</button>
				</div>

				<div
					className="sv-reveal flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-zinc-500"
					style={delay(320)}
				>
					<span>Non-custodial</span>
					<span className="text-zinc-700">·</span>
					<span>Close the stream any block</span>
					<span className="text-zinc-700">·</span>
					<span>4 kill switches</span>
				</div>

				{/* The stack, made legible at a glance. */}
				<div
					className="sv-reveal flex flex-wrap items-center gap-4 border-t border-zinc-900 pt-5"
					style={delay(400)}
				>
					<span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
						Built with
					</span>
					<TechBadge icon={<UniswapLogo className="h-4 w-4" />} label="Uniswap" />
					<TechBadge
						icon={<ChainlinkLogo className="h-4 w-4" />}
						label="Chainlink"
					/>
					<TechBadge icon={<LedgerLogo className="h-4 w-4" />} label="Ledger" />
				</div>
			</div>

			<div className="sv-reveal" style={delay(280)}>
				<FlowVisual />
			</div>
		</section>
	)
}

/**
 * The signature element: a node diagram (You → Bot → BTC) with dots streaming
 * along the wire, and a live-feeling "exposure" readout that contrasts what's
 * at rest in your wallet vs what's actually in-flight.
 */
function FlowVisual() {
	return (
		<div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 backdrop-blur">
			<div className="mb-6 flex items-center justify-between font-mono text-[11px] uppercase tracking-widest text-zinc-500">
				<span>Live stream</span>
				<span className="flex items-center gap-1.5 text-emerald-400">
					<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
					flowing
				</span>
			</div>

			{/* Node row with the animated wire. */}
			<div className="flex items-center justify-between gap-2">
				<Node label="You" sub="USDC" icon={<UsdcLogo className="h-8 w-8" />} />
				<Wire />
				<Node
					label="Bot"
					sub="smart acct"
					icon={<span className="text-lg">⚙</span>}
					accent
				/>
				<Wire />
				<Node label="BTC" sub="to wallet" icon={<BtcLogo className="h-8 w-8" />} />
			</div>

			{/* Exposure readout. */}
			<div className="mt-7 grid grid-cols-2 gap-3">
				<Tile
					label="At rest in your wallet"
					value="$9,999"
					note="never leaves you"
					tone="muted"
				/>
				<Tile
					label="In-flight (exposed)"
					value="$1.20"
					note="≈ 1 hour of flow"
					tone="emerald"
				/>
			</div>
		</div>
	)
}

function Node({
	label,
	sub,
	icon,
	accent
}: {
	label: string
	sub: string
	icon: ReactNode
	accent?: boolean
}) {
	return (
		<div className="flex w-20 shrink-0 flex-col items-center gap-2 text-center">
			<div
				className={`flex h-14 w-14 items-center justify-center rounded-xl text-lg ring-1 ${
					accent
						? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/40'
						: 'bg-zinc-900 text-zinc-300 ring-zinc-700'
				}`}
			>
				{icon}
			</div>
			<div className="leading-tight">
				<div className="text-sm font-medium text-zinc-200">{label}</div>
				<div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
					{sub}
				</div>
			</div>
		</div>
	)
}

function Wire() {
	return (
		<div className="relative h-px flex-1 bg-gradient-to-r from-zinc-700 via-zinc-700 to-zinc-700">
			<span className="sv-flow-dot" style={{ animationDelay: '0s' }} />
			<span className="sv-flow-dot" style={{ animationDelay: '0.8s' }} />
			<span className="sv-flow-dot" style={{ animationDelay: '1.6s' }} />
		</div>
	)
}

function Tile({
	label,
	value,
	note,
	tone
}: {
	label: string
	value: string
	note: string
	tone: 'muted' | 'emerald'
}) {
	return (
		<div
			className={`rounded-xl p-4 ring-1 ${
				tone === 'emerald'
					? 'bg-emerald-500/5 ring-emerald-500/30'
					: 'bg-zinc-900/40 ring-zinc-800'
			}`}
		>
			<div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
				{label}
			</div>
			<div
				className={`mt-1.5 font-mono text-2xl ${
					tone === 'emerald' ? 'text-emerald-400' : 'text-zinc-300'
				}`}
			>
				{value}
			</div>
			<div className="mt-0.5 text-[11px] text-zinc-500">{note}</div>
		</div>
	)
}

function TechBadge({ icon, label }: { icon: ReactNode; label: string }) {
	return (
		<span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
			{icon}
			{label}
		</span>
	)
}

/** The killer contrast: deposit-and-pray vs StreamBot at the same moment. */
function ExposureCompare() {
	return (
		<section className="mx-auto w-full max-w-6xl px-6 py-20">
			<h2 className="text-balance text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
				Same strategy. <span className="text-emerald-400">Different blast radius.</span>
			</h2>
			<p className="mt-3 max-w-2xl text-zinc-400">
				A DCA bot needs maybe $50/day. The classic vault makes you hand over the
				whole bankroll on day one. Streaming caps what an exploit, bug, or bad
				fill can ever touch.
			</p>

			<div className="mt-10 grid gap-4 md:grid-cols-2">
				<div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] p-7">
					<div className="font-mono text-xs uppercase tracking-widest text-rose-400/80">
						Deposit-and-pray
					</div>
					<div className="mt-4 font-mono text-5xl font-semibold text-rose-400">
						$10,000
					</div>
					<div className="mt-1 text-sm text-zinc-400">
						exposed at <span className="font-mono">T = 0</span> — 100% upfront
					</div>
					<div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
						<div className="h-full w-full bg-rose-500/70" />
					</div>
				</div>

				<div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-7">
					<div className="font-mono text-xs uppercase tracking-widest text-emerald-400/90">
						StreamBot
					</div>
					<div className="mt-4 font-mono text-5xl font-semibold text-emerald-400">
						$1
					</div>
					<div className="mt-1 text-sm text-zinc-400">
						exposed at <span className="font-mono">T = 1h</span> — only what flowed
					</div>
					<div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
						<div className="h-full w-[0.6%] min-w-[3px] bg-emerald-400" />
					</div>
				</div>
			</div>
		</section>
	)
}

function HowItWorks() {
	const steps: {
		n: string
		title: string
		icon: ReactNode
		body: string
		tag?: ReactNode
	}[] = [
		{
			n: '01',
			title: 'Open a stream',
			icon: <UsdcLogo className="h-6 w-6" />,
			body: 'Set a rate — say 1 USDC every 30s. Superfluid flows it to your bot block by block. Stop it any time, in the next block.'
		},
		{
			n: '02',
			title: 'The bot trades the inflow',
			icon: <UniswapLogo className="h-6 w-6" />,
			body: 'An autonomous smart account downgrades the streamed USDCx and swaps it into BTC through Uniswap, under slippage and size rules you set.',
			tag: (
				<span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-400 ring-1 ring-zinc-800">
					<ChainlinkLogo className="h-3.5 w-3.5" />
					Execution decentralizes to Chainlink CRE
				</span>
			)
		},
		{
			n: '03',
			title: 'Settles to your wallet',
			icon: <BtcLogo className="h-6 w-6" />,
			body: 'Output lands straight in your wallet. The bot tends to a zero balance between trades — nothing sits around to be drained.'
		}
	]
	return (
		<section
			id="how"
			className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20"
		>
			<div className="font-mono text-xs uppercase tracking-widest text-emerald-400">
				How it works
			</div>
			<h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
				Three moves, then it&apos;s autonomous.
			</h2>

			<div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-800 md:grid-cols-3">
				{steps.map(s => (
					<div key={s.n} className="bg-zinc-950 p-7">
						<div className="flex items-center justify-between">
							<span className="font-mono text-sm text-emerald-400">{s.n}</span>
							{s.icon}
						</div>
						<h3 className="mt-4 text-lg font-semibold text-zinc-100">
							{s.title}
						</h3>
						<p className="mt-2 text-sm leading-relaxed text-zinc-400">
							{s.body}
						</p>
						{s.tag}
					</div>
				))}
			</div>
		</section>
	)
}

/**
 * The Ledger track — the trust layer. Two device-level primitives carry the
 * whole onboarding: an EIP-7702 delegation + atomic batch signed once on the
 * device, and ERC-7730 clear signing so the screen shows what you're actually
 * approving. This is the bounty's thesis: an autonomous agent you can still
 * verify and bound with your own hands.
 */
function LedgerSection({ ledger }: { ledger: CtaState }) {
	const primitives: { title: string; body: ReactNode; tag: string }[] = [
		{
			title: 'One device-signed setup',
			body: (
				<>
					Delegating the EOA (<span className="font-mono text-xs">EIP-7702</span>
					), approving USDC, and opening the stream normally take several
					signatures. Your Ledger signs the delegation{' '}
					<span className="text-zinc-200">and</span> the batched setup tx — so
					the whole bot goes live in{' '}
					<span className="text-amber-300">one hardware approval</span>.
				</>
			),
			tag: 'signDelegationAuthorization → executeBatch'
		},
		{
			title: 'Clear signing, not blind signing',
			body: (
				<>
					An <span className="font-mono text-xs">ERC-7730</span> descriptor makes
					the device render{' '}
					<span className="text-zinc-200">
						“Delegate to Simple7702Account · Base”
					</span>{' '}
					and the real budget and rate — human-readable on the screen, not an
					opaque hex blob. You approve what you can read.
				</>
			),
			tag: 'ERC-7730 descriptor'
		},
		{
			title: 'Bounded by hardware',
			body: (
				<>
					The agent runs autonomously, but the keys never leave the device. Any
					new authority — a fresh stream, a higher rate — is another approval you
					hold in your hand. The trust boundary is{' '}
					<span className="text-zinc-200">physical</span>.
				</>
			),
			tag: 'keys stay on device'
		}
	]

	return (
		<section className="mx-auto w-full max-w-6xl px-6 py-20">
			<div className="overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-950/20 via-zinc-950 to-zinc-950 p-8 sm:p-10">
				<div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-amber-300/90">
					<LedgerLogo className="h-4 w-4" />
					Trust layer · Ledger
				</div>
				<h2 className="mt-4 max-w-3xl text-balance text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
					An autonomous agent you can still{' '}
					<span className="text-amber-300">verify with your hands.</span>
				</h2>
				<p className="mt-3 max-w-2xl text-zinc-400">
					Connect a Ledger and the bot is delegated, funded, and streaming in a
					single device-signed transaction — clear-signed so the screen shows
					exactly what you authorize. The agent acts on its own; the authority to
					set it up is yours, on hardware.
				</p>

				<div className="mt-9 grid gap-px overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800 md:grid-cols-3">
					{primitives.map(p => (
						<div key={p.title} className="bg-zinc-950 p-6">
							<h3 className="text-lg font-semibold text-zinc-100">{p.title}</h3>
							<p className="mt-2 text-sm leading-relaxed text-zinc-400">
								{p.body}
							</p>
							<div className="mt-4 inline-flex rounded-full bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] text-amber-300/90 ring-1 ring-amber-500/20">
								{p.tag}
							</div>
						</div>
					))}
				</div>

				<button
					type="button"
					onClick={ledger.onClick}
					disabled={ledger.disabled}
					title={
						ledger.disabled && !ledger.label.startsWith('Connecting')
							? 'Disconnect the other wallet to use a Ledger'
							: undefined
					}
					className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-amber-400 px-6 text-sm font-semibold text-zinc-950 shadow-lg shadow-amber-500/20 transition-all hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-amber-400"
				>
					<LedgerLogo className="h-4 w-4" />
					{ledger.label}
				</button>
				<p className="mt-2 font-mono text-[11px] text-zinc-600">
					WebHID · Chromium-based browser · device asks to enable smart-account
					upgrade
				</p>
			</div>
		</section>
	)
}

function Security() {
	const switches = [
		'Pause the stream',
		'Revoke the operator',
		'Recover unstreamed USDCx',
		'Sweep the bot'
	]
	return (
		<section className="mx-auto w-full max-w-6xl px-6 py-20">
			<div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-emerald-950/30 via-zinc-950 to-zinc-950 p-10">
				<blockquote className="text-balance text-2xl font-medium leading-snug tracking-tight text-zinc-100 sm:text-3xl">
					“If history&apos;s biggest exploits had run on streams, losses would be
					measured in{' '}
					<span className="text-emerald-400">hours of flow</span> — not in TVL.”
				</blockquote>
				<div className="mt-8 flex flex-wrap gap-2">
					{switches.map(s => (
						<span
							key={s}
							className="rounded-full bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-300 ring-1 ring-zinc-800"
						>
							{s}
						</span>
					))}
				</div>
			</div>
		</section>
	)
}

function BottomCta({ reown }: { reown: CtaState }) {
	return (
		<section className="mx-auto w-full max-w-6xl px-6 pb-24 pt-4 text-center">
			<h2 className="text-balance text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
				Open your StreamBot.
			</h2>
			<p className="mx-auto mt-3 max-w-md text-zinc-400">
				Connect a wallet to set your rate, deploy your bot, and start streaming —
				in one signature.
			</p>
			<button
				type="button"
				onClick={reown.onClick}
				disabled={reown.disabled}
				title={
					reown.disabled
						? 'Disconnect the Ledger to use another wallet'
						: undefined
				}
				className="group mt-7 inline-flex h-12 items-center gap-2 rounded-xl bg-emerald-500 px-7 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/25 transition-all hover:bg-emerald-400 hover:shadow-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-emerald-500 disabled:hover:shadow-emerald-500/25"
			>
				{reown.label}
				<span className="transition-transform group-hover:translate-x-0.5">→</span>
			</button>
		</section>
	)
}
