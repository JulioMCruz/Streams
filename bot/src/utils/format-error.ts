/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
/** Hard cap on a rendered error string so a hostile/huge payload can't blow up a log line. */
const MAX_LEN = 500

/** Object keys whose values are redacted before an error object reaches the logs. */
const SECRET_KEY = /(key|token|secret|auth|password|signature|private|mnemonic|seed)/i

function cap(text: string): string {
	return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN)}…[truncated]` : text
}

/**
 * Render an unknown thrown value into a safe, bounded log string.
 *
 * - `Error`  → its `message` (the common case: viem/fetch errors land here).
 * - object   → JSON with any key matching {@link SECRET_KEY} replaced by
 *   `[redacted]`, so an upstream HTTP error object can't leak an API key or
 *   a signature into the logs (H-04). BigInt values are stringified.
 * - anything else → `String(value)`.
 *
 * The result is always capped at {@link MAX_LEN} characters.
 */
/* c8 ignore next -- function-declaration branch inserted by V8; not reachable from tests */
export function formatError(err: unknown): string {
	if (err instanceof Error) return cap(err.message)
	if (err !== null && typeof err === 'object') {
		try {
			return cap(
				JSON.stringify(err, (k, v) =>
					k && SECRET_KEY.test(k)
						? '[redacted]'
						: typeof v === 'bigint'
							? v.toString()
							: v,
				),
			)
		} catch {
			// Circular or otherwise non-serialisable object.
			return cap(String(err))
		}
	}
	return cap(String(err))
}
