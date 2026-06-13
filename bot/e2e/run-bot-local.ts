import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
	type Address,
	createPublicClient,
	createWalletClient,
	defineChain,
	http
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
import { getLogger } from '../src/utils/logger'

/**
 * Local poll-loop runner for the bot. The production `entry-point/main`
 * targets Base Sepolia and the live Uniswap Trading API, which has no
 * localhost coverage — so this variant runs the SAME use case + viem
 * adapters against the local Hardhat node, faking only the quote seam
 * (routes every swap to the pre-funded MockUniswapRouter).
 *
 * NOTE: the local MockCFAv1Forwarder is a stub — it records flowrates but
 * does NOT move USDCx over time. So smart accounts created through the UI
 * won't accrue a streamed balance on their own; the bot will simply find
 * nothing to trade until an account holds USDCx (e.g. via `yarn e2e`, which
 * mints USDCx straight into a smart account).
 */
const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5_000)
// Hardhat account #1 — the `bot` named account whitelisted in the test config.
const BOT_KEY =
	process.env.WALLET_BOT_PRIVATE_KEY ??
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEPLOYMENTS = path.resolve(
	__dirname,
	'../../contracts/deployments/localhost'
)

function deployedAddress(name: string): Address {
	const file = path.join(DEPLOYMENTS, `${name}.json`)
	const json = JSON.parse(fs.readFileSync(file, 'utf-8'))
	return (json.proxy ?? json.address) as Address
}

/** Fake QuoteProviderPort — routes every quote to the MockUniswapRouter. */
class FakeRouterQuoteProvider implements QuoteProviderPort {
	constructor(
		private readonly router: Address,
		private readonly minAmountOut: bigint
	) {}
	async fetchQuote(_req: QuoteRequest): Promise<QuoteResult | null> {
		// Empty calldata hits the mock router fallback() → pull tokenIn, push tokenOut.
		return { to: this.router, data: '0x', value: 0n, minAmountOut: this.minAmountOut }
	}
}

async function main() {
	const logger = getLogger('bot-local')

	const streamVaults = deployedAddress('StreamVaults')
	const superToken = deployedAddress('MockSuperToken') // USDCx
	const usdc = deployedAddress('MockERC20Permit') // underlying
	const router = deployedAddress('MockUniswapRouter')

	const chain = defineChain({
		id: 31337,
		name: 'hardhat-local',
		nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
		rpcUrls: { default: { http: [RPC_URL] } }
	})
	const account = privateKeyToAccount(BOT_KEY as `0x${string}`)
	const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })
	const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) })

	// The mock router pays out a fixed, pre-funded `amountOut`; use it as the
	// slippage floor so the SmartAccountDCA check passes.
	const routerAmountOut = (await publicClient.readContract({
		address: router,
		abi: [
			{
				type: 'function',
				name: 'amountOut',
				stateMutability: 'view',
				inputs: [],
				outputs: [{ name: '', type: 'uint256' }]
			}
		] as const,
		functionName: 'amountOut'
	})) as bigint

	const useCase = new RunDcaTickUseCase({
		registry: new ViemSmartAccountRegistryAdapter({
			publicClient,
			streamVaults,
			fromBlock: 0n
		}),
		chain: new ViemChainStateAdapter(publicClient),
		gateway: new ViemSwapGatewayAdapter({ publicClient, streamVaults }),
		quotes: new FakeRouterQuoteProvider(router, routerAmountOut > 0n ? routerAmountOut : 1n),
		executor: new ViemSwapExecutorAdapter({
			publicClient,
			walletClient,
			account,
			streamVaults
		}),
		guard: new ViemStreamGuardAdapter({
			publicClient,
			walletClient,
			account,
			streamVaults
		}),
		strategy: {
			superTokenIn: superToken,
			tokenIn: usdc,
			superToUnderlyingDivisor: 10n ** 12n
		},
		logger
	})

	logger.info(
		{ streamVaults, superToken, usdc, router, bot: account.address, pollMs: POLL_INTERVAL_MS },
		'bot_local_started'
	)

	for (;;) {
		try {
			await useCase.tick()
		} catch (err) {
			logger.error(
				{ err: err instanceof Error ? err.message : String(err) },
				'tick_failed'
			)
		}
		await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
	}
}

main().catch(err => {
	console.error('[bot-local] fatal', err)
	process.exit(1)
})
