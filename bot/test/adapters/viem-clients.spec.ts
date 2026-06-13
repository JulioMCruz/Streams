/**
 * Tests for adapters/viem-clients.ts — createClients.
 *
 * Audit findings:
 * - Pure factory: derives the account from the private key and builds a
 *   public + wallet client over the configured chain/RPC. viem clients are
 *   lazy (no connection on construction), so this runs offline.
 * - botAddress must equal the derived account address.
 * - The wallet client must carry the same account; both clients target the
 *   configured chain.
 */

import { expect } from 'chai'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import { createClients } from '../../src/adapters/viem-clients.js'
import type { BotConfig } from '../../src/settings/config.js'

// Well-known Anvil test key #1 — never used with real funds.
const TEST_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const

function makeConfig(): BotConfig {
  return {
    chain: baseSepolia,
    rpcUrl: 'https://sepolia.base.org',
    botPrivateKey: TEST_KEY,
    pollIntervalMs: 30_000,
    runOnce: false,
    discoveryFromBlock: 0n,
    uniswap: { apiBase: 'https://api.uniswap.org', apiKey: '' },
    addresses: {
      streamVaults: '0x0000000000000000000000000000000000000001',
      streamVaultsConfig: '0x0000000000000000000000000000000000000002',
    },
    strategy: {
      superTokenIn: '0x0000000000000000000000000000000000000003',
      tokenIn: '0x0000000000000000000000000000000000000004',
      superToUnderlyingDivisor: 10n ** 12n,
    },
  }
}

describe('createClients', function () {
  it('Should derive the bot account from the private key', function () {
    const clients = createClients(makeConfig())
    const expected = privateKeyToAccount(TEST_KEY)

    expect(clients.account.address).to.equal(expected.address)
    expect(clients.botAddress).to.equal(expected.address)
  })

  it('Should build a public client targeting the configured chain', function () {
    const clients = createClients(makeConfig())
    expect(clients.publicClient).to.be.an('object')
    expect(clients.publicClient.chain!.id).to.equal(baseSepolia.id)
  })

  it('Should build a wallet client carrying the same account and chain', function () {
    const clients = createClients(makeConfig())
    expect(clients.walletClient).to.be.an('object')
    expect(clients.walletClient.account!.address).to.equal(clients.botAddress)
    expect(clients.walletClient.chain!.id).to.equal(baseSepolia.id)
  })
})
