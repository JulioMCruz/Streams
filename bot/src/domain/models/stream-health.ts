/**
 * Snapshot of a stream sender's Superfluid solvency, as the guardian needs it.
 * Mirrors `ISuperToken.realtimeBalanceOfNow`: `availableBalance` is the spendable
 * balance (it EXCLUDES the locked `deposit` and can go negative once critical);
 * `deposit` is the buffer locked for the sender's outgoing flows of the token.
 */
export type StreamHealth = {
	availableBalance: bigint
	deposit: bigint
}
