/**
 * Tests for settings/config.ts — resolveConfig, ConfigError.
 *
 * Audit findings:
 * - resolveConfig is the CRE analogue of the bot's loadConfig: validates the
 *   injected raw Config JSON and returns a typed WorkflowConfig. Validation must
 *   fail loudly (ConfigError) on out-of-range decimals, bad bigint strings, and
 *   super < underlying decimals.
 * - parseBigInt tolerates whitespace and a trailing 'n' suffix, and rejects
 *   garbage with a clear ConfigError.
 * - requireDecimals rejects floats, negatives, values > 36.
 * - superToUnderlyingDivisor = 10^(superDecimals - underlyingDecimals).
 * - uniswapApiBase trailing slash is stripped.
 */

import { describe, expect, it } from 'bun:test'

import type { Config } from '../../src/settings/config'
import { ConfigError, resolveConfig } from '../../src/settings/config'

// ── Shared valid config fixture ───────────────────────────────────────────────

const STREAM_VAULTS = '0x1111111111111111111111111111111111111111' as const
const STREAM_VAULTS_CONFIG = '0x2222222222222222222222222222222222222222' as const
const SUPER_TOKEN = '0x3333333333333333333333333333333333333333' as const
const TOKEN_IN = '0x4444444444444444444444444444444444444444' as const

function baseConfig(overrides: Partial<Config> = {}): Config {
	return {
		schedule: '*/30 * * * * *',
		chainSelector: '15971525489660198786',
		chainId: 8453,
		addresses: {
			streamVaults: STREAM_VAULTS,
			streamVaultsConfig: STREAM_VAULTS_CONFIG,
			superTokenIn: SUPER_TOKEN,
			tokenIn: TOKEN_IN,
		},
		discoveryFromBlock: '23100000',
		superTokenDecimals: 18,
		underlyingDecimals: 6,
		uniswapApiBase: 'https://trading-api-labs.interface.gateway.uniswap.org',
		...overrides,
	}
}

