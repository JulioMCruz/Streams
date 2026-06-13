/**
 * StreamVaultsOnReport.test.ts
 *
 * Comprehensive test suite for the Chainlink CRE / Keystone `onReport` entrypoint
 * added to StreamVaults, and the accompanying `supportsInterface` implementation.
 *
 * Coverage goals:
 *   - Happy paths: onReport→executeSwap and onReport→closeStreamIfLow produce
 *     identical state changes and events as the direct bot-only externals.
 *   - Auth: every non-bot caller is rejected; rotating bot revokes old forwarder.
 *   - Malformed reports: short bytes, unknown selector, truncated/garbage args.
 *   - All protocol guards still fire through the report path (whitelists, cooldown,
 *     same-token, unknown SA, STREAM_NOT_ACTIVE, STREAM_NOT_LOW).
 *   - supportsInterface: IReceiver, IERC165, and rejection of unknown ids.
 *   - Security framing: onReport is not a backdoor — every guard the direct externals
 *     enforce is also enforced here.
 */

import { expect } from 'chai'
import hre, { viem } from 'hardhat'
import {
	Address,
	decodeEventLog,
	encodeFunctionData,
	parseUnits,
	zeroAddress
} from 'viem'

import StreamVaultsArtifact from '../artifacts/contracts/core/StreamVaults/StreamVaults.sol/StreamVaults.json'
import {
	deployTestFixture,
	FLOW_RATE,
	StreamVaultsContract,
	TestFixture
} from './helpers/fixtures'

// ============================================================================
// Local ABI fragments used only in this file
// ============================================================================

/**
 * Minimal ABI used by encodeFunctionData to build report payloads.
 * These mirror the real StreamVaults function signatures — if they diverge
 * the abi.decode inside onReport will revert (covered by the truncated-args tests).
 */
const STREAM_VAULTS_REPORT_ABI = [
	{
		name: 'executeSwap',
		type: 'function' as const,
		inputs: [
			{ name: 'smartAccount', type: 'address' },
			{
				name: 'params',
				type: 'tuple',
				components: [
					{ name: 'superTokenIn', type: 'address' },
					{ name: 'superAmountIn', type: 'uint256' },
					{ name: 'tokenIn', type: 'address' },
					{ name: 'tokenOut', type: 'address' },
					{ name: 'target', type: 'address' },
					{ name: 'value', type: 'uint256' },
					{ name: 'data', type: 'bytes' },
					{ name: 'minAmountOut', type: 'uint256' }
				]
			}
		],
		outputs: [{ name: 'amountOut', type: 'uint256' }]
	},
	{
		name: 'closeStreamIfLow',
		type: 'function' as const,
		inputs: [
			{ name: 'smartAccount', type: 'address' },
			{ name: 'superToken', type: 'address' }
		],
		outputs: [{ name: 'closed', type: 'bool' }]
	}
] as const

// Selectors (pre-computed; verified in the tests themselves)
const EXECUTE_SWAP_SELECTOR = '0xbfa7c106' as `0x${string}`
const CLOSE_STREAM_SELECTOR = '0xd309f77c' as `0x${string}`
const IRECEIVER_INTERFACE_ID = '0x805f2132' as `0x${string}`
const IERC165_INTERFACE_ID = '0x01ffc9a7' as `0x${string}`

// ============================================================================
// Helpers
// ============================================================================

/** Builds the report bytes for an executeSwap call (selector + abi-encoded args). */
function buildSwapReport(
	smartAccount: Address,
	params: {
		superTokenIn: Address
		superAmountIn: bigint
		tokenIn: Address
		tokenOut: Address
		target: Address
		value: bigint
		data: `0x${string}`
		minAmountOut: bigint
	}
): `0x${string}` {
	return encodeFunctionData({
		abi: STREAM_VAULTS_REPORT_ABI,
		functionName: 'executeSwap',
		args: [smartAccount, params]
	})
}

/** Builds the report bytes for a closeStreamIfLow call. */
function buildCloseReport(
	smartAccount: Address,
	superToken: Address
): `0x${string}` {
	return encodeFunctionData({
		abi: STREAM_VAULTS_REPORT_ABI,
		functionName: 'closeStreamIfLow',
		args: [smartAccount, superToken]
	})
}

