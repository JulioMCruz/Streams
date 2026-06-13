/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import 'dotenv/config'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Address, Chain } from 'viem'
import { base, baseSepolia } from 'viem/chains'

import type { StrategyTokens } from '../domain/strategy'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// src/settings → bot → repo root
const REPO_ROOT = path.resolve(__dirname, '../../..')

export class ConfigError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ConfigError'
	}
}

function requireEnv(name: string, value: string | undefined): string {
	if (!value || value.length === 0) {
		throw new ConfigError(
			`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`,
		)
	}
	return value
}

/**
 * Require a 0x-prefixed 32-byte (64 hex chars) secp256k1 private key.
 * `privateKeyToAccount` throws a cryptic viem error on a malformed key; we
 * fail at config load with an actionable ConfigError instead (H-03). The
 * value itself is never echoed back in the message.
 */
function requirePrivateKey(name: string, value: string | undefined): `0x${string}` {
	const key = requireEnv(name, value)
	if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
		throw new ConfigError(
			`${name} must be a 0x-prefixed 32-byte hex private key (66 chars total).`,
		)
	}
	return key as `0x${string}`
}

/**
 * Parse a block number from env. Tolerates surrounding whitespace and a
 * trailing `n` (the JS BigInt literal suffix — a common copy/paste from
 * docs). Empty/unset → `0n`. Anything else invalid → a clear ConfigError
 * instead of a cryptic `Cannot convert ... to a BigInt`.
 */
function parseFromBlock(name: string, raw: string | undefined): bigint {
	const value = (raw ?? '').trim().replace(/n$/i, '')
	if (value === '') return 0n
	try {
		return BigInt(value)
	} catch {
		throw new ConfigError(
			`${name} must be an integer block number (got "${raw}").`,
		)
	}
}

/**
 * Parse a token decimals value from env. Empty/unset falls back to the
 * given default; anything else must be an integer in [0, 36]. Used to
 * derive `superToUnderlyingDivisor` instead of hardcoding it, so the bot
 * can stream a SuperToken whose decimal gap differs from USDCx→USDC (H-06).
 */
function parseDecimals(name: string, raw: string | undefined, fallback: number): number {
	if (raw === undefined || raw.trim() === '') return fallback
	const n = Number(raw)
	if (!Number.isInteger(n) || n < 0 || n > 36) {
		throw new ConfigError(
			`${name} must be an integer between 0 and 36 (got "${raw}").`,
		)
	}
	return n
}

/**
 * Typed, validated bot configuration. Mirrors the Fireblocks adapter's
 * `LambdaConfig` shape: a single `loadConfig()` entry point that the
 * driving adapter (`entry-point/main.ts`) calls once at startup, so no
 * other layer ever reads `process.env`.
 */
export interface BotConfig {
	readonly chain: Chain
	readonly rpcUrl: string
	/// RPC used only for `eth_getLogs` discovery. Lets the main `rpcUrl` be a
	/// throughput-friendly provider (e.g. Alchemy) whose free tier caps getLogs
	/// ranges, while discovery uses a wide-range endpoint. Falls back to `rpcUrl`.
	readonly logsRpcUrl: string
	readonly botPrivateKey: `0x${string}`
	readonly pollIntervalMs: number
	readonly runOnce: boolean
	readonly discoveryFromBlock: bigint
	readonly uniswap: {
		readonly apiBase: string
		readonly apiKey: string
	}
	readonly addresses: {
		readonly streamVaults: Address
		readonly streamVaultsConfig: Address
	}
	readonly strategy: StrategyTokens
}

/// Per-network profile: the viem chain, which env var holds the RPC (with a
/// public fallback), and the canonical underlying USDC. Keyed by NETWORK_NAME,
/// which also names the `deployments/<NETWORK_NAME>/` folder. The bot reads its
/// contract addresses from there, so the env name and the deploy folder match.
interface NetworkProfile {
	readonly chain: Chain
	readonly rpcEnvVar: string
	readonly defaultUsdc: Address
}

const NETWORKS: Record<string, NetworkProfile> = {
	baseSepolia: {
		chain: baseSepolia,
		rpcEnvVar: 'RPC_HTTPS_BASE_SEPOLIA',
		defaultUsdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
	},
	baseMainnet: {
		chain: base,
		rpcEnvVar: 'RPC_HTTPS_BASE_MAINNET',
		defaultUsdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
	},
}

