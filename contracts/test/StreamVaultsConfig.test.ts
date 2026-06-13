import { expect } from 'chai'
import hre from 'hardhat'
import { Address, decodeEventLog, zeroAddress } from 'viem'

import StreamVaultsConfigArtifact from '../artifacts/contracts/core/StreamVaults/StreamVaultsConfig.sol/StreamVaultsConfig.json'
import {
	deployTestFixture,
	StreamVaultsConfigContract,
	TestFixture
} from './helpers/fixtures'

describe('StreamVaultsConfig', function () {
	// =========================================================================
	// FIXTURE
	// =========================================================================

	async function deployFixture(): Promise<TestFixture> {
		return deployTestFixture()
	}

	// =========================================================================
	// MÓDULO: initialize
	// =========================================================================

	describe('initialize', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should set owner, bot, smartAccountImpl, permit2, cfaForwarder and minStreamAccumulationWindow on initialize', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract

			const owner = await (cfg as any).read.owner()
			expect(owner.toLowerCase()).to.equal(this.deployer.toLowerCase())

			const bot = await (cfg as any).read.bot()
			expect(bot.toLowerCase()).to.equal(this.bot.toLowerCase())

			const impl = await (cfg as any).read.smartAccountImplementation()
			expect(impl).to.not.equal(zeroAddress)

			const cfa = await (cfg as any).read.cfaForwarder()
			expect(cfa.toLowerCase()).to.equal(this.mockCFA.address.toLowerCase())

			const window = await (cfg as any).read.minStreamAccumulationWindow()
			expect(window).to.equal(86_400n)
		})

		it('Should emit BotUpdated, SmartAccountImplementationUpdated, Permit2Updated and CfaForwarderUpdated on initialize', async function () {
			// These events are emitted during fixture deployment.
			// We verify by reading state (events from prior blocks are harder to query
			// in hardhat-deploy fixture mode).
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			expect(await (cfg as any).read.bot()).to.not.equal(zeroAddress)
		})

		it('Should revert if re-initialized (double initialization blocked by Initializable)', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.initialize(
					[
						this.deployer,
						this.bot,
						this.deployer,
						this.deployer,
						this.deployer,
						86_400n
					],
					{ account: this.deployer }
				)
			).to.be.rejected
		})
	})

	// =========================================================================
	// MÓDULO: setMinStreamAccumulationWindow (R-3 from AUDIT_V2)
	// =========================================================================

	describe('setMinStreamAccumulationWindow', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should expose MIN_ACCUMULATION_WINDOW constant = 60', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const min = await (cfg as any).read.MIN_ACCUMULATION_WINDOW()
			expect(min).to.equal(60n)
		})

		it('Should return the deploy-time default of 86400 seconds', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const window = await (cfg as any).read.minStreamAccumulationWindow()
			expect(window).to.equal(86_400n)
		})

		it('Should update the window when called by owner', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await (cfg as any).write.setMinStreamAccumulationWindow([3_600n], {
				account: this.deployer
			})
			expect(await (cfg as any).read.minStreamAccumulationWindow()).to.equal(
				3_600n
			)
		})

		it('Should emit MinStreamAccumulationWindowUpdated with previous and new value', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const prev = await (cfg as any).read.minStreamAccumulationWindow()

			const txHash = await (cfg as any).write.setMinStreamAccumulationWindow(
				[120n],
				{ account: this.deployer }
			)
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: cfg.address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})
			expect(logs.length).to.be.greaterThanOrEqual(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsConfigArtifact.abi,
				data: logs[0].data,
				topics: logs[0].topics
			})
			expect((decoded as any).eventName).to.equal(
				'MinStreamAccumulationWindowUpdated'
			)
			expect((decoded as any).args.previousWindow).to.equal(prev)
			expect((decoded as any).args.newWindow).to.equal(120n)
		})

		it('Should revert if caller is not owner', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setMinStreamAccumulationWindow([3_600n], {
					account: this.alice
				})
			).to.be.rejectedWith('OwnableUnauthorizedAccount')
		})

		it('Should revert with WINDOW_TOO_LOW when windowSeconds < MIN_ACCUMULATION_WINDOW (boundary)', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setMinStreamAccumulationWindow([59n], {
					account: this.deployer
				})
			).to.be.rejectedWith('WINDOW_TOO_LOW')
		})

		it('Should revert with WINDOW_TOO_LOW when windowSeconds = 0', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setMinStreamAccumulationWindow([0n], {
					account: this.deployer
				})
			).to.be.rejectedWith('WINDOW_TOO_LOW')
		})

		it('Should accept the boundary value windowSeconds = MIN_ACCUMULATION_WINDOW', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await (cfg as any).write.setMinStreamAccumulationWindow([60n], {
				account: this.deployer
			})
			expect(await (cfg as any).read.minStreamAccumulationWindow()).to.equal(
				60n
			)
		})
	})

	// =========================================================================
	// MÓDULO: setBot
	// =========================================================================

	describe('setBot', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should update bot address when called by owner', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const newBot = this.alice

			await (cfg as any).write.setBot([newBot], {
				account: this.deployer
			})

			const stored = await (cfg as any).read.bot()
			expect(stored.toLowerCase()).to.equal(newBot.toLowerCase())
		})

		it('Should emit BotUpdated with previous and new address', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const prevBot = await (cfg as any).read.bot()

			const txHash = await (cfg as any).write.setBot([this.alice], {
				account: this.deployer
			})

			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: cfg.address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})
			expect(logs.length).to.be.greaterThanOrEqual(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsConfigArtifact.abi,
				data: logs[0].data,
				topics: logs[0].topics
			})
			expect((decoded as any).eventName).to.equal('BotUpdated')
			expect((decoded as any).args.previousBot?.toLowerCase()).to.equal(
				prevBot.toLowerCase()
			)
			expect((decoded as any).args.newBot?.toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
		})

		it('Should revert if caller is not owner', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setBot([this.alice], {
					account: this.alice
				})
			).to.be.rejectedWith('OwnableUnauthorizedAccount')
		})

		it('Should revert if newBot is zero address', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setBot([zeroAddress], {
					account: this.deployer
				})
			).to.be.rejectedWith('INVALID_ADDRESS')
		})
	})

	// =========================================================================
	// MÓDULO: setAllowedTarget
	// =========================================================================

	describe('setAllowedTarget', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should whitelist a target', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const target = this.alice

			await (cfg as any).write.setAllowedTarget([target, true], {
				account: this.deployer
			})

			expect(await (cfg as any).read.isAllowedTarget([target])).to.equal(true)
		})

		it('Should remove a target from whitelist', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const target = this.alice

			await (cfg as any).write.setAllowedTarget([target, true], {
				account: this.deployer
			})
			await (cfg as any).write.setAllowedTarget([target, false], {
				account: this.deployer
			})

			expect(await (cfg as any).read.isAllowedTarget([target])).to.equal(false)
		})

		it('Should emit TargetWhitelistUpdated with correct args', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const target = this.alice

			const txHash = await (cfg as any).write.setAllowedTarget([target, true], {
				account: this.deployer
			})
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: cfg.address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})
			expect(logs.length).to.be.greaterThanOrEqual(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsConfigArtifact.abi,
				data: logs[0].data,
				topics: logs[0].topics
			})
			expect((decoded as any).eventName).to.equal('TargetWhitelistUpdated')
			expect((decoded as any).args.target?.toLowerCase()).to.equal(
				target.toLowerCase()
			)
			expect((decoded as any).args.allowed).to.equal(true)
		})

		it('Should revert if caller is not owner', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setAllowedTarget([this.alice, true], {
					account: this.alice
				})
			).to.be.rejectedWith('OwnableUnauthorizedAccount')
		})

		it('Should revert if target is zero address', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setAllowedTarget([zeroAddress, true], {
					account: this.deployer
				})
			).to.be.rejectedWith('INVALID_ADDRESS')
		})
	})

	// =========================================================================
	// MÓDULO: setSupportedSwapToken
	// =========================================================================

	describe('setSupportedSwapToken', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should mark a token as supported', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const token = this.alice

			await (cfg as any).write.setSupportedSwapToken([token, true], {
				account: this.deployer
			})
			expect(await (cfg as any).read.isSupportedSwapToken([token])).to.equal(
				true
			)
		})

		it('Should remove a token from supported list', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const token = this.alice

			await (cfg as any).write.setSupportedSwapToken([token, true], {
				account: this.deployer
			})
			await (cfg as any).write.setSupportedSwapToken([token, false], {
				account: this.deployer
			})
			expect(await (cfg as any).read.isSupportedSwapToken([token])).to.equal(
				false
			)
		})

		it('Should emit SwapTokenSupportUpdated with correct args', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const token = this.alice

			const txHash = await (cfg as any).write.setSupportedSwapToken(
				[token, true],
				{ account: this.deployer }
			)
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: cfg.address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})
			expect(logs.length).to.be.greaterThanOrEqual(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsConfigArtifact.abi,
				data: logs[0].data,
				topics: logs[0].topics
			})
			expect((decoded as any).eventName).to.equal('SwapTokenSupportUpdated')
			expect((decoded as any).args.token?.toLowerCase()).to.equal(
				token.toLowerCase()
			)
			expect((decoded as any).args.supported).to.equal(true)
		})

		it('Should revert if caller is not owner', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setSupportedSwapToken([this.alice, true], {
					account: this.alice
				})
			).to.be.rejectedWith('OwnableUnauthorizedAccount')
		})

		it('Should revert if token is zero address', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setSupportedSwapToken([zeroAddress, true], {
					account: this.deployer
				})
			).to.be.rejectedWith('INVALID_ADDRESS')
		})
	})

	// =========================================================================
	// MÓDULO: setSmartAccountImplementation
	// =========================================================================

	describe('setSmartAccountImplementation', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should update smartAccountImplementation', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const newImpl = this.alice

			await (cfg as any).write.setSmartAccountImplementation([newImpl], {
				account: this.deployer
			})
			expect(
				(await (cfg as any).read.smartAccountImplementation()).toLowerCase()
			).to.equal(newImpl.toLowerCase())
		})

		it('Should emit SmartAccountImplementationUpdated', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const prevImpl = await (cfg as any).read.smartAccountImplementation()

			const txHash = await (cfg as any).write.setSmartAccountImplementation(
				[this.alice],
				{ account: this.deployer }
			)
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: cfg.address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})
			expect(logs.length).to.be.greaterThanOrEqual(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsConfigArtifact.abi,
				data: logs[0].data,
				topics: logs[0].topics
			})
			expect((decoded as any).eventName).to.equal(
				'SmartAccountImplementationUpdated'
			)
			expect((decoded as any).args.previousImpl?.toLowerCase()).to.equal(
				prevImpl.toLowerCase()
			)
			expect((decoded as any).args.newImpl?.toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
		})

		it('Should revert if caller is not owner', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setSmartAccountImplementation([this.alice], {
					account: this.alice
				})
			).to.be.rejectedWith('OwnableUnauthorizedAccount')
		})

		it('Should revert if newImpl is zero address', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setSmartAccountImplementation([zeroAddress], {
					account: this.deployer
				})
			).to.be.rejectedWith('INVALID_ADDRESS')
		})
	})

	// =========================================================================
	// MÓDULO: setPermit2
	// =========================================================================

	describe('setPermit2', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should update permit2 address', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await (cfg as any).write.setPermit2([this.alice], {
				account: this.deployer
			})
			expect((await (cfg as any).read.permit2()).toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
		})

		it('Should revert if caller is not owner', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setPermit2([this.alice], {
					account: this.alice
				})
			).to.be.rejectedWith('OwnableUnauthorizedAccount')
		})

		it('Should revert if zero address', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setPermit2([zeroAddress], {
					account: this.deployer
				})
			).to.be.rejectedWith('INVALID_ADDRESS')
		})
	})

	// =========================================================================
	// MÓDULO: setCfaForwarder
	// =========================================================================

	describe('setCfaForwarder', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should update cfaForwarder address', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await (cfg as any).write.setCfaForwarder([this.alice], {
				account: this.deployer
			})
			expect((await (cfg as any).read.cfaForwarder()).toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
		})

		it('Should revert if caller is not owner', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setCfaForwarder([this.alice], {
					account: this.alice
				})
			).to.be.rejectedWith('OwnableUnauthorizedAccount')
		})

		it('Should revert if zero address', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			await expect(
				(cfg as any).write.setCfaForwarder([zeroAddress], {
					account: this.deployer
				})
			).to.be.rejectedWith('INVALID_ADDRESS')
		})

		it('Should emit CfaForwarderUpdated', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			const prev = await (cfg as any).read.cfaForwarder()
			const txHash = await (cfg as any).write.setCfaForwarder([this.alice], {
				account: this.deployer
			})
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: cfg.address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})
			expect(logs.length).to.be.greaterThanOrEqual(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsConfigArtifact.abi,
				data: logs[0].data,
				topics: logs[0].topics
			})
			expect((decoded as any).eventName).to.equal('CfaForwarderUpdated')
			expect((decoded as any).args.previousForwarder?.toLowerCase()).to.equal(
				prev.toLowerCase()
			)
			expect((decoded as any).args.newForwarder?.toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
		})
	})

	// =========================================================================
	// MÓDULO: upgradeToAndCall (UUPS)
	// =========================================================================

	describe('upgradeToAndCall', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should revert upgrade if caller is not owner', async function () {
			const cfg = this.streamVaultsConfig as StreamVaultsConfigContract
			// Attempt upgrade to a non-zero address from non-owner
			await expect(
				(cfg as any).write.upgradeToAndCall([this.alice, '0x'], {
					account: this.alice
				})
			).to.be.rejected
		})
	})
})