/** Returns all decoded event names for a given tx, filtering by contract address. */
async function getEventNames(
	contractAddress: Address,
	txHash: `0x${string}`
): Promise<string[]> {
	const publicClient = await hre.viem.getPublicClient()
	const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
	const logs = await publicClient.getLogs({
		address: contractAddress,
		fromBlock: receipt.blockNumber,
		toBlock: receipt.blockNumber
	})
	return logs
		.map(log => {
			try {
				const decoded = decodeEventLog({
					abi: StreamVaultsArtifact.abi,
					data: log.data,
					topics: log.topics
				})
				return (decoded as any).eventName as string
			} catch {
				return null
			}
		})
		.filter((n): n is string => n !== null)
}

/** Decodes the first matching event from a tx receipt. */
async function getEventArgs(
	contractAddress: Address,
	txHash: `0x${string}`,
	eventName: string
): Promise<Record<string, unknown> | null> {
	const publicClient = await hre.viem.getPublicClient()
	const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
	const logs = await publicClient.getLogs({
		address: contractAddress,
		fromBlock: receipt.blockNumber,
		toBlock: receipt.blockNumber
	})
	for (const log of logs) {
		try {
			const decoded = decodeEventLog({
				abi: StreamVaultsArtifact.abi,
				data: log.data,
				topics: log.topics
			})
			if ((decoded as any).eventName === eventName) {
				return (decoded as any).args as Record<string, unknown>
			}
		} catch {
			// skip
		}
	}
	return null
}

/**
 * Full SA setup: create account, set rules, fund SA with USDC, fund router with
 * WETH. Returns the SA address.
 */
async function setupFundedSA(ctx: {
	streamVaults: StreamVaultsContract
	mockUsdc: any
	mockWeth: any
	mockRouter: any
	deployer: Address
	alice: Address
}): Promise<Address> {
	await (ctx.streamVaults as any).write.createSmartAccount([], {
		account: ctx.alice
	})
	const saAddress: Address = await (
		ctx.streamVaults as any
	).read.smartAccountOf([ctx.alice])

	const sa = (await viem.getContractAt('SmartAccountDCA', saAddress)) as any
	await sa.write.setRules(
		[
			{
				maxSlippageBps: 100,
				minTradeAmount: parseUnits('1', 6),
				settlementAddress: ctx.alice,
				targetTokens: [ctx.mockWeth.address] as Address[]
			}
		],
		{ account: ctx.alice }
	)

	await ctx.mockUsdc.write.mint([saAddress, parseUnits('50', 6)], {
		account: ctx.deployer
	})
	await ctx.mockWeth.write.mint(
		[ctx.mockRouter.address, parseUnits('50', 18)],
		{
			account: ctx.deployer
		}
	)
	await ctx.mockRouter.write.configure(
		[ctx.mockUsdc.address, ctx.mockWeth.address, parseUnits('50', 18), false],
		{ account: ctx.deployer }
	)

	return saAddress
}

/** Opens a stream from alice → saAddress using the mock CFA. */
async function openAliceStream(
	sv: StreamVaultsContract,
	saAddress: Address,
	alice: Address,
	superToken: Address
): Promise<void> {
	await (sv as any).write.setStream([saAddress, superToken, FLOW_RATE], {
		account: alice
	})
}

// ============================================================================
// Main describe block
// ============================================================================

