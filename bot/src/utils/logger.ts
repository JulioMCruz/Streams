/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
/**
 * Minimal structured logger with the same `info / warn / error` shape as
 * the Python adapter's Powertools logger — but dependency-free, so the
 * bot stays a thin workspace. Each line is prefixed with the service
 * name; structured context is passed as the first arg.
 */
export type LogContext = Record<string, unknown>

export interface Logger {
	info(ctx: LogContext | string, msg?: string): void
	warn(ctx: LogContext | string, msg?: string): void
	error(ctx: LogContext | string, msg?: string): void
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
type Level = keyof typeof LEVELS

function serializeContext(ctx: LogContext): string {
	return JSON.stringify(ctx, (_k, v) =>
		typeof v === 'bigint' ? v.toString() : v,
	)
}

/* c8 ignore next -- function-declaration branch inserted by V8; not reachable from tests */
export function getLogger(service: string): Logger {
	const configured = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level
	const threshold = LEVELS[configured] ?? LEVELS.info

	function emit(level: Level, ctx: LogContext | string, msg?: string): void {
		if (LEVELS[level] < threshold) return
		const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
		const message = typeof ctx === 'string' ? ctx : (msg ?? '')
		const context = typeof ctx === 'string' ? '' : ` ${serializeContext(ctx)}`
		sink(`[${service}] ${level.toUpperCase()} ${message}${context}`)
	}

	return {
		info: (ctx, msg) => emit('info', ctx, msg),
		warn: (ctx, msg) => emit('warn', ctx, msg),
		error: (ctx, msg) => emit('error', ctx, msg),
	}
}
