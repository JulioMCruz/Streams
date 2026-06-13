/**
 * Tests for settings/config.ts — loadConfig + ConfigError.
 *
 * Audit findings:
 * - loadConfig is the single env entry point; every other layer receives an
 *   already-validated BotConfig. Validation must fail loudly (ConfigError)
 *   on missing RPC / private key / SuperToken, never silently default them.
 * - parseFromBlock tolerates whitespace and a trailing BigInt `n`, defaults
 *   empty/unset to 0n, and rejects garbage with a clear message.
 * - readDeploymentAddress prefers `proxy`, falls back to `address`, and
 *   errors on a missing file or a file with neither field.
 * - Numeric/boolean env (POLL_INTERVAL_MS, RUN_ONCE) and Uniswap overrides
 *   are parsed with the documented defaults.
 *
 * Deployment files are written to a throwaway network dir under
 * contracts/deployments so no builtins need stubbing.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect } from 'chai'

import { ConfigError, loadConfig, networkProfile } from '../../src/settings/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// test/settings → test → bot → repo root (same depth as src/settings)
const DEPLOYMENTS = path.resolve(__dirname, '../../..', 'contracts/deployments')

const NET_OK = 'bot-spec-ok'
const NET_BAD = 'bot-spec-bad'
const NET_MISSING = 'bot-spec-missing'

const PROXY = '0x1111111111111111111111111111111111111111'
const CONFIG_ADDR = '0x2222222222222222222222222222222222222222'
const SUPER_TOKEN = '0x3333333333333333333333333333333333333333'
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

function writeDeployment(network: string, name: string, json: unknown) {
  const dir = path.join(DEPLOYMENTS, network, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(json))
}

describe('settings/config', function () {
  let savedEnv: NodeJS.ProcessEnv

  before(function () {
    // NET_OK: StreamVaults exposes `proxy`, StreamVaultsConfig only `address`
    // (exercises both branches of readDeploymentAddress).
    writeDeployment(NET_OK, 'StreamVaults', { proxy: PROXY, address: '0xdead' })
    writeDeployment(NET_OK, 'StreamVaultsConfig', { address: CONFIG_ADDR })
    // NET_BAD: file present but neither proxy nor address.
    writeDeployment(NET_BAD, 'StreamVaults', {})
  })

  after(function () {
    for (const net of [NET_OK, NET_BAD]) {
      fs.rmSync(path.join(DEPLOYMENTS, net), { recursive: true, force: true })
    }
  })

  beforeEach(function () {
    savedEnv = { ...process.env }
    process.env.NETWORK_NAME = NET_OK
    process.env.RPC_HTTPS_BASE_SEPOLIA = 'https://rpc.test'
    process.env.WALLET_BOT_PRIVATE_KEY = KEY
    process.env.SUPER_TOKEN_USDCX = SUPER_TOKEN
    delete process.env.POLL_INTERVAL_MS
    delete process.env.RUN_ONCE
    delete process.env.DISCOVERY_FROM_BLOCK
    delete process.env.UNISWAP_API_BASE
    delete process.env.UNISWAP_API_KEY
    delete process.env.TOKEN_IN_USDC
    delete process.env.SUPER_TOKEN_DECIMALS
    delete process.env.UNDERLYING_DECIMALS
    delete process.env.RPC_HTTPS_LOGS
  })

  afterEach(function () {
    process.env = savedEnv
  })

  describe('loadConfig — happy path & defaults', function () {
    it('Should build a fully-populated BotConfig from valid env', function () {
      const cfg = loadConfig()

      expect(cfg.chain.id).to.equal(84532) // baseSepolia
      expect(cfg.rpcUrl).to.equal('https://rpc.test')
      expect(cfg.logsRpcUrl).to.equal('https://rpc.test') // defaults to rpcUrl
      expect(cfg.botPrivateKey).to.equal(KEY)
      expect(cfg.pollIntervalMs).to.equal(30_000)
      expect(cfg.runOnce).to.equal(false)
      expect(cfg.discoveryFromBlock).to.equal(0n)
      expect(cfg.uniswap.apiBase).to.equal(
        'https://trading-api-labs.interface.gateway.uniswap.org',
      )
      expect(cfg.uniswap.apiKey).to.equal('')
      expect(cfg.addresses.streamVaults).to.equal(PROXY)
      expect(cfg.addresses.streamVaultsConfig).to.equal(CONFIG_ADDR)
      expect(cfg.strategy.superTokenIn).to.equal(SUPER_TOKEN)
      expect(cfg.strategy.tokenIn).to.equal('0x036CbD53842c5426634e7929541eC2318f3dCF7e')
      expect(cfg.strategy.superToUnderlyingDivisor).to.equal(10n ** 12n)
    })

    it('Should use RPC_HTTPS_LOGS for logsRpcUrl when set (discovery split)', function () {
      process.env.RPC_HTTPS_LOGS = 'https://logs.test'
      const cfg = loadConfig()
      expect(cfg.logsRpcUrl).to.equal('https://logs.test')
      expect(cfg.rpcUrl).to.equal('https://rpc.test') // main RPC unchanged
    })

    it('Should default NETWORK_NAME-less lookups to baseSepolia (no override leaks)', function () {
      // NET_OK is set; clearing NETWORK_NAME would point at baseSepolia which
      // has no deployment here — assert the override is actually honored.
      expect(loadConfig().addresses.streamVaults).to.equal(PROXY)
    })
  })

  describe('required env validation', function () {
    it('Should throw ConfigError when RPC_HTTPS_BASE_SEPOLIA is missing', function () {
      delete process.env.RPC_HTTPS_BASE_SEPOLIA
      expect(() => loadConfig())
        .to.throw(ConfigError)
        .with.property('message')
        .that.includes('RPC_HTTPS_BASE_SEPOLIA')
    })

    it('Should treat an empty-string env var as missing', function () {
      process.env.RPC_HTTPS_BASE_SEPOLIA = ''
      expect(() => loadConfig()).to.throw(ConfigError, /RPC_HTTPS_BASE_SEPOLIA/)
    })

    it('Should throw ConfigError when WALLET_BOT_PRIVATE_KEY is missing', function () {
      delete process.env.WALLET_BOT_PRIVATE_KEY
      expect(() => loadConfig()).to.throw(ConfigError, /WALLET_BOT_PRIVATE_KEY/)
    })

    it('Should throw ConfigError when SUPER_TOKEN_USDCX is missing', function () {
      delete process.env.SUPER_TOKEN_USDCX
      expect(() => loadConfig()).to.throw(ConfigError, /SUPER_TOKEN_USDCX/)
    })

    it('Should throw ConfigError when WALLET_BOT_PRIVATE_KEY is not a 32-byte hex key (H-03)', function () {
      process.env.WALLET_BOT_PRIVATE_KEY = '0xDEAD'
      expect(() => loadConfig()).to.throw(
        ConfigError,
        /32-byte hex private key/,
      )
    })

    it('Should not echo the private key value in the error message', function () {
      process.env.WALLET_BOT_PRIVATE_KEY = '0xnot-a-valid-key-but-secretish'
      let message = ''
      try {
        loadConfig()
      } catch (err) {
        message = (err as Error).message
      }
      expect(message).to.match(/32-byte hex private key/)
      expect(message).to.not.contain('secretish')
    })
  })

  describe('parseFromBlock', function () {
    it('Should parse a plain integer block number', function () {
      process.env.DISCOVERY_FROM_BLOCK = '12345'
      expect(loadConfig().discoveryFromBlock).to.equal(12345n)
    })

    it('Should tolerate a trailing BigInt "n" suffix', function () {
      process.env.DISCOVERY_FROM_BLOCK = '6789n'
      expect(loadConfig().discoveryFromBlock).to.equal(6789n)
    })

    it('Should trim surrounding whitespace', function () {
      process.env.DISCOVERY_FROM_BLOCK = '  4200  '
      expect(loadConfig().discoveryFromBlock).to.equal(4200n)
    })

    it('Should default an empty string to 0n', function () {
      process.env.DISCOVERY_FROM_BLOCK = ''
      expect(loadConfig().discoveryFromBlock).to.equal(0n)
    })

    it('Should throw ConfigError on a non-integer block value', function () {
      process.env.DISCOVERY_FROM_BLOCK = 'not-a-block'
      expect(() => loadConfig()).to.throw(ConfigError, /must be an integer block number/)
    })
  })

  describe('numeric & boolean env', function () {
    it('Should parse POLL_INTERVAL_MS from env', function () {
      process.env.POLL_INTERVAL_MS = '5000'
      expect(loadConfig().pollIntervalMs).to.equal(5000)
    })

    it('Should set runOnce=true for RUN_ONCE=1', function () {
      process.env.RUN_ONCE = '1'
      expect(loadConfig().runOnce).to.equal(true)
    })

    it('Should set runOnce=true for RUN_ONCE=true', function () {
      process.env.RUN_ONCE = 'true'
      expect(loadConfig().runOnce).to.equal(true)
    })

    it('Should set runOnce=false for any other RUN_ONCE value', function () {
      process.env.RUN_ONCE = 'no'
      expect(loadConfig().runOnce).to.equal(false)
    })
  })

  describe('uniswap & token overrides', function () {
    it('Should strip a trailing slash from a custom UNISWAP_API_BASE', function () {
      process.env.UNISWAP_API_BASE = 'https://custom.example.com/'
      expect(loadConfig().uniswap.apiBase).to.equal('https://custom.example.com')
    })

    it('Should read UNISWAP_API_KEY from env', function () {
      process.env.UNISWAP_API_KEY = 'secret-123'
      expect(loadConfig().uniswap.apiKey).to.equal('secret-123')
    })

    it('Should honor a TOKEN_IN_USDC override', function () {
      process.env.TOKEN_IN_USDC = '0x9999999999999999999999999999999999999999'
      expect(loadConfig().strategy.tokenIn).to.equal(
        '0x9999999999999999999999999999999999999999',
      )
    })
  })

  describe('token decimals → superToUnderlyingDivisor (H-06)', function () {
    it('Should default to 10^12 (USDCx 18dec → USDC 6dec) when decimals are unset', function () {
      expect(loadConfig().strategy.superToUnderlyingDivisor).to.equal(10n ** 12n)
    })

    it('Should compute the divisor from SUPER_TOKEN_DECIMALS/UNDERLYING_DECIMALS overrides', function () {
      process.env.SUPER_TOKEN_DECIMALS = '18'
      process.env.UNDERLYING_DECIMALS = '8'
      expect(loadConfig().strategy.superToUnderlyingDivisor).to.equal(10n ** 10n)
    })

    it('Should yield a divisor of 1 for an 18→18 SuperToken', function () {
      process.env.SUPER_TOKEN_DECIMALS = '18'
      process.env.UNDERLYING_DECIMALS = '18'
      expect(loadConfig().strategy.superToUnderlyingDivisor).to.equal(1n)
    })

    it('Should treat an empty-string decimals value as unset (default)', function () {
      process.env.SUPER_TOKEN_DECIMALS = ''
      expect(loadConfig().strategy.superToUnderlyingDivisor).to.equal(10n ** 12n)
    })

    it('Should throw ConfigError on a non-integer decimals value', function () {
      process.env.SUPER_TOKEN_DECIMALS = 'abc'
      expect(() => loadConfig()).to.throw(ConfigError, /between 0 and 36/)
    })

    it('Should throw ConfigError on a negative decimals value', function () {
      process.env.UNDERLYING_DECIMALS = '-1'
      expect(() => loadConfig()).to.throw(ConfigError, /between 0 and 36/)
    })

    it('Should throw ConfigError on a decimals value above 36', function () {
      process.env.SUPER_TOKEN_DECIMALS = '40'
      expect(() => loadConfig()).to.throw(ConfigError, /between 0 and 36/)
    })

    it('Should throw ConfigError when super decimals < underlying decimals', function () {
      process.env.SUPER_TOKEN_DECIMALS = '6'
      process.env.UNDERLYING_DECIMALS = '18'
      expect(() => loadConfig()).to.throw(ConfigError, /must be >= UNDERLYING_DECIMALS/)
    })
  })

  describe('readDeploymentAddress', function () {
    it('Should throw ConfigError when the deployment file does not exist', function () {
      process.env.NETWORK_NAME = NET_MISSING
      expect(() => loadConfig()).to.throw(ConfigError, /Deployment file not found/)
    })

    it('Should throw ConfigError when the file has neither proxy nor address', function () {
      process.env.NETWORK_NAME = NET_BAD
      expect(() => loadConfig()).to.throw(ConfigError, /no proxy\/address field/)
    })

    it('Should fall back to "baseSepolia" when NETWORK_NAME is not set', function () {
      // Covers the `?? 'baseSepolia'` branch in deploymentsDir():
      //   const networkName = process.env.NETWORK_NAME ?? 'baseSepolia'
      // When NETWORK_NAME is unset, the fallback 'baseSepolia' is used and the
      // ConfigError references a baseSepolia deployment path (which does not exist
      // in the test environment — that is the expected outcome here).
      delete process.env.NETWORK_NAME
      expect(() => loadConfig()).to.throw(ConfigError, /baseSepolia/)
    })
  })

  describe('networkProfile', function () {
    it('Should map baseSepolia to chain 84532 + its RPC env var', function () {
      const p = networkProfile('baseSepolia')
      expect(p.chain.id).to.equal(84532)
      expect(p.rpcEnvVar).to.equal('RPC_HTTPS_BASE_SEPOLIA')
      expect(p.defaultUsdc).to.equal('0x036CbD53842c5426634e7929541eC2318f3dCF7e')
    })

    it('Should map baseMainnet to chain 8453 + its RPC env var + native USDC', function () {
      const p = networkProfile('baseMainnet')
      expect(p.chain.id).to.equal(8453)
      expect(p.rpcEnvVar).to.equal('RPC_HTTPS_BASE_MAINNET')
      expect(p.defaultUsdc).to.equal('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    })

    it('Should fall back to the baseSepolia profile for an unknown network name', function () {
      expect(networkProfile('bot-spec-ok').chain.id).to.equal(84532)
    })
  })

  describe('ConfigError', function () {
    it('Should be an Error subclass named ConfigError', function () {
      const err = new ConfigError('boom')
      expect(err).to.be.instanceOf(Error)
      expect(err.name).to.equal('ConfigError')
      expect(err.message).to.equal('boom')
    })
  })
})