describe('StreamVaults — onReport / supportsInterface (CRE Feature)', function () {
	async function deployFixture(): Promise<TestFixture> {
		return deployTestFixture()
	}

	// ==========================================================================
	// MODULE: supportsInterface
	// ==========================================================================

	describe('supportsInterface', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should return true for IReceiver interfaceId (0x805f2132)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const result = await (sv as any).read.supportsInterface([
				IRECEIVER_INTERFACE_ID
			])
			expect(result).to.equal(true)
		})

		it('Should return true for IERC165 interfaceId (0x01ffc9a7)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const result = await (sv as any).read.supportsInterface([
				IERC165_INTERFACE_ID
			])
			expect(result).to.equal(true)
		})

		it('Should return false for 0xffffffff (canonical invalid id)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const result = await (sv as any).read.supportsInterface(['0xffffffff'])
			expect(result).to.equal(false)
		})

		it('Should return false for a random unknown interface id (0xdeadbeef)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const result = await (sv as any).read.supportsInterface(['0xdeadbeef'])
			expect(result).to.equal(false)
		})

		it('Should return false for all-zero interface id (0x00000000)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const result = await (sv as any).read.supportsInterface(['0x00000000'])
			expect(result).to.equal(false)
		})

		it('Should return false for executeSwap selector — not an ERC-165 id', async function () {
			// executeSwap is a plain function selector, not an interface id.
			// Confirms supportsInterface does not expose arbitrary entry points.
			const sv = this.streamVaults as StreamVaultsContract
			const result = await (sv as any).read.supportsInterface([
				EXECUTE_SWAP_SELECTOR
			])
			expect(result).to.equal(false)
		})
	})

	// ==========================================================================
	// MODULE: onReport — Auth / access control
	// ==========================================================================

	describe('onReport — auth', function () {
		let saAddress: Address

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
			saAddress = await setupFundedSA(this as any)
		})

		it('Should revert with NOT_BOT if caller is a random EOA', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.alice })
			).to.be.rejectedWith('NOT_BOT')
		})

		it('Should revert with NOT_BOT if caller is the protocol owner (deployer)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.deployer })
			).to.be.rejectedWith('NOT_BOT')
		})

		it('Should revert with NOT_BOT if caller is the smart account owner (alice)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildCloseReport(saAddress, this.mockSuperToken.address)

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.alice })
			).to.be.rejectedWith('NOT_BOT')
		})

		it('Should accept the configured bot address as the caller', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			const tx = await (sv as any).write.onReport(['0x', report], {
				account: this.bot
			})
			expect(tx).to.exist
		})

		it('Should reject the OLD bot after setBot rotates to a new address', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			// Rotate the bot to charlie
			await (this.streamVaultsConfig as any).write.setBot([this.charlie], {
				account: this.deployer
			})

			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			// Old bot is no longer valid
			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('NOT_BOT')
		})

		it('Should accept the NEW bot after setBot rotates to a new address', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			// Rotate the bot to charlie
			await (this.streamVaultsConfig as any).write.setBot([this.charlie], {
				account: this.deployer
			})

			// Re-fund router for charlie's swap (router was consumed by alice in setupFundedSA)
			await (this.mockWeth as any).write.mint(
				[this.mockRouter.address, parseUnits('50', 18)],
				{ account: this.deployer }
			)

			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			// New bot (charlie) must succeed
			const tx = await (sv as any).write.onReport(['0x', report], {
				account: this.charlie
			})
			expect(tx).to.exist
		})
	})

	// ==========================================================================
	// MODULE: onReport — Malformed report payloads
	// ==========================================================================

	describe('onReport — malformed report', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should revert with INVALID_REPORT if report is empty bytes (0x)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.onReport(['0x', '0x'], { account: this.bot })
			).to.be.rejectedWith('INVALID_REPORT')
		})

		it('Should revert with INVALID_REPORT if report is 1 byte (length < 4)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.onReport(['0x', '0xaa'], { account: this.bot })
			).to.be.rejectedWith('INVALID_REPORT')
		})

		it('Should revert with INVALID_REPORT if report is 2 bytes (length < 4)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.onReport(['0x', '0xaabb'], { account: this.bot })
			).to.be.rejectedWith('INVALID_REPORT')
		})

		it('Should revert with INVALID_REPORT if report is 3 bytes (length < 4)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.onReport(['0x', '0xaabbcc'], { account: this.bot })
			).to.be.rejectedWith('INVALID_REPORT')
		})

		it('Should revert with INVALID_REPORT if selector is unknown (exactly 4 bytes)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			// A 4-byte report with an unknown selector (0xdeadbeef is not executeSwap or closeStreamIfLow)
			await expect(
				(sv as any).write.onReport(['0x', '0xdeadbeef'], { account: this.bot })
			).to.be.rejectedWith('INVALID_REPORT')
		})

		it('Should revert with INVALID_REPORT if selector matches known-but-wrong function (0x00000000)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.onReport(['0x', '0x00000000'], { account: this.bot })
			).to.be.rejectedWith('INVALID_REPORT')
		})

		it('Should revert if selector is executeSwap but args are truncated (5 bytes total)', async function () {
			// Selector correct but body is garbage / too short for abi.decode
			const sv = this.streamVaults as StreamVaultsContract
			const truncated = `${EXECUTE_SWAP_SELECTOR}deadbe` as `0x${string}`
			await expect(
				(sv as any).write.onReport(['0x', truncated], { account: this.bot })
			).to.be.rejected
			// abi.decode will panic / revert with an ABI decode error — not INVALID_REPORT
		})

		it('Should revert if selector is closeStreamIfLow but args are truncated (6 bytes total)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const truncated = `${CLOSE_STREAM_SELECTOR}aabb` as `0x${string}`
			await expect(
				(sv as any).write.onReport(['0x', truncated], { account: this.bot })
			).to.be.rejected
		})

		it('Should revert if report is valid selector + zero bytes for args (decode mismatch)', async function () {
			// 4-byte correct selector + 31 zero bytes — abi.decode needs at least 64 bytes for (address, address)
			const sv = this.streamVaults as StreamVaultsContract
			const garbage =
				`${CLOSE_STREAM_SELECTOR}${'00'.repeat(31)}` as `0x${string}`
			await expect(
				(sv as any).write.onReport(['0x', garbage], { account: this.bot })
			).to.be.rejected
		})

		it('Should ignore metadata content — arbitrary metadata does not affect dispatch', async function () {
			// metadata is completely ignored by the implementation; arbitrary bytes should not cause revert
			const sv = this.streamVaults as StreamVaultsContract
			// We need a valid report + a funded SA for this to succeed
			await setupFundedSA(this as any)
			const saAddress: Address = await (sv as any).read.smartAccountOf([
				this.alice
			])

			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			// Random 32-byte metadata should be ignored
			const randomMetadata =
				'0xdeadbeefcafebabe0102030405060708090a0b0c0d0e0f101112131415161718' as `0x${string}`
			const tx = await (sv as any).write.onReport([randomMetadata, report], {
				account: this.bot
			})
			expect(tx).to.exist
		})
	})

	// ==========================================================================
	// MODULE: onReport→executeSwap — Happy path
	// ==========================================================================

	describe('onReport→executeSwap — happy path', function () {
		let saAddress: Address

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
			saAddress = await setupFundedSA(this as any)
		})

		it('Should dispatch the swap and emit SwapExecuted', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			const txHash = await (sv as any).write.onReport(['0x', report], {
				account: this.bot
			})

			const names = await getEventNames(sv.address as Address, txHash)
			expect(names).to.include('SwapExecuted')
		})

		it('Should emit ReportHandled with executeSwap selector', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			const txHash = await (sv as any).write.onReport(['0x', report], {
				account: this.bot
			})

			const args = await getEventArgs(
				sv.address as Address,
				txHash,
				'ReportHandled'
			)
			expect(args).to.not.equal(null)
			expect((args as any).selector.toLowerCase()).to.equal(
				EXECUTE_SWAP_SELECTOR.toLowerCase()
			)
		})

		it('Should emit both SwapExecuted and ReportHandled in the same transaction', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			const txHash = await (sv as any).write.onReport(['0x', report], {
				account: this.bot
			})

			const names = await getEventNames(sv.address as Address, txHash)
			expect(names).to.include('SwapExecuted')
			expect(names).to.include('ReportHandled')
		})

		it('Should produce identical state change as calling executeSwap directly (equivalence)', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			// === Path A: direct executeSwap ===
			// Alice needs a separate SA for the direct call test.
			// We use bob's SA for the direct call and alice's SA for the report call.
			await (sv as any).write.createSmartAccount([], { account: this.bob })
			const bobSA: Address = await (sv as any).read.smartAccountOf([this.bob])

			const bobSA_obj = (await viem.getContractAt(
				'SmartAccountDCA',
				bobSA
			)) as any
			await bobSA_obj.write.setRules(
				[
					{
						maxSlippageBps: 100,
						minTradeAmount: parseUnits('1', 6),
						settlementAddress: this.bob,
						targetTokens: [this.mockWeth.address] as Address[]
					}
				],
				{ account: this.bob }
			)
			await (this.mockUsdc as any).write.mint([bobSA, parseUnits('50', 6)], {
				account: this.deployer
			})
			// Fund router again for bob's swap
			await (this.mockWeth as any).write.mint(
				[this.mockRouter.address, parseUnits('50', 18)],
				{ account: this.deployer }
			)
			await (this.mockRouter as any).write.configure(
				[
					this.mockUsdc.address,
					this.mockWeth.address,
					parseUnits('50', 18),
					false
				],
				{ account: this.deployer }
			)

			// Record state before direct call
			const aliceWethBefore: bigint = await (
				this.mockWeth as any
			).read.balanceOf([this.alice])
			const bobWethBefore: bigint = await (this.mockWeth as any).read.balanceOf(
				[this.bob]
			)

			// Execute via report path (alice's SA)
			const swapParams = {
				superTokenIn: zeroAddress as Address,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address as Address,
				tokenOut: this.mockWeth.address as Address,
				target: this.mockRouter.address as Address,
				value: 0n,
				data: '0x' as `0x${string}`,
				minAmountOut: 1n
			}
			const report = buildSwapReport(saAddress, swapParams)
			await (sv as any).write.onReport(['0x', report], { account: this.bot })

			// Execute via direct path (bob's SA)
			await (sv as any).write.executeSwap([bobSA, swapParams], {
				account: this.bot
			})

			const aliceWethAfter: bigint = await (
				this.mockWeth as any
			).read.balanceOf([this.alice])
			const bobWethAfter: bigint = await (this.mockWeth as any).read.balanceOf([
				this.bob
			])

			// Both paths should produce the same WETH delta for their respective recipients
			const aliceDelta = aliceWethAfter - aliceWethBefore
			const bobDelta = bobWethAfter - bobWethBefore
			expect(aliceDelta).to.equal(bobDelta)
			// Use direct bigint comparison — chai's greaterThan does not handle bigints
			expect(aliceDelta > 0n).to.equal(true)
		})

		it('Should update lastSwapBlock after report-path swap', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const blockBefore: bigint = await (sv as any).read.lastSwapBlock([
				saAddress
			])

			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})
			await (sv as any).write.onReport(['0x', report], { account: this.bot })

			const blockAfter: bigint = await (sv as any).read.lastSwapBlock([
				saAddress
			])
			// Use direct bigint comparison — chai's greaterThan requires numbers
			expect(blockAfter > blockBefore).to.equal(true)
		})

		it('Should emit SwapExecuted with correct smartAccount, target, tokenIn, tokenOut', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			const txHash = await (sv as any).write.onReport(['0x', report], {
				account: this.bot
			})

			const args = await getEventArgs(
				sv.address as Address,
				txHash,
				'SwapExecuted'
			)
			expect(args).to.not.equal(null)
			expect((args as any).smartAccount?.toLowerCase()).to.equal(
				saAddress.toLowerCase()
			)
			expect((args as any).target?.toLowerCase()).to.equal(
				this.mockRouter.address.toLowerCase()
			)
			expect((args as any).tokenIn?.toLowerCase()).to.equal(
				this.mockUsdc.address.toLowerCase()
			)
			expect((args as any).tokenOut?.toLowerCase()).to.equal(
				this.mockWeth.address.toLowerCase()
			)
		})
	})

	// ==========================================================================
	// MODULE: onReport→closeStreamIfLow — Happy path
	// ==========================================================================

	describe('onReport→closeStreamIfLow — happy path', function () {
		let saAddress: Address

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)

			await (this.streamVaults as any).write.createSmartAccount([], {
				account: this.alice
			})
			saAddress = await (this.streamVaults as any).read.smartAccountOf([
				this.alice
			])

			// Set a low realtime balance so the close guard fires
			const deposit = parseUnits('100', 18)
			const availableBalance = 0n
			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)

			await openAliceStream(
				this.streamVaults,
				saAddress,
				this.alice,
				this.mockSuperToken.address
			)
		})

		it('Should close the stream and emit StreamAutoClosed', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildCloseReport(saAddress, this.mockSuperToken.address)

			const txHash = await (sv as any).write.onReport(['0x', report], {
				account: this.bot
			})

			const names = await getEventNames(sv.address as Address, txHash)
			expect(names).to.include('StreamAutoClosed')
		})

		it('Should emit ReportHandled with closeStreamIfLow selector', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildCloseReport(saAddress, this.mockSuperToken.address)

			const txHash = await (sv as any).write.onReport(['0x', report], {
				account: this.bot
			})

			const args = await getEventArgs(
				sv.address as Address,
				txHash,
				'ReportHandled'
			)
			expect(args).to.not.equal(null)
			expect((args as any).selector.toLowerCase()).to.equal(
				CLOSE_STREAM_SELECTOR.toLowerCase()
			)
		})

		it('Should emit StreamAutoClosed, StreamUpdated, and ReportHandled in the same transaction', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildCloseReport(saAddress, this.mockSuperToken.address)

			const txHash = await (sv as any).write.onReport(['0x', report], {
				account: this.bot
			})

			const names = await getEventNames(sv.address as Address, txHash)
			expect(names).to.include('StreamAutoClosed')
			expect(names).to.include('StreamUpdated')
			expect(names).to.include('ReportHandled')
		})

		it('Should set CFA flowrate to 0 after report-path close', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildCloseReport(saAddress, this.mockSuperToken.address)

			await (sv as any).write.onReport(['0x', report], { account: this.bot })

			const flowRate = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.alice,
				saAddress
			])
			expect(flowRate).to.equal(0n)
		})

		it('Should produce identical state change as calling closeStreamIfLow directly (equivalence)', async function () {
			// Compare: report path on alice's SA vs direct call on bob's SA (same conditions)
			const sv = this.streamVaults as StreamVaultsContract

			// Setup bob's SA with same conditions
			await (sv as any).write.createSmartAccount([], { account: this.bob })
			const bobSA: Address = await (sv as any).read.smartAccountOf([this.bob])

			const deposit = parseUnits('100', 18)
			const availableBalance = 0n
			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.bob, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(sv, bobSA, this.bob, this.mockSuperToken.address)

			// Close alice's SA via report path
			const reportAlice = buildCloseReport(
				saAddress,
				this.mockSuperToken.address
			)
			await (sv as any).write.onReport(['0x', reportAlice], {
				account: this.bot
			})

			// Close bob's SA via direct path
			await (sv as any).write.closeStreamIfLow(
				[bobSA, this.mockSuperToken.address],
				{ account: this.bot }
			)

			// Both streams must now be at 0
			const aliceRate = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.alice,
				saAddress
			])
			const bobRate = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.bob,
				bobSA
			])
			expect(aliceRate).to.equal(0n)
			expect(bobRate).to.equal(0n)
		})
	})

	// ==========================================================================
	// MODULE: onReport — Protocol guards via report path
	// ==========================================================================

	describe('onReport — protocol guards still enforced', function () {
		let saAddress: Address

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
			saAddress = await setupFundedSA(this as any)
		})

		// --- executeSwap guards ---

		it('Should revert with SMART_ACCOUNT_NOT_FOUND for unknown SA via report path', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const unknownSA = this.charlie // never had a smart account

			const report = buildSwapReport(unknownSA, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('SMART_ACCOUNT_NOT_FOUND')
		})

		it('Should revert with INVALID_TARGET for non-whitelisted target via report path', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.charlie, // not in the whitelist
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('INVALID_TARGET')
		})

		it('Should revert with INVALID_SWAP_TOKEN for unsupported tokenIn via report path', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.charlie, // not a supported swap token
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('INVALID_SWAP_TOKEN')
		})

		it('Should revert with INVALID_SWAP_TOKEN for unsupported tokenOut via report path', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.charlie, // not a supported swap token
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('INVALID_SWAP_TOKEN')
		})

		it('Should revert with INVALID_SWAP_TOKEN when tokenIn == tokenOut via report path (E-06)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockUsdc.address, // same token
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('INVALID_SWAP_TOKEN')
		})

		it('Should revert with SWAP_COOLDOWN_ACTIVE on second report-path swap within cooldown window (E-05)', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			// 1. Execute the first swap with the default cooldown (1 block).
			//    This records lastSwapBlock = N.
			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})
			await (sv as any).write.onReport(['0x', report], { account: this.bot })

			// 2. Immediately raise cooldown to 1000 blocks AFTER the first swap.
			//    Now the guard condition becomes: block.number <= N + 1000 - 1.
			//    The next tx will be at block N+2 at most, so it will be blocked.
			await (sv as any).write.setSwapCooldown([1000n], {
				account: this.deployer
			})

			// 3. Re-fund so the swap itself could proceed if cooldown didn't block.
			await (this.mockUsdc as any).write.mint(
				[saAddress, parseUnits('50', 6)],
				{ account: this.deployer }
			)
			await (this.mockWeth as any).write.mint(
				[this.mockRouter.address, parseUnits('50', 18)],
				{ account: this.deployer }
			)

			// 4. Second swap — block is N+4 at most, still within the 1000-block window.
			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('SWAP_COOLDOWN_ACTIVE')
		})

		// --- closeStreamIfLow guards ---

		it('Should revert with SMART_ACCOUNT_NOT_FOUND for unknown SA in close report', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildCloseReport(this.charlie, this.mockSuperToken.address)

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('SMART_ACCOUNT_NOT_FOUND')
		})

		it('Should revert with STREAM_NOT_ACTIVE when no stream exists via close report', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			// saAddress has no stream opened
			const report = buildCloseReport(saAddress, this.mockSuperToken.address)

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('STREAM_NOT_ACTIVE')
		})

		it('Should revert with STREAM_NOT_LOW when balance is above threshold via close report', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			// Set balance well above the 10% threshold
			const deposit = parseUnits('100', 18)
			const availableBalance = parseUnits('50', 18) // 50% >> 10% threshold
			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(
				sv,
				saAddress,
				this.alice,
				this.mockSuperToken.address
			)

			const report = buildCloseReport(saAddress, this.mockSuperToken.address)

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('STREAM_NOT_LOW')
		})

		it('Should revert with INVALID_ADDRESS if superToken is zeroAddress in close report', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const report = buildCloseReport(saAddress, zeroAddress)

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('INVALID_ADDRESS')
		})
	})

	// ==========================================================================
	// MODULE: onReport — Security invariants (no backdoor)
	// ==========================================================================

	describe('onReport — security invariants', function () {
		let saAddress: Address

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
			saAddress = await setupFundedSA(this as any)
		})

		it('Should not allow onReport to move funds beyond what executeSwap already allows', async function () {
			// The report path calls the same internal _executeSwap; slippage is enforced
			// inside the SA. Attempt to get 0 amountOut with minAmountOut > 0.
			// The SA's INSUFFICIENT_OUTPUT guard should fire.
			const sv = this.streamVaults as StreamVaultsContract

			// Configure router to return 0 output
			await (this.mockRouter as any).write.configure(
				[this.mockUsdc.address, this.mockWeth.address, 0n, false],
				{ account: this.deployer }
			)

			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: parseUnits('1', 18) // minimum not met
			})

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('INSUFFICIENT_OUTPUT')
		})

		it('Should not allow a malicious forwarder to bypass target whitelist via report', async function () {
			// Even if the bot (forwarder) is the caller, the whitelist check inside
			// _executeSwap is enforced at the gateway level before the SA is called.
			const sv = this.streamVaults as StreamVaultsContract
			const maliciousTarget = this.charlie

			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: maliciousTarget,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('INVALID_TARGET')
		})

		it('Should not allow a malicious forwarder to bypass token whitelist via report', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.charlie, // unlisted token
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('INVALID_SWAP_TOKEN')
		})

		it('Should not allow a malicious forwarder to bypass swap cooldown via report', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			// 1. First call succeeds (records lastSwapBlock = N)
			await (sv as any).write.onReport(['0x', report], { account: this.bot })

			// 2. Raise cooldown to 1000 blocks AFTER the first swap so the guard
			//    condition (block.number <= N + 1000 - 1) is active for subsequent calls.
			await (sv as any).write.setSwapCooldown([1000n], {
				account: this.deployer
			})

			// 3. Re-fund so the swap itself could execute if cooldown didn't block
			await (this.mockUsdc as any).write.mint(
				[saAddress, parseUnits('50', 6)],
				{ account: this.deployer }
			)
			await (this.mockWeth as any).write.mint(
				[this.mockRouter.address, parseUnits('50', 18)],
				{ account: this.deployer }
			)

			// 4. Second report call — block is N+4 at most, within the 1000-block window
			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('SWAP_COOLDOWN_ACTIVE')
		})

		it('Should not let the bot close a stream that is not low (close is not a forced drain)', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			const deposit = parseUnits('100', 18)
			const availableBalance = parseUnits('90', 18) // 90% of deposit — well above 10% threshold
			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(
				sv,
				saAddress,
				this.alice,
				this.mockSuperToken.address
			)

			const report = buildCloseReport(saAddress, this.mockSuperToken.address)

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('STREAM_NOT_LOW')
		})

		it('Should never move user funds when closing a stream via report path', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			const deposit = parseUnits('100', 18)
			const availableBalance = 0n

			await (this.mockSuperToken as any).write.mint([this.alice, deposit], {
				account: this.deployer
			})
			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(
				sv,
				saAddress,
				this.alice,
				this.mockSuperToken.address
			)

			const aliceBefore: bigint = await (
				this.mockSuperToken as any
			).read.balanceOf([this.alice])
			const botBefore: bigint = await (
				this.mockSuperToken as any
			).read.balanceOf([this.bot])
			const svBefore: bigint = await (
				this.mockSuperToken as any
			).read.balanceOf([(sv as any).address])

			const report = buildCloseReport(saAddress, this.mockSuperToken.address)
			await (sv as any).write.onReport(['0x', report], { account: this.bot })

			const aliceAfter: bigint = await (
				this.mockSuperToken as any
			).read.balanceOf([this.alice])
			const botAfter: bigint = await (
				this.mockSuperToken as any
			).read.balanceOf([this.bot])
			const svAfter: bigint = await (this.mockSuperToken as any).read.balanceOf(
				[(sv as any).address]
			)

			expect(aliceAfter).to.equal(aliceBefore)
			expect(botAfter).to.equal(botBefore)
			expect(svAfter).to.equal(svBefore)
		})

		it('Should not emit ReportHandled if the internal call reverts (atomic failure)', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			// Use an unknown SA — _executeSwap will revert, so the whole tx reverts
			// and no events are emitted (atomicity)
			const report = buildSwapReport(this.charlie, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			await expect(
				(sv as any).write.onReport(['0x', report], { account: this.bot })
			).to.be.rejectedWith('SMART_ACCOUNT_NOT_FOUND')
			// If it rejected, no events were emitted — the tx was entirely reverted.
		})
	})

	// ==========================================================================
	// MODULE: onReport — Selector and dispatch correctness
	// ==========================================================================

	describe('onReport — selector dispatch', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should confirm EXECUTE_SWAP_SELECTOR matches this.executeSwap.selector on-chain (sanity)', async function () {
			// We verify by checking that a correctly-encoded executeSwap report works,
			// confirming the selector constant in this file matches the live contract.
			const sv = this.streamVaults as StreamVaultsContract
			const saAddress = await setupFundedSA(this as any)

			const report = buildSwapReport(saAddress, {
				superTokenIn: zeroAddress,
				superAmountIn: 0n,
				tokenIn: this.mockUsdc.address,
				tokenOut: this.mockWeth.address,
				target: this.mockRouter.address,
				value: 0n,
				data: '0x',
				minAmountOut: 1n
			})

			// Verify the first 4 bytes of the report are the expected selector
			expect(report.slice(0, 10).toLowerCase()).to.equal(
				EXECUTE_SWAP_SELECTOR.toLowerCase()
			)

			// And the full call succeeds
			const tx = await (sv as any).write.onReport(['0x', report], {
				account: this.bot
			})
			expect(tx).to.exist
		})

		it('Should confirm CLOSE_STREAM_SELECTOR matches this.closeStreamIfLow.selector on-chain (sanity)', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await (sv as any).write.createSmartAccount([], { account: this.alice })
			const saAddress: Address = await (sv as any).read.smartAccountOf([
				this.alice
			])

			const deposit = parseUnits('100', 18)
			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, 0n, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(
				sv,
				saAddress,
				this.alice,
				this.mockSuperToken.address
			)

			const report = buildCloseReport(saAddress, this.mockSuperToken.address)

			// Verify the first 4 bytes of the report are the expected selector
			expect(report.slice(0, 10).toLowerCase()).to.equal(
				CLOSE_STREAM_SELECTOR.toLowerCase()
			)

			const tx = await (sv as any).write.onReport(['0x', report], {
				account: this.bot
			})
			expect(tx).to.exist
		})

		it('Should revert with INVALID_REPORT on a selector that differs by 1 bit from executeSwap', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			// Flip the last nibble of the executeSwap selector
			const flippedSelector = `0xbfa7c107` as `0x${string}`
			const garbage4 = flippedSelector

			await expect(
				(sv as any).write.onReport(['0x', garbage4], { account: this.bot })
			).to.be.rejectedWith('INVALID_REPORT')
		})
	})
})