function networkName(): string {
	return process.env.NETWORK_NAME ?? 'baseSepolia'
}

/**
 * Resolve the chain profile for a network name. Unknown names fall back to the
 * baseSepolia profile — a genuinely wrong NETWORK_NAME then fails loudly later
 * at the deployment-file read, which is keyed off the same name. Exported for
 * direct unit testing without touching the filesystem.
 */
export function networkProfile(name: string): NetworkProfile {
	return NETWORKS[name] ?? NETWORKS.baseSepolia
}

function deploymentsDir(): string {
	/// Folder under contracts/deployments to load addresses from.
	/// Defaults to baseSepolia; set NETWORK_NAME=baseMainnet to target mainnet.
	return path.join(REPO_ROOT, 'contracts', 'deployments', networkName())
}

function readDeploymentAddress(name: string): Address {
	const file = path.join(deploymentsDir(), name, `${name}.json`)
	if (!fs.existsSync(file)) {
		throw new ConfigError(
			`Deployment file not found: ${file}. Run \`yarn workspace @streams/contracts deploy baseSepolia --tags deploy\` first.`,
		)
	}
	const json = JSON.parse(fs.readFileSync(file, 'utf-8'))
	const address = (json.proxy ?? json.address) as Address | undefined
	if (!address) {
		throw new ConfigError(`Deployment file ${file} has no proxy/address field`)
	}
	return address
}

/* c8 ignore next -- function-declaration branch inserted by V8; not reachable from tests */
export function loadConfig(): BotConfig {
	// Derive the SuperToken→underlying divisor from configurable decimals
	// rather than hardcoding 10^12, validating the invariant up front (H-06).
	const superDecimals = parseDecimals(
		'SUPER_TOKEN_DECIMALS',
		process.env.SUPER_TOKEN_DECIMALS,
		18,
	)
	const underlyingDecimals = parseDecimals(
		'UNDERLYING_DECIMALS',
		process.env.UNDERLYING_DECIMALS,
		6,
	)
	if (superDecimals < underlyingDecimals) {
		throw new ConfigError(
			`SUPER_TOKEN_DECIMALS (${superDecimals}) must be >= UNDERLYING_DECIMALS (${underlyingDecimals}).`,
		)
	}

	const network = networkProfile(networkName())
	const rpcUrl = requireEnv(network.rpcEnvVar, process.env[network.rpcEnvVar])
	// Discovery RPC: explicit override, else reuse the main RPC.
	const logsRpc = process.env.RPC_HTTPS_LOGS
	const logsRpcUrl = logsRpc && logsRpc.length > 0 ? logsRpc : rpcUrl

	return {
		chain: network.chain,
		rpcUrl,
		logsRpcUrl,
		botPrivateKey: requirePrivateKey(
			'WALLET_BOT_PRIVATE_KEY',
			process.env.WALLET_BOT_PRIVATE_KEY,
		),
		pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30_000),
		runOnce: process.env.RUN_ONCE === '1' || process.env.RUN_ONCE === 'true',
		discoveryFromBlock: parseFromBlock(
			'DISCOVERY_FROM_BLOCK',
			process.env.DISCOVERY_FROM_BLOCK,
		),
		uniswap: {
			apiBase: (
				process.env.UNISWAP_API_BASE ??
				'https://trading-api-labs.interface.gateway.uniswap.org'
			).replace(/\/$/, ''),
			apiKey: process.env.UNISWAP_API_KEY ?? '',
		},
		addresses: {
			streamVaults: readDeploymentAddress('StreamVaults'),
			streamVaultsConfig: readDeploymentAddress('StreamVaultsConfig'),
		},
		strategy: {
			// Required: there is no safe default for the streamed SuperToken —
			// a wrong/placeholder address makes the bot read a zero balance and
			// silently never trade. Fail loudly instead.
			superTokenIn: requireEnv(
				'SUPER_TOKEN_USDCX',
				process.env.SUPER_TOKEN_USDCX,
			) as Address,
			// Canonical underlying USDC for the active network. Override via env.
			tokenIn: (process.env.TOKEN_IN_USDC ?? network.defaultUsdc) as Address,
			// Superfluid preserves value 1:1 across decimals; the divisor is
			// 10^(superDecimals - underlyingDecimals). Default 10^12 (USDCx
			// 18dec → USDC 6dec); override via the *_DECIMALS env vars.
			superToUnderlyingDivisor: 10n ** BigInt(superDecimals - underlyingDecimals),
		},
	}
}
