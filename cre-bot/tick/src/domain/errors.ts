/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
/**
 * Business outcomes the bot can hit while evaluating a smart account.
 * Mirrors the Python adapter's `DomainError(StrEnum)` taxonomy: a flat
 * set of stable string codes the rest of the bot can branch on without
 * matching on free-text messages.
 */
export enum BotErrorCode {
	NO_TARGETS = 'NO_TARGETS',
	BALANCE_UNAVAILABLE = 'BALANCE_UNAVAILABLE',
	BELOW_MIN_TRADE = 'BELOW_MIN_TRADE',
	QUOTE_UNAVAILABLE = 'QUOTE_UNAVAILABLE',
}

/**
 * Domain-level error. Carries a stable {@link BotErrorCode} so callers
 * can decide whether to skip the account quietly or escalate. Pure: no
 * transport/HTTP concern leaks in here.
 */
export class BotError extends Error {
	constructor(
		public readonly code: BotErrorCode,
		message: string,
	) {
		super(message)
		this.name = 'BotError'
	}
	/* c8 ignore next -- class-closing brace branch inserted by V8; not reachable */
}
