import type { Address } from 'viem'

import type { StrategyTokens } from '../domain/strategy'

/**
 * Raw workflow config — the JSON shape CRE injects as `runtime.config`
 * (from `config.staging.json` / `config.production.json`). This is the
 * CRE analogue of the baseline bot's `.env` + deployment files: inside the
 * DON's WASM runtime there is no `process.env` and no filesystem, so every
 * address/parameter must arrive through this object.
 *
 * Secrets (e.g. the Uniswap API key) do NOT live here — they come from
 * `secrets.yaml` and are read at run time via `runtime.getSecret(...)` in
 * the quote adapter, never committed to the config file.
 *
 * Numbers that exceed JS `number` safety (chain selector, block numbers)
 * are carried as decimal strings and parsed to `bigint` in `resolveConfig`.
 */
export type Config = {
	/** Cron expression driving the tick (e.g. `*\/30 * * * * *`). */
	schedule: string
	/** CRE chain selector for the target EVM chain (Base = a fixed bigint). */
	chainSelector: string
	/** EVM chainId (e.g. Base = 8453) — for the Uniswap Trading API request. */
	chainId: number
	/** Contract + token addresses the bot reads from env/deployments in the baseline. */
	addresses: {
		streamVaults: Address
		streamVaultsConfig: Address
		/** Streamed SuperToken (USDCx). Required — a wrong value reads a zero balance. */
		superTokenIn: Address
		/** Underlying USDC the SuperToken downgrades into. */
		tokenIn: Address
	}
	/** First block to scan for `SmartAccountCreated` (deploy block). */
	discoveryFromBlock: string
	/** SuperToken / underlying decimals — derive the divisor, don't hardcode 10^12 (H-06). */
	superTokenDecimals: number
	underlyingDecimals: number
	/** Uniswap Trading API base URL. */
	uniswapApiBase: string
	/** Uniswap Trading API key (sent as `x-api-key`); the labs gateway now
	 * returns 401 without it. Ideally a secret; injected via config for the demo. */
	uniswapApiKey?: string
}

export class ConfigError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ConfigError'
	}
}

/**
 * Typed, validated workflow configuration — the CRE analogue of the
 * baseline bot's `BotConfig`. Note the deliberate absence of `rpcUrl` and
 * `botPrivateKey`: in CRE the RPC endpoints live in `project.yaml` and the
 * signing is done by the DON via `EVMClient.writeReport` (no single hot
 * key). That is the whole "swap one adapter" win.
 */
export interface WorkflowConfig {
	readonly chainSelector: bigint
	readonly chainId: number
	readonly discoveryFromBlock: bigint
	readonly uniswapApiBase: string
	readonly uniswapApiKey?: string
	readonly addresses: {
		readonly streamVaults: Address
		readonly streamVaultsConfig: Address
	}
	readonly strategy: StrategyTokens
}

function parseBigInt(name: string, raw: string): bigint {
	const value = (raw ?? '').trim().replace(/n$/i, '')
	try {
		return BigInt(value)
	} catch {
		throw new ConfigError(`${name} must be an integer string (got "${raw}").`)
	}
}

function requireDecimals(name: string, n: number): number {
	if (!Number.isInteger(n) || n < 0 || n > 36) {
		throw new ConfigError(`${name} must be an integer between 0 and 36 (got "${n}").`)
	}
	return n
}

/**
 * Resolve and validate the raw injected `Config` into a typed
 * `WorkflowConfig`. Called once per tick by the cron handler (`main.ts`),
 * which is the only place that touches `runtime.config` — mirroring the
 * baseline bot's rule that only `settings/config.ts` reads the outside world.
 */
export function resolveConfig(config: Config): WorkflowConfig {
	const superDecimals = requireDecimals('superTokenDecimals', config.superTokenDecimals)
	const underlyingDecimals = requireDecimals('underlyingDecimals', config.underlyingDecimals)
	if (superDecimals < underlyingDecimals) {
		throw new ConfigError(
			`superTokenDecimals (${superDecimals}) must be >= underlyingDecimals (${underlyingDecimals}).`,
		)
	}

	return {
		chainSelector: parseBigInt('chainSelector', config.chainSelector),
		chainId: config.chainId,
		discoveryFromBlock: parseBigInt('discoveryFromBlock', config.discoveryFromBlock),
		uniswapApiBase: config.uniswapApiBase.replace(/\/$/, ''),
		uniswapApiKey: config.uniswapApiKey ?? '',
		addresses: {
			streamVaults: config.addresses.streamVaults,
			streamVaultsConfig: config.addresses.streamVaultsConfig,
		},
		strategy: {
			superTokenIn: config.addresses.superTokenIn,
			tokenIn: config.addresses.tokenIn,
			// Superfluid preserves value 1:1 across decimals; divisor is
			// 10^(superDecimals - underlyingDecimals). USDCx(18)→USDC(6) = 10^12.
			superToUnderlyingDivisor: 10n ** BigInt(superDecimals - underlyingDecimals),
		},
	}
}
