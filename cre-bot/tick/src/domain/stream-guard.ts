/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import type { StreamHealth } from './models/stream-health'

/**
 * Mirrors the on-chain guard inside `StreamVaults.closeStreamIfLow`:
 *
 *   trigger = deposit * thresholdBps / 10000
 *   close when availableBalance <= trigger   (while still solvent)
 *
 * Evaluating it off-chain lets the bot decide to close a stream BEFORE
 * spending a transaction — and skip accounts whose stream is healthy or not
 * open at all. Closing while solvent returns the full buffer to the sender and
 * avoids the Superfluid liquidation penalty.
 *
 * Pure: every input is passed in. A sender with no active stream has
 * `deposit === 0n`, which correctly evaluates to "do not close".
 */
/* c8 ignore next -- function-declaration branch inserted by V8; not reachable from tests */
export function shouldCloseStream(health: StreamHealth, thresholdBps: bigint): boolean {
	if (health.deposit <= 0n) return false
	const trigger = (health.deposit * thresholdBps) / 10_000n
	return health.availableBalance <= trigger
}
