/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
/**
 * Resilience policy for the poll loop (H-05). Pure + stateful-but-trivial,
 * so the backoff maths is unit-tested in isolation while `entry-point/main`
 * only wires it. Without this, a persistent RPC/API outage makes the bot
 * hammer the upstream every `pollIntervalMs` forever — burning the Uniswap
 * quota and risking an API-key ban.
 */
export interface BackoffPolicy {
	/** Delay between healthy ticks (= the normal poll interval). */
	readonly baseMs: number
	/** Upper bound the exponential backoff is clamped to. */
	readonly maxMs: number
	/** Consecutive failures after which the breaker reports "open". */
	readonly maxConsecutiveFailures: number
}

/**
 * Delay before the next tick given the current consecutive-failure count.
 * `0` failures → `baseMs` (normal cadence). Each additional failure doubles
 * the wait (`baseMs * 2^(failures-1)`), clamped at `maxMs`.
 */
export function backoffDelayMs(failures: number, policy: BackoffPolicy): number {
	if (failures <= 0) return policy.baseMs
	return Math.min(policy.baseMs * 2 ** (failures - 1), policy.maxMs)
}

/**
 * Tracks consecutive tick failures and turns them into a backoff delay.
 * `recordSuccess` resets the streak; `recordFailure` grows it. `isOpen`
 * lets the caller emit a distinct "circuit open" warning once the failure
 * streak crosses the configured threshold (the loop keeps running at the
 * clamped `maxMs` cadence rather than dying — an autonomous bot should not
 * silently stop).
 */
export class TickCircuitBreaker {
	private failures = 0

	constructor(private readonly policy: BackoffPolicy) {}

	recordSuccess(): void {
		this.failures = 0
	}

	recordFailure(): void {
		this.failures += 1
	}

	get consecutiveFailures(): number {
		return this.failures
	}

	nextDelayMs(): number {
		return backoffDelayMs(this.failures, this.policy)
	}

	isOpen(): boolean {
		return this.failures >= this.policy.maxConsecutiveFailures
	}
	/* c8 ignore next -- class-closing brace branch inserted by V8; not reachable */
}
