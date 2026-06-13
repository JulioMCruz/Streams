import fs from 'node:fs'

import {
	type Address,
	createPublicClient,
	createWalletClient,
	defineChain,
	http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { ViemChainStateAdapter } from '../src/adapters/viem-chain-state'
import { ViemSmartAccountRegistryAdapter } from '../src/adapters/viem-smart-account-registry'
import { ViemStreamGuardAdapter } from '../src/adapters/viem-stream-guard'
import { ViemSwapExecutorAdapter } from '../src/adapters/viem-swap-executor'
import { ViemSwapGatewayAdapter } from '../src/adapters/viem-swap-gateway'
import type { QuoteRequest, QuoteResult } from '../src/domain/models/quote'
import type { QuoteProviderPort } from '../src/ports/quote-provider-port'
import { RunDcaTickUseCase } from '../src/use-cases/run-dca-tick'
import { erc20Abi } from '../src/utils/abis'
import { getLogger } from '../src/utils/logger'

/**
 * End-to-end test: user → bot → smart contract on the local chain.
 *
 * Exercises the REAL bot pipeline (`RunDcaTickUseCase` + the viem
 * adapters). The only seam swapped for the test is the QuoteProviderPort:
 * the Uniswap Trading API has no localhost coverage, so a fake provider
 * returns calldata for the MockUniswapRouter instead. Everything else —
 * discovery, state reads, cooldown, simulate + executeSwap — is the
 * production code path.
 */
const ADDR_FILE = '/tmp/streamvaults-e2e.json'
const RPC_URL = 'http://127.0.0.1:8545'
// hardhat account #1 — matches the `bot` named account whitelisted in config.
const BOT_KEY =
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

type E2EAddresses = {
	chainId: number
	streamVaults: Address
	usdc: Address
	weth: Address
	superToken: Address
	router: Address
	bob: Address
	smartAccount: Address
	expected: { wethOut: string; usdcxIn: string }
}

/** Fake QuoteProviderPort — routes every quote to the MockUniswapRouter. */
class FakeRouterQuoteProvider implements QuoteProviderPort {
	constructor(
		private readonly router: Address,
		private readonly minAmountOut: bigint,
	) {}
	async fetchQuote(_req: QuoteRequest): Promise<QuoteResult | null> {
		// Empty calldata hits the mock router's fallback() → pulls tokenIn,
		// pushes the pre-funded tokenOut.
		return { to: this.router, data: '0x', value: 0n, minAmountOut: this.minAmountOut }
	}
}

async function main() {
	const logger = getLogger('e2e')
	const cfg = JSON.parse(fs.readFileSync(ADDR_FILE, 'utf-8')) as E2EAddresses

	const localChain = defineChain({
		id: cfg.chainId,
		name: 'local',
		nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
		rpcUrls: { default: { http: [RPC_URL] } },
	})

	const account = privateKeyToAccount(BOT_KEY)
	const publicClient = createPublicClient({ chain: localChain, transport: http(RPC_URL) })
	const walletClient = createWalletClient({ account, chain: localChain, transport: http(RPC_URL) })

	const wethOut = BigInt(cfg.expected.wethOut)

	const balanceOf = (token: Address, holder: Address) =>
		publicClient.readContract({
			address: token,
			abi: erc20Abi,
			functionName: 'balanceOf',
			args: [holder],
		}) as Promise<bigint>

	const bobWethBefore = await balanceOf(cfg.weth, cfg.bob)
	const saUsdcxBefore = await balanceOf(cfg.superToken, cfg.smartAccount)
	logger.info({ bobWethBefore, saUsdcxBefore }, 'before_tick')

	const useCase = new RunDcaTickUseCase({
		registry: new ViemSmartAccountRegistryAdapter({
			publicClient,
			streamVaults: cfg.streamVaults,
			fromBlock: 0n,
		}),
		chain: new ViemChainStateAdapter(publicClient),
		gateway: new ViemSwapGatewayAdapter({ publicClient, streamVaults: cfg.streamVaults }),
		quotes: new FakeRouterQuoteProvider(cfg.router, wethOut),
		executor: new ViemSwapExecutorAdapter({
			publicClient,
			walletClient,
			account,
			streamVaults: cfg.streamVaults,
		}),
		guard: new ViemStreamGuardAdapter({
			publicClient,
			walletClient,
			account,
			streamVaults: cfg.streamVaults,
		}),
		strategy: {
			superTokenIn: cfg.superToken,
			tokenIn: cfg.usdc,
			superToUnderlyingDivisor: 10n ** 12n,
		},
		logger,
	})

	await useCase.tick()

	const bobWethAfter = await balanceOf(cfg.weth, cfg.bob)
	const saUsdcxAfter = await balanceOf(cfg.superToken, cfg.smartAccount)
	logger.info({ bobWethAfter, saUsdcxAfter }, 'after_tick')

	const wethDelta = bobWethAfter - bobWethBefore
	const checks = [
		['Bob received exactly the expected WETH', wethDelta === wethOut],
		['SmartAccount USDCx drained to zero (settled, not accumulated)', saUsdcxAfter === 0n],
	] as const

	let ok = true
	for (const [label, pass] of checks) {
		console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — ${label}`)
		if (!pass) ok = false
	}
	console.log(
		`\nBob WETH: ${bobWethBefore} → ${bobWethAfter} (Δ ${wethDelta}); ` +
			`SA USDCx: ${saUsdcxBefore} → ${saUsdcxAfter}`,
	)
	if (!ok) process.exit(1)
	console.log('\n🎉 E2E PASSED: user → bot → contract (downgrade → swap → settle to Bob)')
}

main().catch(err => {
	console.error('[e2e] fatal', err)
	process.exit(1)
})
