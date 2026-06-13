/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
/**
 * Mirrors the E-05 guard inside `StreamVaults.executeSwap`:
 *
 *   if (block.number <= lastSwapBlock + cooldownBlocks - 1) revert SWAP_COOLDOWN_ACTIVE
 *
 * Evaluating it off-chain lets the bot skip an account that is still
 * cooling down **before** spending an RPC quote call, instead of
 * discovering the cooldown through a reverted `simulateContract`.
 *
 * Pure: every input is passed in. A never-swapped account has
 * `lastSwapBlock === 0n`, which correctly evaluates to "not active".
 */
/* c8 ignore next -- function-declaration branch inserted by V8; not reachable from tests */
export function isCooldownActive(
	currentBlock: bigint,
	lastSwapBlock: bigint,
	cooldownBlocks: bigint,
): boolean {
	if (cooldownBlocks === 0n) return false
	return currentBlock <= lastSwapBlock + cooldownBlocks - 1n
}

/**
 * True when a caught error is the on-chain `SWAP_COOLDOWN_ACTIVE` revert
 * (E-05). This is an expected race: the use case pre-checks the cooldown,
 * but another bot can land a swap on the same SA between that read and our
 * submission, so the tx reverts. Callers treat it as an expected skip, not
 * a failure, keeping the error channel meaningful (H-07).
 */
/* c8 ignore next -- function-declaration branch inserted by V8; not reachable from tests */
export function isSwapCooldownRevert(err: unknown): boolean {
	const text = err instanceof Error ? err.message : String(err)
	return text.includes('SWAP_COOLDOWN_ACTIVE')
}