describe('settings/config', () => {
	describe('resolveConfig — happy paths', () => {
		it('Should return a WorkflowConfig from a fully valid Config', () => {
			const cfg = resolveConfig(baseConfig())

			expect(cfg.chainSelector).toBe(15971525489660198786n)
			expect(cfg.chainId).toBe(8453)
			expect(cfg.discoveryFromBlock).toBe(23100000n)
			expect(cfg.addresses.streamVaults).toBe(STREAM_VAULTS)
			expect(cfg.addresses.streamVaultsConfig).toBe(STREAM_VAULTS_CONFIG)
			expect(cfg.strategy.superTokenIn).toBe(SUPER_TOKEN)
			expect(cfg.strategy.tokenIn).toBe(TOKEN_IN)
		})

		it('Should compute superToUnderlyingDivisor = 10^(super - underlying)', () => {
			// USDCx(18) → USDC(6): 10^12
			const cfg = resolveConfig(baseConfig({ superTokenDecimals: 18, underlyingDecimals: 6 }))
			expect(cfg.strategy.superToUnderlyingDivisor).toBe(10n ** 12n)
		})

		it('Should compute divisor = 1 when super === underlying (same-decimals pair)', () => {
			const cfg = resolveConfig(baseConfig({ superTokenDecimals: 18, underlyingDecimals: 18 }))
			expect(cfg.strategy.superToUnderlyingDivisor).toBe(1n)
		})

		it('Should compute WBTC-like divisor: 18 super, 8 underlying → 10^10', () => {
			const cfg = resolveConfig(baseConfig({ superTokenDecimals: 18, underlyingDecimals: 8 }))
			expect(cfg.strategy.superToUnderlyingDivisor).toBe(10n ** 10n)
		})

		it('Should strip a trailing slash from uniswapApiBase', () => {
			const cfg = resolveConfig(baseConfig({ uniswapApiBase: 'https://trading-api.example.com/' }))
			expect(cfg.uniswapApiBase).toBe('https://trading-api.example.com')
		})

		it('Should preserve uniswapApiBase without trailing slash unchanged', () => {
			const cfg = resolveConfig(baseConfig({ uniswapApiBase: 'https://trading-api.example.com' }))
			expect(cfg.uniswapApiBase).toBe('https://trading-api.example.com')
		})

		it('Should pass chainId through unchanged', () => {
			const cfg = resolveConfig(baseConfig({ chainId: 84532 }))
			expect(cfg.chainId).toBe(84532)
		})

		it('Should handle chainSelector = "0" (staging placeholder)', () => {
			const cfg = resolveConfig(baseConfig({ chainSelector: '0' }))
			expect(cfg.chainSelector).toBe(0n)
		})

		it('Should handle discoveryFromBlock = "0" (deploy block unknown)', () => {
			const cfg = resolveConfig(baseConfig({ discoveryFromBlock: '0' }))
			expect(cfg.discoveryFromBlock).toBe(0n)
		})
	})

	describe('parseBigInt — chainSelector and discoveryFromBlock', () => {
		it('Should parse a plain decimal string', () => {
			const cfg = resolveConfig(baseConfig({ chainSelector: '12345' }))
			expect(cfg.chainSelector).toBe(12345n)
		})

		it('Should tolerate a trailing BigInt "n" suffix', () => {
			const cfg = resolveConfig(baseConfig({ discoveryFromBlock: '6789n' }))
			expect(cfg.discoveryFromBlock).toBe(6789n)
		})

		it('Should trim surrounding whitespace from chainSelector', () => {
			const cfg = resolveConfig(baseConfig({ chainSelector: '  42  ' }))
			expect(cfg.chainSelector).toBe(42n)
		})

		it('Should throw ConfigError when chainSelector is not a valid integer string', () => {
			expect(() => resolveConfig(baseConfig({ chainSelector: 'not-a-number' }))).toThrow(ConfigError)
		})

		it('Should throw ConfigError when discoveryFromBlock is garbage', () => {
			expect(() => resolveConfig(baseConfig({ discoveryFromBlock: 'abc' }))).toThrow(ConfigError)
		})

		it('Should include the field name in the ConfigError message for chainSelector', () => {
			let msg = ''
			try {
				resolveConfig(baseConfig({ chainSelector: 'bad' }))
			} catch (e) {
				msg = (e as Error).message
			}
			expect(msg).toContain('chainSelector')
		})

		it('Should include the field name in the ConfigError message for discoveryFromBlock', () => {
			let msg = ''
			try {
				resolveConfig(baseConfig({ discoveryFromBlock: 'bad' }))
			} catch (e) {
				msg = (e as Error).message
			}
			expect(msg).toContain('discoveryFromBlock')
		})
	})

	describe('requireDecimals — superTokenDecimals / underlyingDecimals', () => {
		it('Should accept 0 (minimum valid decimal)', () => {
			const cfg = resolveConfig(baseConfig({ superTokenDecimals: 0, underlyingDecimals: 0 }))
			expect(cfg.strategy.superToUnderlyingDivisor).toBe(1n) // 10^0
		})

		it('Should accept 36 (maximum valid decimal)', () => {
			expect(() =>
				resolveConfig(baseConfig({ superTokenDecimals: 36, underlyingDecimals: 0 })),
			).not.toThrow()
		})

		it('Should throw ConfigError when superTokenDecimals is negative', () => {
			expect(() => resolveConfig(baseConfig({ superTokenDecimals: -1 }))).toThrow(ConfigError)
		})

		it('Should throw ConfigError when underlyingDecimals is negative', () => {
			expect(() => resolveConfig(baseConfig({ underlyingDecimals: -1 }))).toThrow(ConfigError)
		})

		it('Should throw ConfigError when superTokenDecimals is above 36', () => {
			expect(() => resolveConfig(baseConfig({ superTokenDecimals: 40 }))).toThrow(ConfigError)
		})

		it('Should throw ConfigError when underlyingDecimals is above 36', () => {
			expect(() => resolveConfig(baseConfig({ underlyingDecimals: 40 }))).toThrow(ConfigError)
		})

		it('Should throw ConfigError when superTokenDecimals is not an integer (float)', () => {
			expect(() => resolveConfig(baseConfig({ superTokenDecimals: 18.5 }))).toThrow(ConfigError)
		})

		it('Should include the decimal range hint in the ConfigError message', () => {
			let msg = ''
			try {
				resolveConfig(baseConfig({ superTokenDecimals: -1 }))
			} catch (e) {
				msg = (e as Error).message
			}
			expect(msg).toContain('0 and 36')
		})

		it('Should throw ConfigError when super decimals < underlying decimals', () => {
			expect(() =>
				resolveConfig(baseConfig({ superTokenDecimals: 6, underlyingDecimals: 18 })),
			).toThrow(ConfigError)
		})

		it('Should include both values in the ConfigError when super < underlying', () => {
			let msg = ''
			try {
				resolveConfig(baseConfig({ superTokenDecimals: 6, underlyingDecimals: 18 }))
			} catch (e) {
				msg = (e as Error).message
			}
			expect(msg).toContain('6')
			expect(msg).toContain('18')
		})
	})

	describe('ConfigError', () => {
		it('Should be an Error subclass named ConfigError', () => {
			const err = new ConfigError('boom')
			expect(err).toBeInstanceOf(Error)
			expect(err.name).toBe('ConfigError')
			expect(err.message).toBe('boom')
		})
	})
})
