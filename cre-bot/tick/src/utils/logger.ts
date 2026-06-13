import type { Runtime } from '@chainlink/cre-sdk'

/**
 * Structured logger with the same `info / warn / error` shape as the
 * baseline bot's `getLogger` — so `use-cases/run-dca-tick.ts` is reused
 * verbatim. The ONLY difference is the sink: CRE workflows run inside the
 * DON's deterministic WASM runtime where `console.*` / `process.env` are
 * unavailable, so every line goes through `runtime.log(message)`.
 */
export type LogContext = Record<string, unknown>

export interface Logger {
	info(ctx: LogContext | string, msg?: string): void
	warn(ctx: LogContext | string, msg?: string): void
	error(ctx: LogContext | string, msg?: string): void
}

type Level = 'INFO' | 'WARN' | 'ERROR'

/** Serialise context, stringifying bigints (the bot deals in wei/blocks). */
function serializeContext(ctx: LogContext): string {
	return JSON.stringify(ctx, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

/**
 * Build a logger bound to a CRE `runtime`. The runtime is per-trigger, so
 * the cron handler constructs this once per tick and injects it into the
 * use case. No level filtering: the DON captures every `runtime.log` line.
 */
export function getLogger(runtime: Runtime<unknown>, service: string): Logger {
	function emit(level: Level, ctx: LogContext | string, msg?: string): void {
		const message = typeof ctx === 'string' ? ctx : (msg ?? '')
		const context = typeof ctx === 'string' ? '' : ` ${serializeContext(ctx)}`
		runtime.log(`[${service}] ${level} ${message}${context}`)
	}

	return {
		info: (ctx, msg) => emit('INFO', ctx, msg),
		warn: (ctx, msg) => emit('WARN', ctx, msg),
		error: (ctx, msg) => emit('ERROR', ctx, msg),
	}
}
