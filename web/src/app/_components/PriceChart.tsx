'use client'

import {
	CandlestickSeries,
	ColorType,
	createChart,
	createSeriesMarkers,
	CrosshairMode,
	type IChartApi,
	type ISeriesApi,
	type ISeriesMarkersPluginApi,
	type SeriesMarker,
	type Time,
	type UTCTimestamp
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'

import { type Asset, ASSETS } from '@/lib/asset'
import type { Swap } from '@/lib/useSwapHistory'

import { BtcLogo, EthLogo } from './Logos'

type Candle = {
	time: UTCTimestamp
	open: number
	high: number
	low: number
	close: number
}

const restUrl = (binance: string) =>
	`https://api.binance.com/api/v3/klines?symbol=${binance}&interval=1m&limit=200`
const wsUrl = (binance: string) =>
	`wss://stream.binance.com:9443/ws/${binance.toLowerCase()}@kline_1m`

const toCandle = (k: (string | number)[]): Candle => ({
	time: (Number(k[0]) / 1000) as UTCTimestamp,
	open: Number(k[1]),
	high: Number(k[2]),
	low: Number(k[3]),
	close: Number(k[4])
})

/// Swap executions become time-anchored markers on the candles — they don't
/// carry a price (our mock execution price isn't the real BTC price), they
/// just mark "the bot bought here".
function swapMarkers(swaps: Swap[]): SeriesMarker<Time>[] {
	let last = 0
	return swaps
		.map(s => {
			const t = Math.max(s.time, last + 1)
			last = t
			return {
				time: t as UTCTimestamp,
				position: 'belowBar' as const,
				color: '#34d399',
				shape: 'arrowUp' as const,
				text: 'buy'
			}
		})
		.filter(m => Number(m.time) > 0)
}

/**
 * Real BTC/USD candlestick chart (Binance 1-minute klines, seeded over REST
 * and updated live over WebSocket), with the bot's DCA buys marked on the
 * timeline. This is the actual market price — the on-chain swaps settle a
 * mock target token, so we overlay them as markers rather than a price line.
 */
type Ticker = {
	price: number
	openRef: number // price 24h-ish ago (first candle of the seeded window)
}

const fmtPrice = (n: number) =>
	n.toLocaleString('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	})

const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

export function PriceChart({
	swaps,
	asset = 'BTC',
	onAssetChange
}: {
	swaps: Swap[]
	asset?: Asset
	onAssetChange?: (a: Asset) => void
}) {
	const containerRef = useRef<HTMLDivElement>(null)
	const chartRef = useRef<IChartApi | null>(null)
	const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
	const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
	const [status, setStatus] = useState<'loading' | 'live' | 'error'>('loading')
	const [ticker, setTicker] = useState<Ticker | null>(null)

	// Build the chart + candlestick series once, then seed it over REST and
	// keep it live over the kline WebSocket. Falls back to REST polling if the
	// socket can't open (some networks block Binance's stream endpoint).
	useEffect(() => {
		const el = containerRef.current
		if (!el) return

		const binance = ASSETS[asset].binance
		setStatus('loading')
		setTicker(null)

		const chart = createChart(el, {
			layout: {
				background: { type: ColorType.Solid, color: 'transparent' },
				textColor: '#a1a1aa',
				fontFamily: 'var(--font-geist-mono), monospace',
				attributionLogo: false
			},
			grid: {
				vertLines: { color: 'rgba(63,63,70,0.25)' },
				horzLines: { color: 'rgba(63,63,70,0.25)' }
			},
			crosshair: { mode: CrosshairMode.Normal },
			rightPriceScale: { borderColor: 'rgba(63,63,70,0.5)' },
			timeScale: {
				borderColor: 'rgba(63,63,70,0.5)',
				timeVisible: true,
				secondsVisible: false,
				// Roomy default spacing so each 1-minute candle is visible.
				// Wheel/pinch can still scale in further.
				barSpacing: 10,
				minBarSpacing: 1,
				rightOffset: 6
			},
			handleScroll: {
				mouseWheel: true,
				pressedMouseMove: true,
				horzTouchDrag: true,
				vertTouchDrag: true
			},
			handleScale: {
				mouseWheel: true,
				pinch: true,
				axisPressedMouseMove: true,
				axisDoubleClickReset: true
			},
			autoSize: true
		})
		const series = chart.addSeries(CandlestickSeries, {
			upColor: '#10b981',
			downColor: '#f43f5e',
			borderUpColor: '#10b981',
			borderDownColor: '#f43f5e',
			wickUpColor: '#10b981',
			wickDownColor: '#f43f5e',
			priceFormat: { type: 'price', precision: 0, minMove: 1 }
		})
		const markers = createSeriesMarkers(series, [])

		chartRef.current = chart
		seriesRef.current = series
		markersRef.current = markers

		let ws: WebSocket | null = null
		let pollId: ReturnType<typeof setInterval> | null = null
		let disposed = false

		const applyLatest = async () => {
			const res = await fetch(restUrl(binance))
			const raw = (await res.json()) as (string | number)[][]
			if (disposed) return
			const latest = raw.map(toCandle)
			const tail = latest[latest.length - 1]
			const head = latest[0]
			if (tail) {
				series.update(tail)
				if (head)
					setTicker({ price: tail.close, openRef: head.open })
			}
		}

		const seedAndStream = async () => {
			try {
				const res = await fetch(restUrl(binance))
				const raw = (await res.json()) as (string | number)[][]
				if (disposed) return
				const candles = raw.map(toCandle)
				series.setData(candles)
				// Default view: the last ~60 minutes, so the user lands on a
				// readable minute-by-minute scale instead of all 200 candles
				// crammed together. Wheel/pinch zoom and drag still work.
				if (candles.length > 0) {
					const last = candles.length - 1
					chart.timeScale().setVisibleLogicalRange({
						from: Math.max(0, last - 60),
						to: last + 6
					})
					setTicker({
						price: candles[last].close,
						openRef: candles[0].open
					})
				}
				setStatus('live')
			} catch {
				if (!disposed) setStatus('error')
				return
			}

			try {
				ws = new WebSocket(wsUrl(binance))
				ws.onmessage = ev => {
					const msg = JSON.parse(ev.data as string)
					const k = msg?.k
					if (!k) return
					const close = Number(k.c)
					series.update({
						time: (Number(k.t) / 1000) as UTCTimestamp,
						open: Number(k.o),
						high: Number(k.h),
						low: Number(k.l),
						close
					})
					setTicker(prev =>
						prev ? { ...prev, price: close } : prev
					)
				}
				ws.onerror = () => {
					ws?.close()
					if (!pollId && !disposed)
						pollId = setInterval(() => void applyLatest(), 15_000)
				}
			} catch {
				pollId = setInterval(() => void applyLatest(), 15_000)
			}
		}

		void seedAndStream()

		return () => {
			disposed = true
			ws?.close()
			if (pollId) clearInterval(pollId)
			chart.remove()
			chartRef.current = null
			seriesRef.current = null
			markersRef.current = null
		}
	}, [asset])

	// Refresh swap markers whenever the swap set changes.
	useEffect(() => {
		markersRef.current?.setMarkers(swapMarkers(swaps))
	}, [swaps])

	const changePct =
		ticker && ticker.openRef > 0
			? ((ticker.price - ticker.openRef) / ticker.openRef) * 100
			: null
	const up = changePct !== null && changePct >= 0

	return (
		<div className="flex h-full w-full flex-col">
			<header className="mb-2 flex shrink-0 items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					{asset === 'BTC' ? (
						<BtcLogo className="h-6 w-6" />
					) : (
						<EthLogo className="h-6 w-6" />
					)}
					<div className="flex items-baseline gap-2">
						<h2 className="text-sm font-semibold text-zinc-100">{asset}-USD</h2>
						{ticker ? (
							<>
								<span className="font-mono text-base font-semibold text-zinc-50">
									${fmtPrice(ticker.price)}
								</span>
								{changePct !== null ? (
									<span
										className={`font-mono text-xs font-medium ${up ? 'text-emerald-400' : 'text-rose-400'}`}
									>
										{fmtPct(changePct)}
									</span>
								) : null}
							</>
						) : (
							<span className="text-xs text-zinc-500">loading…</span>
						)}
					</div>
				</div>
				<div className="flex items-center gap-3 text-xs">
					{onAssetChange ? (
						<div className="inline-flex rounded-lg bg-zinc-900 p-0.5 ring-1 ring-zinc-800">
							{(['BTC', 'ETH'] as const).map(a => (
								<button
									key={a}
									type="button"
									onClick={() => onAssetChange(a)}
									className={`flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-colors ${
										asset === a
											? 'bg-emerald-500 text-zinc-950'
											: 'text-zinc-400 hover:text-zinc-200'
									}`}
								>
									{a === 'BTC' ? (
										<BtcLogo className="h-3.5 w-3.5" />
									) : (
										<EthLogo className="h-3.5 w-3.5" />
									)}
									{a}
								</button>
							))}
						</div>
					) : null}
					<span className="flex items-center gap-1.5">
						<span
							className={`h-1.5 w-1.5 rounded-full ${
								status === 'live'
									? 'animate-pulse bg-emerald-400'
									: status === 'error'
										? 'bg-rose-500'
										: 'bg-zinc-500'
							}`}
						/>
						<span className="text-zinc-500">
							{status === 'live'
								? 'live'
								: status === 'error'
									? 'offline'
									: 'loading'}
						</span>
					</span>
				</div>
			</header>
			<div ref={containerRef} className="min-h-0 w-full flex-1" />
		</div>
	)
}
