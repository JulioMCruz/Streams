import fs from 'node:fs'

import { ethers, deployments } from 'hardhat'

/**
 * E2E scenario setup (run AFTER `hardhat deploy --network localhost --tags test`).
 *
 * Simulates the steady-state the bot operates on:
 *   - Bob owns a SmartAccountDCA (operator = StreamVaults).
 *   - The SA already holds streamed USDCx (as if Superfluid had flowed it).
 *   - The MockSuperToken is funded with USDC so `downgrade` can pay out.
 *   - The MockUniswapRouter is funded with WETH and configured to swap
 *     USDC -> WETH.
 *
 * Writes the resolved addresses to /tmp/streamvaults-e2e.json for the bot
 * tick script to consume.
 */
const OUT_FILE = '/tmp/streamvaults-e2e.json'

// Amounts
const USDCX_TO_SA = 200n * 10n ** 18n // 200 USDCx (18 dec) streamed into the SA
const USDC_FUND_SUPERTOKEN = 1_000n * 10n ** 6n // backing for downgrade payouts
const WETH_OUT = 5n * 10n ** 16n // 0.05 WETH delivered by the mock router
const MIN_TRADE = 1n * 10n ** 6n // 1 USDC
const MAX_SLIPPAGE_BPS = 100 // 1%

async function addr(name: string): Promise<string> {
	const d = await deployments.get(name)
	return d.address
}

// hardhat default account #2 — used as Bob (a distinct user EOA). The
// localhost network only configures 2 named accounts (deployer, bot), so
// we build Bob from a known key; the node already funds it with ETH.
const BOB_PK = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'

async function main() {
	const signers = await ethers.getSigners()
	const deployer = signers[0]
	const bob = new ethers.Wallet(BOB_PK, ethers.provider)

	const svAddr = await addr('StreamVaults')
	const usdcAddr = await addr('MockERC20Permit')
	const wethAddr = await addr('MockMintableERC20')
	const superTokenAddr = await addr('MockSuperToken')
	const routerAddr = await addr('MockUniswapRouter')

	const sv = await ethers.getContractAt('StreamVaults', svAddr)
	const usdc = await ethers.getContractAt('MockERC20Permit', usdcAddr)
	const weth = await ethers.getContractAt('MockMintableERC20', wethAddr)
	const superToken = await ethers.getContractAt('MockSuperToken', superTokenAddr)
	const router = await ethers.getContractAt('MockUniswapRouter', routerAddr)

	console.log('[setup] StreamVaults     :', svAddr)
	console.log('[setup] USDC (underlying):', usdcAddr)
	console.log('[setup] WETH (tokenOut)  :', wethAddr)
	console.log('[setup] USDCx (super)    :', superTokenAddr)
	console.log('[setup] MockRouter       :', routerAddr)
	console.log('[setup] Bob              :', bob.address)

	// 1. Fund the SuperToken with USDC so downgrade() can pay the SA.
	await (await usdc.connect(deployer).mint(superTokenAddr, USDC_FUND_SUPERTOKEN)).wait()

	// 2. Bob creates his SmartAccount (operator = StreamVaults).
	const createRc = await (await sv.connect(bob).createSmartAccount()).wait()
	let saAddr: string | undefined
	for (const log of createRc!.logs) {
		try {
			const parsed = sv.interface.parseLog(log)
			if (parsed?.name === 'SmartAccountCreated') {
				saAddr = parsed.args.smartAccount as string
				break
			}
		} catch {
			// not a StreamVaults event — ignore
		}
	}
	if (!saAddr) throw new Error('SmartAccountCreated event not found')
	console.log('[setup] SmartAccount(Bob):', saAddr)

	// 3. Bob sets his trading rules: WETH as the only target, settle to Bob.
	const sa = await ethers.getContractAt('SmartAccountDCA', saAddr)
	await (
		await sa.connect(bob).setRules({
			maxSlippageBps: MAX_SLIPPAGE_BPS,
			minTradeAmount: MIN_TRADE,
			settlementAddress: bob.address,
			targetTokens: [wethAddr],
		})
	).wait()

	// 4. Simulate streamed funds: mint USDCx straight into the SA.
	await (await superToken.connect(deployer).mint(saAddr, USDCX_TO_SA)).wait()

	// 5. Fund + configure the mock router to swap USDC -> WETH.
	await (await weth.connect(deployer).mint(routerAddr, WETH_OUT)).wait()
	await (
		await router.connect(deployer).configure(usdcAddr, wethAddr, WETH_OUT, false)
	).wait()

	const out = {
		chainId: Number((await ethers.provider.getNetwork()).chainId),
		streamVaults: svAddr,
		usdc: usdcAddr,
		weth: wethAddr,
		superToken: superTokenAddr,
		router: routerAddr,
		bob: bob.address,
		smartAccount: saAddr,
		expected: {
			wethOut: WETH_OUT.toString(),
			usdcxIn: USDCX_TO_SA.toString(),
		},
	}
	fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2))
	console.log(`[setup] wrote ${OUT_FILE}`)
	console.log('[setup] done — SA funded with 200 USDCx, router ready (0.05 WETH out)')
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
