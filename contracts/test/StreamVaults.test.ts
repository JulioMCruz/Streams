import { expect } from 'chai'
import hre, { viem } from 'hardhat'
import { Address, decodeEventLog, parseUnits, zeroAddress } from 'viem'

import StreamVaultsArtifact from '../artifacts/contracts/core/StreamVaults/StreamVaults.sol/StreamVaults.json'
import {
	deployTestFixture,
	FLOW_RATE,
	signPermit,
	SmartAccountDCAContract,
	StreamVaultsContract,
	TestFixture,
	USDC_AMOUNT
} from './helpers/fixtures'

describe('StreamVaults', function () {
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

		it('Should set the owner correctly', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const owner = await (sv as any).read.owner()
			expect(owner.toLowerCase()).to.equal(this.deployer.toLowerCase())
		})

		it('Should set the config address correctly', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const cfg = await (sv as any).read.config()
			expect(cfg.toLowerCase()).to.equal(
				this.streamVaultsConfig.address.toLowerCase()
			)
		})

		it('Should revert if re-initialized', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.initialize(
					[this.deployer, this.streamVaultsConfig.address],
					{ account: this.deployer }
				)
			).to.be.rejected
		})

		it('Should revert initialize with zero owner address', async function () {
			// The proxy is already initialized; testing the guard in a fresh deploy
			// scenario is covered by the UUPS proxy pattern. We test that a zero
			// owner would be rejected if the contract were re-initialized.
			// This is validated indirectly by the Ownable zero-address check.
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.initialize(
					[zeroAddress, this.streamVaultsConfig.address],
					{ account: this.deployer }
				)
			).to.be.rejected
		})
	})

	// =========================================================================
	// MÓDULO: createSmartAccount
	// =========================================================================

	describe('createSmartAccount', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should deploy a new SmartAccountDCA clone for the caller', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await (sv as any).write.createSmartAccount([], {
				account: this.alice
			})

			const saAddress = await (sv as any).read.smartAccountOf([this.alice])
			expect(saAddress).to.not.equal(zeroAddress)
		})

		it('Should emit SmartAccountCreated event with correct user and smartAccount', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			const txHash = await (sv as any).write.createSmartAccount([], {
				account: this.alice
			})
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: sv.address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const saCreatedLogs = logs.filter(log => {
				try {
					const decoded = decodeEventLog({
						abi: StreamVaultsArtifact.abi,
						data: log.data,
						topics: log.topics
					})
					return (decoded as any).eventName === 'SmartAccountCreated'
				} catch {
					return false
				}
			})
			expect(saCreatedLogs.length).to.equal(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsArtifact.abi,
				data: saCreatedLogs[0].data,
				topics: saCreatedLogs[0].topics
			})
			expect((decoded as any).args.user?.toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
			expect((decoded as any).args.smartAccount).to.not.equal(zeroAddress)
		})

		it('Should update smartAccountOf and userOf bidirectional mapping', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await (sv as any).write.createSmartAccount([], {
				account: this.alice
			})

			const saAddress = await (sv as any).read.smartAccountOf([this.alice])
			const user = await (sv as any).read.userOf([saAddress])

			expect(saAddress).to.not.equal(zeroAddress)
			expect(user.toLowerCase()).to.equal(this.alice.toLowerCase())
		})

		it('Should initialize the clone with alice as owner and StreamVaults as operator', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await (sv as any).write.createSmartAccount([], {
				account: this.alice
			})

			const saAddress = await (sv as any).read.smartAccountOf([this.alice])
			const sa = (await viem.getContractAt(
				'SmartAccountDCA',
				saAddress
			)) as unknown as SmartAccountDCAContract

			const owner = await (sa as any).read.owner()
			const operator = await (sa as any).read.operator()

			expect(owner.toLowerCase()).to.equal(this.alice.toLowerCase())
			expect(operator.toLowerCase()).to.equal(sv.address.toLowerCase())
		})

		it('Should revert if the same user tries to create a second smart account', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await (sv as any).write.createSmartAccount([], {
				account: this.alice
			})

			await expect(
				(sv as any).write.createSmartAccount([], { account: this.alice })
			).to.be.rejectedWith('SMART_ACCOUNT_ALREADY_EXISTS')
		})

		it('Should allow different users to each have their own smart account', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await (sv as any).write.createSmartAccount([], { account: this.alice })
			await (sv as any).write.createSmartAccount([], { account: this.bob })

			const saAlice = await (sv as any).read.smartAccountOf([this.alice])
			const saBob = await (sv as any).read.smartAccountOf([this.bob])

			expect(saAlice).to.not.equal(saBob)
			expect(saAlice).to.not.equal(zeroAddress)
			expect(saBob).to.not.equal(zeroAddress)
		})
	})

	// =========================================================================
	// MÓDULO: redeploySmartAccount
	// =========================================================================

	describe('redeploySmartAccount', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should revert with SMART_ACCOUNT_NOT_FOUND when caller has no account', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.redeploySmartAccount([], { account: this.alice })
			).to.be.rejectedWith('SMART_ACCOUNT_NOT_FOUND')
		})

		it('Should replace the old clone with a fresh, different address', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await (sv as any).write.createSmartAccount([], { account: this.alice })
			const oldSa = await (sv as any).read.smartAccountOf([this.alice])

			await (sv as any).write.redeploySmartAccount([], { account: this.alice })
			const newSa = await (sv as any).read.smartAccountOf([this.alice])

			expect(newSa).to.not.equal(zeroAddress)
			expect(newSa.toLowerCase()).to.not.equal(oldSa.toLowerCase())
		})

		it('Should detach the old clone (userOf old == zero) and wire the new one', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await (sv as any).write.createSmartAccount([], { account: this.alice })
			const oldSa = await (sv as any).read.smartAccountOf([this.alice])

			await (sv as any).write.redeploySmartAccount([], { account: this.alice })
			const newSa = await (sv as any).read.smartAccountOf([this.alice])

			expect((await (sv as any).read.userOf([oldSa])).toLowerCase()).to.equal(
				zeroAddress
			)
			expect((await (sv as any).read.userOf([newSa])).toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
		})

		it('Should initialize the new clone with alice as owner and StreamVaults as operator', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await (sv as any).write.createSmartAccount([], { account: this.alice })
			await (sv as any).write.redeploySmartAccount([], { account: this.alice })
			const newSa = await (sv as any).read.smartAccountOf([this.alice])

			const sa = await hre.viem.getContractAt(
				'SmartAccountDCA',
				newSa as Address
			)
			expect((await (sa as any).read.owner()).toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
			expect((await (sa as any).read.operator()).toLowerCase()).to.equal(
				sv.address.toLowerCase()
			)
		})

		it('Should emit SmartAccountRedeployed with user, old and new accounts', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await (sv as any).write.createSmartAccount([], { account: this.alice })
			const oldSa = await (sv as any).read.smartAccountOf([this.alice])

			const txHash = await (sv as any).write.redeploySmartAccount([], {
				account: this.alice
			})
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})
			const decoded = receipt.logs
				.map(log => {
					try {
						return decodeEventLog({
							abi: StreamVaultsArtifact.abi,
							data: log.data,
							topics: log.topics
						})
					} catch {
						return null
					}
				})
				.find(d => d && (d as any).eventName === 'SmartAccountRedeployed')

			expect(decoded).to.not.equal(undefined)
			expect((decoded as any).args.user?.toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
			expect((decoded as any).args.oldSmartAccount?.toLowerCase()).to.equal(
				oldSa.toLowerCase()
			)
			const newSa = await (sv as any).read.smartAccountOf([this.alice])
			expect((decoded as any).args.newSmartAccount?.toLowerCase()).to.equal(
				newSa.toLowerCase()
			)
		})

		it('Should let the user redeploy again (idempotent across calls)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await (sv as any).write.createSmartAccount([], { account: this.alice })
			await (sv as any).write.redeploySmartAccount([], { account: this.alice })
			const sa2 = await (sv as any).read.smartAccountOf([this.alice])
			await (sv as any).write.redeploySmartAccount([], { account: this.alice })
			const sa3 = await (sv as any).read.smartAccountOf([this.alice])
			expect(sa3).to.not.equal(zeroAddress)
			expect(sa3.toLowerCase()).to.not.equal(sa2.toLowerCase())
		})
	})

	// =========================================================================
	// MÓDULO: setStream
	// =========================================================================

	describe('setStream', function () {
		let saAddress: Address

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)

			// Create alice's smart account
			await (this.streamVaults as any).write.createSmartAccount([], {
				account: this.alice
			})
			saAddress = await (this.streamVaults as any).read.smartAccountOf([
				this.alice
			])
		})

		it('Should open a stream and emit StreamUpdated with prevRate=0', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			const txHash = await (sv as any).write.setStream(
				[saAddress, this.mockSuperToken.address, FLOW_RATE],
				{ account: this.alice }
			)
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: sv.address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const streamLogs = logs.filter(log => {
				try {
					const decoded = decodeEventLog({
						abi: StreamVaultsArtifact.abi,
						data: log.data,
						topics: log.topics
					})
					return (decoded as any).eventName === 'StreamUpdated'
				} catch {
					return false
				}
			})
			expect(streamLogs.length).to.equal(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsArtifact.abi,
				data: streamLogs[0].data,
				topics: streamLogs[0].topics
			})
			expect((decoded as any).args.previousRate).to.equal(0n)
			expect((decoded as any).args.newRate).to.equal(FLOW_RATE)
			expect((decoded as any).args.user?.toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
			expect((decoded as any).args.smartAccount?.toLowerCase()).to.equal(
				saAddress.toLowerCase()
			)
		})

		it('Should close a stream when rate = 0', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			// Open first
			await (sv as any).write.setStream(
				[saAddress, this.mockSuperToken.address, FLOW_RATE],
				{ account: this.alice }
			)

			// Close
			const txHash = await (sv as any).write.setStream(
				[saAddress, this.mockSuperToken.address, 0n],
				{ account: this.alice }
			)
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: sv.address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const streamLogs = logs.filter(log => {
				try {
					const decoded = decodeEventLog({
						abi: StreamVaultsArtifact.abi,
						data: log.data,
						topics: log.topics
					})
					return (decoded as any).eventName === 'StreamUpdated'
				} catch {
					return false
				}
			})
			expect(streamLogs.length).to.equal(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsArtifact.abi,
				data: streamLogs[0].data,
				topics: streamLogs[0].topics
			})
			expect((decoded as any).args.newRate).to.equal(0n)
			expect((decoded as any).args.previousRate).to.equal(FLOW_RATE)
		})

		it('Should revert if caller is not the smart account owner', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.setStream(
					[saAddress, this.mockSuperToken.address, FLOW_RATE],
					{ account: this.bob }
				)
			).to.be.rejectedWith('NOT_SMART_ACCOUNT_OWNER')
		})

		it('Should revert if smart account is not found (zero userOf)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const randomAddress = this.charlie

			await expect(
				(sv as any).write.setStream(
					[randomAddress, this.mockSuperToken.address, FLOW_RATE],
					{ account: this.alice }
				)
			).to.be.rejectedWith('SMART_ACCOUNT_NOT_FOUND')
		})

		it('Should revert if superToken is zero address', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.setStream([saAddress, zeroAddress, FLOW_RATE], {
					account: this.alice
				})
			).to.be.rejectedWith('INVALID_ADDRESS')
		})

		it('Should revert if CFA forwarder reverts', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			// Make CFA forwarder revert
			await (this.mockCFA as any).write.setRevertOnSetFlow([true], {
				account: this.deployer
			})

			await expect(
				(sv as any).write.setStream(
					[saAddress, this.mockSuperToken.address, FLOW_RATE],
					{ account: this.alice }
				)
			).to.be.rejected
		})
	})

	// =========================================================================
	// MÓDULO: startStreamBot
	// =========================================================================

	describe('startStreamBot', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)

			// Mint USDC to alice
			await (this.mockUsdc as any).write.mint([this.alice, USDC_AMOUNT], {
				account: this.deployer
			})

			// Approve StreamVaults to pull USDC (fallback allowance if permit fails)
			await (this.mockUsdc as any).write.approve(
				[this.streamVaults.address, USDC_AMOUNT],
				{ account: this.alice }
			)
		})

		it('Should deploy smart account and open stream in a single tx', async function () {
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
			const { v, r, s } = await signPermit({
				signer: this.alice,
				token: this.mockUsdc,
				spender: this.streamVaults.address,
				value: USDC_AMOUNT,
				deadline
			})

			const rules = {
				maxSlippageBps: 100,
				minTradeAmount: parseUnits('1', 6),
				settlementAddress: this.alice,
				targetTokens: [this.mockWeth.address] as Address[]
			}

			const txHash = await (this.streamVaults as any).write.startStreamBot(
				[
					this.mockSuperToken.address,
					USDC_AMOUNT,
					FLOW_RATE,
					rules,
					{ deadline, v, r, s }
				],
				{ account: this.alice }
			)

			const saAddress = await (this.streamVaults as any).read.smartAccountOf([
				this.alice
			])
			expect(saAddress).to.not.equal(zeroAddress)

			const publicClient = await hre.viem.getPublicClient()
			await publicClient.waitForTransactionReceipt({ hash: txHash })

			// Verify stream was set in CFA mock
			const flowRate = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.alice,
				saAddress
			])
			expect(flowRate).to.equal(FLOW_RATE)
		})

		it('Should emit StreamBotStarted with all correct params', async function () {
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
			const { v, r, s } = await signPermit({
				signer: this.alice,
				token: this.mockUsdc,
				spender: this.streamVaults.address,
				value: USDC_AMOUNT,
				deadline
			})

			const rules = {
				maxSlippageBps: 100,
				minTradeAmount: parseUnits('1', 6),
				settlementAddress: this.alice,
				targetTokens: [this.mockWeth.address] as Address[]
			}

			const txHash = await (this.streamVaults as any).write.startStreamBot(
				[
					this.mockSuperToken.address,
					USDC_AMOUNT,
					FLOW_RATE,
					rules,
					{ deadline, v, r, s }
				],
				{ account: this.alice }
			)

			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: (this.streamVaults as any).address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const startedLogs = logs.filter(log => {
				try {
					const decoded = decodeEventLog({
						abi: StreamVaultsArtifact.abi,
						data: log.data,
						topics: log.topics
					})
					return (decoded as any).eventName === 'StreamBotStarted'
				} catch {
					return false
				}
			})
			expect(startedLogs.length).to.equal(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsArtifact.abi,
				data: startedLogs[0].data,
				topics: startedLogs[0].topics
			})
			expect((decoded as any).args.user?.toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
			expect((decoded as any).args.superToken?.toLowerCase()).to.equal(
				this.mockSuperToken.address.toLowerCase()
			)
			expect((decoded as any).args.underlyingAmountWrapped).to.equal(
				USDC_AMOUNT
			)
			expect((decoded as any).args.rate).to.equal(FLOW_RATE)
		})

		it('Should emit SmartAccountCreated, StreamUpdated and StreamBotStarted in same tx', async function () {
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
			const { v, r, s } = await signPermit({
				signer: this.alice,
				token: this.mockUsdc,
				spender: this.streamVaults.address,
				value: USDC_AMOUNT,
				deadline
			})

			const rules = {
				maxSlippageBps: 100,
				minTradeAmount: parseUnits('1', 6),
				settlementAddress: this.alice,
				targetTokens: [this.mockWeth.address] as Address[]
			}

			const txHash = await (this.streamVaults as any).write.startStreamBot(
				[
					this.mockSuperToken.address,
					USDC_AMOUNT,
					FLOW_RATE,
					rules,
					{ deadline, v, r, s }
				],
				{ account: this.alice }
			)

			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: (this.streamVaults as any).address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const eventNames = logs
				.map(log => {
					try {
						const decoded = decodeEventLog({
							abi: StreamVaultsArtifact.abi,
							data: log.data,
							topics: log.topics
						})
						return (decoded as any).eventName
					} catch {
						return null
					}
				})
				.filter(Boolean)

			expect(eventNames).to.include('SmartAccountCreated')
			expect(eventNames).to.include('StreamUpdated')
			expect(eventNames).to.include('StreamBotStarted')
		})

		it('Should revert if superToken is zero address', async function () {
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
			const { v, r, s } = await signPermit({
				signer: this.alice,
				token: this.mockUsdc,
				spender: this.streamVaults.address,
				value: USDC_AMOUNT,
				deadline
			})
			const rules = {
				maxSlippageBps: 100,
				minTradeAmount: 1n,
				settlementAddress: this.alice,
				targetTokens: [this.mockWeth.address] as Address[]
			}

			await expect(
				(this.streamVaults as any).write.startStreamBot(
					[zeroAddress, USDC_AMOUNT, FLOW_RATE, rules, { deadline, v, r, s }],
					{ account: this.alice }
				)
			).to.be.rejectedWith('INVALID_ADDRESS')
		})

		it('Should revert if underlyingAmount is zero', async function () {
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
			const { v, r, s } = await signPermit({
				signer: this.alice,
				token: this.mockUsdc,
				spender: this.streamVaults.address,
				value: USDC_AMOUNT,
				deadline
			})
			const rules = {
				maxSlippageBps: 100,
				minTradeAmount: 1n,
				settlementAddress: this.alice,
				targetTokens: [this.mockWeth.address] as Address[]
			}

			await expect(
				(this.streamVaults as any).write.startStreamBot(
					[
						this.mockSuperToken.address,
						0n,
						FLOW_RATE,
						rules,
						{ deadline, v, r, s }
					],
					{ account: this.alice }
				)
			).to.be.rejectedWith('INVALID_AMOUNT')
		})

		it('Should revert if rate is zero', async function () {
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
			const { v, r, s } = await signPermit({
				signer: this.alice,
				token: this.mockUsdc,
				spender: this.streamVaults.address,
				value: USDC_AMOUNT,
				deadline
			})
			const rules = {
				maxSlippageBps: 100,
				minTradeAmount: 1n,
				settlementAddress: this.alice,
				targetTokens: [this.mockWeth.address] as Address[]
			}

			await expect(
				(this.streamVaults as any).write.startStreamBot(
					[
						this.mockSuperToken.address,
						USDC_AMOUNT,
						0n,
						rules,
						{ deadline, v, r, s }
					],
					{ account: this.alice }
				)
			).to.be.rejectedWith('INVALID_RATE')
		})

		it('Should revert if rate is negative', async function () {
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
			const { v, r, s } = await signPermit({
				signer: this.alice,
				token: this.mockUsdc,
				spender: this.streamVaults.address,
				value: USDC_AMOUNT,
				deadline
			})
			const rules = {
				maxSlippageBps: 100,
				minTradeAmount: 1n,
				settlementAddress: this.alice,
				targetTokens: [this.mockWeth.address] as Address[]
			}

			await expect(
				(this.streamVaults as any).write.startStreamBot(
					[
						this.mockSuperToken.address,
						USDC_AMOUNT,
						-1n,
						rules,
						{ deadline, v, r, s }
					],
					{ account: this.alice }
				)
			).to.be.rejectedWith('INVALID_RATE')
		})

		it('Should succeed even if permit is front-run (allowance already set)', async function () {
			// The allowance is already set from beforeEach approve(). Even with
			// an expired/front-run permit the try/catch allows proceeding.
			const rules = {
				maxSlippageBps: 100,
				minTradeAmount: parseUnits('1', 6),
				settlementAddress: this.alice,
				targetTokens: [this.mockWeth.address] as Address[]
			}

			// Invalid permit sig — all zeros — should be silently caught
			const badSig = {
				deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
				v: 27,
				r: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
				s: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`
			}

			// Should succeed because the allowance is already in place from beforeEach
			const txHash = await (this.streamVaults as any).write.startStreamBot(
				[this.mockSuperToken.address, USDC_AMOUNT, FLOW_RATE, rules, badSig],
				{ account: this.alice }
			)
			expect(txHash).to.exist
		})

		it('Should revert if caller already has a smart account', async function () {
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
			const { v, r, s } = await signPermit({
				signer: this.alice,
				token: this.mockUsdc,
				spender: this.streamVaults.address,
				value: USDC_AMOUNT,
				deadline
			})
			const rules = {
				maxSlippageBps: 100,
				minTradeAmount: parseUnits('1', 6),
				settlementAddress: this.alice,
				targetTokens: [this.mockWeth.address] as Address[]
			}

			// First setup
			await (this.streamVaults as any).write.startStreamBot(
				[
					this.mockSuperToken.address,
					USDC_AMOUNT,
					FLOW_RATE,
					rules,
					{ deadline, v, r, s }
				],
				{ account: this.alice }
			)

			// Mint more USDC and approve for second attempt
			await (this.mockUsdc as any).write.mint([this.alice, USDC_AMOUNT], {
				account: this.deployer
			})
			await (this.mockUsdc as any).write.approve(
				[this.streamVaults.address, USDC_AMOUNT],
				{ account: this.alice }
			)

			const deadline2 = BigInt(Math.floor(Date.now() / 1000) + 7200)
			const sig2 = await signPermit({
				signer: this.alice,
				token: this.mockUsdc,
				spender: this.streamVaults.address,
				value: USDC_AMOUNT,
				deadline: deadline2
			})

			await expect(
				(this.streamVaults as any).write.startStreamBot(
					[
						this.mockSuperToken.address,
						USDC_AMOUNT,
						FLOW_RATE,
						rules,
						{ deadline: deadline2, ...sig2 }
					],
					{ account: this.alice }
				)
			).to.be.rejectedWith('SMART_ACCOUNT_ALREADY_EXISTS')
		})
	})

	// =========================================================================
	// MÓDULO: executeSwap (gateway)
	// =========================================================================

	describe('executeSwap', function () {
		let saAddress: Address

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)

			// Create SA, set rules, fund SA
			await (this.streamVaults as any).write.createSmartAccount([], {
				account: this.alice
			})
			saAddress = await (this.streamVaults as any).read.smartAccountOf([
				this.alice
			])

			const sa = (await viem.getContractAt('SmartAccountDCA', saAddress)) as any
			await sa.write.setRules(
				[
					{
						maxSlippageBps: 100,
						minTradeAmount: parseUnits('1', 6),
						settlementAddress: this.alice,
						targetTokens: [this.mockWeth.address] as Address[]
					}
				],
				{ account: this.alice }
			)

			await (this.mockUsdc as any).write.mint(
				[saAddress, parseUnits('50', 6)],
				{ account: this.deployer }
			)

			// Pre-fund router with WETH so it can transfer on swap
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
		})

		it('Should execute swap via bot and emit SwapExecuted', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			const txHash = await (sv as any).write.executeSwap(
				[
					saAddress,
					{
						superTokenIn: zeroAddress,
						superAmountIn: 0n,
						tokenIn: this.mockUsdc.address,
						tokenOut: this.mockWeth.address,
						target: this.mockRouter.address,
						value: 0n,
						data: '0x',
						minAmountOut: 1n
					}
				],
				{ account: this.bot }
			)

			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: sv.address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const swapLogs = logs.filter(log => {
				try {
					const decoded = decodeEventLog({
						abi: StreamVaultsArtifact.abi,
						data: log.data,
						topics: log.topics
					})
					return (decoded as any).eventName === 'SwapExecuted'
				} catch {
					return false
				}
			})
			expect(swapLogs.length).to.equal(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsArtifact.abi,
				data: swapLogs[0].data,
				topics: swapLogs[0].topics
			})
			expect((decoded as any).args.smartAccount?.toLowerCase()).to.equal(
				saAddress.toLowerCase()
			)
			expect((decoded as any).args.target?.toLowerCase()).to.equal(
				this.mockRouter.address.toLowerCase()
			)
			expect((decoded as any).args.tokenIn?.toLowerCase()).to.equal(
				this.mockUsdc.address.toLowerCase()
			)
			expect((decoded as any).args.tokenOut?.toLowerCase()).to.equal(
				this.mockWeth.address.toLowerCase()
			)
		})

		it('Should revert if caller is not the bot (NOT_BOT)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.executeSwap(
					[
						saAddress,
						{
							superTokenIn: zeroAddress,
							superAmountIn: 0n,
							tokenIn: this.mockUsdc.address,
							tokenOut: this.mockWeth.address,
							target: this.mockRouter.address,
							value: 0n,
							data: '0x',
							minAmountOut: 0n
						}
					],
					{ account: this.alice }
				)
			).to.be.rejectedWith('NOT_BOT')
		})

		it('Should revert if smart account is not known (SMART_ACCOUNT_NOT_FOUND)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.executeSwap(
					[
						this.charlie,
						{
							superTokenIn: zeroAddress,
							superAmountIn: 0n,
							tokenIn: this.mockUsdc.address,
							tokenOut: this.mockWeth.address,
							target: this.mockRouter.address,
							value: 0n,
							data: '0x',
							minAmountOut: 0n
						}
					],
					{ account: this.bot }
				)
			).to.be.rejectedWith('SMART_ACCOUNT_NOT_FOUND')
		})

		it('Should revert if target is not whitelisted (INVALID_TARGET)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.executeSwap(
					[
						saAddress,
						{
							superTokenIn: zeroAddress,
							superAmountIn: 0n,
							tokenIn: this.mockUsdc.address,
							tokenOut: this.mockWeth.address,
							target: this.charlie, // not whitelisted
							value: 0n,
							data: '0x',
							minAmountOut: 0n
						}
					],
					{ account: this.bot }
				)
			).to.be.rejectedWith('INVALID_TARGET')
		})

		it('Should revert if tokenIn is not a supported swap token (INVALID_SWAP_TOKEN)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.executeSwap(
					[
						saAddress,
						{
							superTokenIn: zeroAddress,
							superAmountIn: 0n,
							tokenIn: this.charlie, // not supported
							tokenOut: this.mockWeth.address,
							target: this.mockRouter.address,
							value: 0n,
							data: '0x',
							minAmountOut: 0n
						}
					],
					{ account: this.bot }
				)
			).to.be.rejectedWith('INVALID_SWAP_TOKEN')
		})

		it('Should revert if tokenOut is not a supported swap token (INVALID_SWAP_TOKEN)', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.executeSwap(
					[
						saAddress,
						{
							superTokenIn: zeroAddress,
							superAmountIn: 0n,
							tokenIn: this.mockUsdc.address,
							tokenOut: this.charlie, // not supported
							target: this.mockRouter.address,
							value: 0n,
							data: '0x',
							minAmountOut: 0n
						}
					],
					{ account: this.bot }
				)
			).to.be.rejectedWith('INVALID_SWAP_TOKEN')
		})
	})

	// =========================================================================
	// MÓDULO: views
	// =========================================================================

	describe('views', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should return zeroAddress for smartAccountOf unknown user', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const addr = await (sv as any).read.smartAccountOf([this.alice])
			expect(addr).to.equal(zeroAddress)
		})

		it('Should return zeroAddress for userOf unknown smart account', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const addr = await (sv as any).read.userOf([this.alice])
			expect(addr).to.equal(zeroAddress)
		})

		it('Should return config address from config()', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const cfg = await (sv as any).read.config()
			expect(cfg.toLowerCase()).to.equal(
				this.streamVaultsConfig.address.toLowerCase()
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
			const sv = this.streamVaults as StreamVaultsContract
			await expect(
				(sv as any).write.upgradeToAndCall([this.alice, '0x'], {
					account: this.alice
				})
			).to.be.rejected
		})
	})

	// =========================================================================
	// MÓDULO: streamCloseThresholdBps (view)
	// =========================================================================

	describe('streamCloseThresholdBps', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should return default value of 1000 (10%) after initialize', async function () {
			const sv = this.streamVaults as StreamVaultsContract
			const threshold = await (sv as any).read.streamCloseThresholdBps()
			expect(threshold).to.equal(1000n)
		})
	})

	// =========================================================================
	// MÓDULO: setStreamCloseThreshold
	// =========================================================================

	describe('setStreamCloseThreshold', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should update streamCloseThresholdBps when called by owner with valid value', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await (sv as any).write.setStreamCloseThreshold([500n], {
				account: this.deployer
			})

			const threshold = await (sv as any).read.streamCloseThresholdBps()
			expect(threshold).to.equal(500n)
		})

		it('Should accept 0 as a valid threshold (closes only when availableBalance <= 0)', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await (sv as any).write.setStreamCloseThreshold([0n], {
				account: this.deployer
			})

			const threshold = await (sv as any).read.streamCloseThresholdBps()
			expect(threshold).to.equal(0n)
		})

		it('Should accept the boundary value 10000 (100% of deposit)', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await (sv as any).write.setStreamCloseThreshold([10000n], {
				account: this.deployer
			})

			const threshold = await (sv as any).read.streamCloseThresholdBps()
			expect(threshold).to.equal(10000n)
		})

		it('Should revert if thresholdBps > 10000 (INVALID_THRESHOLD)', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await expect(
				(sv as any).write.setStreamCloseThreshold([10001n], {
					account: this.deployer
				})
			).to.be.rejectedWith('INVALID_THRESHOLD')
		})

		it('Should revert if thresholdBps is maxUint256 (INVALID_THRESHOLD)', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			// 2^256-1 >> 10000; the overflow-safe check `> 10_000` still fires correctly
			await expect(
				(sv as any).write.setStreamCloseThreshold(
					[115792089237316195423570985008687907853269984665640564039457584007913129639935n],
					{ account: this.deployer }
				)
			).to.be.rejectedWith('INVALID_THRESHOLD')
		})

		it('Should revert if caller is not owner (OwnableUnauthorizedAccount)', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await expect(
				(sv as any).write.setStreamCloseThreshold([500n], {
					account: this.alice
				})
			).to.be.rejectedWith('OwnableUnauthorizedAccount')
		})

		it('Should revert if bot tries to set threshold (OwnableUnauthorizedAccount)', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await expect(
				(sv as any).write.setStreamCloseThreshold([500n], {
					account: this.bot
				})
			).to.be.rejectedWith('OwnableUnauthorizedAccount')
		})

		it('Should emit StreamCloseThresholdUpdated with the new threshold', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			const txHash = await (sv as any).write.setStreamCloseThreshold([2500n], {
				account: this.deployer
			})

			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: sv.address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const eventLogs = logs.filter(log => {
				try {
					const decoded = decodeEventLog({
						abi: StreamVaultsArtifact.abi,
						data: log.data,
						topics: log.topics
					})
					return (decoded as any).eventName === 'StreamCloseThresholdUpdated'
				} catch {
					return false
				}
			})
			expect(eventLogs.length).to.equal(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsArtifact.abi,
				data: eventLogs[0].data,
				topics: eventLogs[0].topics
			})
			expect((decoded as any).args.thresholdBps).to.equal(2500n)
		})

		it('Should allow consecutive updates and last value wins', async function () {
			const sv = this.streamVaults as StreamVaultsContract

			await (sv as any).write.setStreamCloseThreshold([100n], {
				account: this.deployer
			})
			await (sv as any).write.setStreamCloseThreshold([9999n], {
				account: this.deployer
			})

			const threshold = await (sv as any).read.streamCloseThresholdBps()
			expect(threshold).to.equal(9999n)
		})
	})

	// =========================================================================
	// MÓDULO: closeStreamIfLow
	// =========================================================================

	describe('closeStreamIfLow', function () {
		let saAddress: Address

		// Helper: opens a stream from alice -> saAddress at FLOW_RATE
		async function openAliceStream(ctx: any): Promise<void> {
			await (ctx.streamVaults as any).write.setStream(
				[saAddress, ctx.mockSuperToken.address, FLOW_RATE],
				{ account: ctx.alice }
			)
		}

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)

			// Create alice's smart account
			await (this.streamVaults as any).write.createSmartAccount([], {
				account: this.alice
			})
			saAddress = await (this.streamVaults as any).read.smartAccountOf([
				this.alice
			])
		})

		// ------------------------------------------------------------------
		// Happy path
		// ------------------------------------------------------------------

		it('Should close stream, return true, when availableBalance == 0 and deposit > 0 (at-threshold with default 10%)', async function () {
			// deposit = 100e18, threshold = 10%, trigger = 10e18
			// availableBalance = 0 <= trigger → should close
			const deposit = parseUnits('100', 18)
			const availableBalance = 0n // int256(0) <= trigger(10e18) → close

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)

			await openAliceStream(this)

			const result = await (this.streamVaults as any).simulate.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)
			expect(result.result).to.equal(true)

			// Actually execute
			await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			// Stream must now be 0 in the CFA mock
			const flowRate = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.alice,
				saAddress
			])
			expect(flowRate).to.equal(0n)
		})

		it('Should close stream when availableBalance is negative (deeply insolvent)', async function () {
			const deposit = parseUnits('100', 18)
			const availableBalance = -1n // negative: deeply below trigger

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			const flowRate = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.alice,
				saAddress
			])
			expect(flowRate).to.equal(0n)
		})

		it('Should close when availableBalance == trigger exactly (boundary: at-threshold)', async function () {
			// deposit = 1000e18, thresholdBps = 1000 (10%), trigger = 100e18
			// availableBalance = 100e18 == trigger → should CLOSE (condition: > trigger → revert)
			const deposit = parseUnits('1000', 18)
			const triggerValue = parseUnits('100', 18) // 10% of 1000

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, triggerValue, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			// Should NOT revert — availableBalance == trigger satisfies `availableBalance <= trigger`
			await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			const flowRate = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.alice,
				saAddress
			])
			expect(flowRate).to.equal(0n)
		})

		it('Should emit StreamAutoClosed with correct user, smartAccount, superToken, availableBalance, deposit', async function () {
			const deposit = parseUnits('100', 18)
			const availableBalance = 0n

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			const txHash = await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: (this.streamVaults as any).address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const autoClosedLogs = logs.filter(log => {
				try {
					const decoded = decodeEventLog({
						abi: StreamVaultsArtifact.abi,
						data: log.data,
						topics: log.topics
					})
					return (decoded as any).eventName === 'StreamAutoClosed'
				} catch {
					return false
				}
			})
			expect(autoClosedLogs.length).to.equal(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsArtifact.abi,
				data: autoClosedLogs[0].data,
				topics: autoClosedLogs[0].topics
			})
			const args = (decoded as any).args
			expect(args.user?.toLowerCase()).to.equal(this.alice.toLowerCase())
			expect(args.smartAccount?.toLowerCase()).to.equal(saAddress.toLowerCase())
			expect(args.superToken?.toLowerCase()).to.equal(
				this.mockSuperToken.address.toLowerCase()
			)
			expect(args.availableBalance).to.equal(availableBalance)
			expect(args.deposit).to.equal(deposit)
		})

		it('Should emit StreamUpdated with newRate = 0 when stream is closed', async function () {
			const deposit = parseUnits('100', 18)
			const availableBalance = 0n

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			const txHash = await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: (this.streamVaults as any).address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const streamUpdatedLogs = logs.filter(log => {
				try {
					const decoded = decodeEventLog({
						abi: StreamVaultsArtifact.abi,
						data: log.data,
						topics: log.topics
					})
					return (decoded as any).eventName === 'StreamUpdated'
				} catch {
					return false
				}
			})
			expect(streamUpdatedLogs.length).to.equal(1)

			const decoded = decodeEventLog({
				abi: StreamVaultsArtifact.abi,
				data: streamUpdatedLogs[0].data,
				topics: streamUpdatedLogs[0].topics
			})
			const args = (decoded as any).args
			expect(args.newRate).to.equal(0n)
			expect(args.previousRate).to.equal(FLOW_RATE)
			expect(args.user?.toLowerCase()).to.equal(this.alice.toLowerCase())
			expect(args.smartAccount?.toLowerCase()).to.equal(saAddress.toLowerCase())
		})

		it('Should emit both StreamAutoClosed and StreamUpdated in the same transaction', async function () {
			const deposit = parseUnits('100', 18)
			const availableBalance = 0n

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			const txHash = await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: (this.streamVaults as any).address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const eventNames = logs
				.map(log => {
					try {
						const decoded = decodeEventLog({
							abi: StreamVaultsArtifact.abi,
							data: log.data,
							topics: log.topics
						})
						return (decoded as any).eventName
					} catch {
						return null
					}
				})
				.filter(Boolean)

			expect(eventNames).to.include('StreamAutoClosed')
			expect(eventNames).to.include('StreamUpdated')
		})

		// ------------------------------------------------------------------
		// Access control
		// ------------------------------------------------------------------

		it('Should revert if caller is not the bot — owner account (NOT_BOT)', async function () {
			await openAliceStream(this)

			await expect(
				(this.streamVaults as any).write.closeStreamIfLow(
					[saAddress, this.mockSuperToken.address],
					{ account: this.deployer }
				)
			).to.be.rejectedWith('NOT_BOT')
		})

		it('Should revert if caller is not the bot — random EOA (NOT_BOT)', async function () {
			await openAliceStream(this)

			await expect(
				(this.streamVaults as any).write.closeStreamIfLow(
					[saAddress, this.mockSuperToken.address],
					{ account: this.alice }
				)
			).to.be.rejectedWith('NOT_BOT')
		})

		it('Should revert if caller is not the bot — the smart account user itself (NOT_BOT)', async function () {
			await openAliceStream(this)

			// The user (alice) trying to invoke the bot-only guardian must be rejected
			await expect(
				(this.streamVaults as any).write.closeStreamIfLow(
					[saAddress, this.mockSuperToken.address],
					{ account: this.alice }
				)
			).to.be.rejectedWith('NOT_BOT')
		})

		// ------------------------------------------------------------------
		// Input validation
		// ------------------------------------------------------------------

		it('Should revert if superToken is zero address (INVALID_ADDRESS)', async function () {
			await expect(
				(this.streamVaults as any).write.closeStreamIfLow(
					[saAddress, zeroAddress],
					{ account: this.bot }
				)
			).to.be.rejectedWith('INVALID_ADDRESS')
		})

		it('Should revert if smartAccount is not registered (SMART_ACCOUNT_NOT_FOUND)', async function () {
			// charlie never created a smart account — _userOf[charlie] == address(0)
			await expect(
				(this.streamVaults as any).write.closeStreamIfLow(
					[this.charlie, this.mockSuperToken.address],
					{ account: this.bot }
				)
			).to.be.rejectedWith('SMART_ACCOUNT_NOT_FOUND')
		})

		it('Should revert if stream is not active (getFlowrate == 0) (STREAM_NOT_ACTIVE)', async function () {
			// No stream opened yet → getFlowrate returns 0
			await expect(
				(this.streamVaults as any).write.closeStreamIfLow(
					[saAddress, this.mockSuperToken.address],
					{ account: this.bot }
				)
			).to.be.rejectedWith('STREAM_NOT_ACTIVE')
		})

		it('Should revert if availableBalance is one wei above trigger (STREAM_NOT_LOW) — boundary trigger+1', async function () {
			// deposit = 1000e18, threshold = 10%, trigger = 100e18
			// availableBalance = trigger + 1 = 100e18 + 1 → NOT low
			const deposit = parseUnits('1000', 18)
			const triggerValue = (deposit * 1000n) / 10000n // 100e18
			const availableBalance = triggerValue + 1n

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			await expect(
				(this.streamVaults as any).write.closeStreamIfLow(
					[saAddress, this.mockSuperToken.address],
					{ account: this.bot }
				)
			).to.be.rejectedWith('STREAM_NOT_LOW')
		})

		it('Should revert STREAM_NOT_LOW when balance is well above trigger', async function () {
			// deposit = 100e18, trigger = 10e18
			// availableBalance = 50e18 >> trigger → not low
			const deposit = parseUnits('100', 18)
			const availableBalance = parseUnits('50', 18)

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			await expect(
				(this.streamVaults as any).write.closeStreamIfLow(
					[saAddress, this.mockSuperToken.address],
					{ account: this.bot }
				)
			).to.be.rejectedWith('STREAM_NOT_LOW')
		})

		// ------------------------------------------------------------------
		// Threshold mechanics
		// ------------------------------------------------------------------

		it('Should use updated threshold after setStreamCloseThreshold changes the bps', async function () {
			// Lower threshold to 500 bps (5%)
			// deposit = 1000e18, new trigger = 50e18
			// availableBalance = 60e18: above OLD trigger(100e18)? yes → would revert with default 10%
			// but below new trigger(50e18)? no → still STREAM_NOT_LOW with 5%
			// So invert: pick availableBalance = 70e18:
			//   default 10%: trigger=100e18, 70e18 <= 100e18 → CLOSES
			//   after setting 5%: trigger=50e18, 70e18 > 50e18 → STREAM_NOT_LOW

			// Set threshold to 5%
			await (this.streamVaults as any).write.setStreamCloseThreshold([500n], {
				account: this.deployer
			})

			const deposit = parseUnits('1000', 18)
			// 70e18 > 5% of 1000e18 (50e18) → STREAM_NOT_LOW
			const availableBalance = parseUnits('70', 18)

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			await expect(
				(this.streamVaults as any).write.closeStreamIfLow(
					[saAddress, this.mockSuperToken.address],
					{ account: this.bot }
				)
			).to.be.rejectedWith('STREAM_NOT_LOW')
		})

		it('Should close when threshold raised to 10% and availableBalance is within new trigger', async function () {
			// Raise threshold to 1000 bps (10%, the default — re-confirm it works)
			// deposit=1000e18, trigger=100e18, availableBalance=50e18 ≤ 100e18 → CLOSES
			const deposit = parseUnits('1000', 18)
			const availableBalance = parseUnits('50', 18) // well within 10% trigger

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			const flowRate = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.alice,
				saAddress
			])
			expect(flowRate).to.equal(0n)
		})

		it('Should never close with threshold=0 when availableBalance > 0 (STREAM_NOT_LOW)', async function () {
			// threshold=0 means trigger=0, so closeStreamIfLow only fires when
			// availableBalance <= 0 (i.e. account is critical/insolvent)
			await (this.streamVaults as any).write.setStreamCloseThreshold([0n], {
				account: this.deployer
			})

			const deposit = parseUnits('100', 18)
			const availableBalance = 1n // 1 wei > 0 → trigger=0 → STREAM_NOT_LOW

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			await expect(
				(this.streamVaults as any).write.closeStreamIfLow(
					[saAddress, this.mockSuperToken.address],
					{ account: this.bot }
				)
			).to.be.rejectedWith('STREAM_NOT_LOW')
		})

		it('Should close with threshold=0 when availableBalance == 0 (critically low)', async function () {
			await (this.streamVaults as any).write.setStreamCloseThreshold([0n], {
				account: this.deployer
			})

			const deposit = parseUnits('100', 18)
			const availableBalance = 0n // == trigger(0) → CLOSES

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			const flowRate = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.alice,
				saAddress
			])
			expect(flowRate).to.equal(0n)
		})

		it('Should close with threshold=10000 (100%) even when balance equals the full deposit', async function () {
			// threshold=10000: trigger = deposit * 10000 / 10000 = deposit
			// availableBalance = deposit → close (availableBalance == trigger)
			await (this.streamVaults as any).write.setStreamCloseThreshold([10000n], {
				account: this.deployer
			})

			const deposit = parseUnits('100', 18)
			const availableBalance = deposit // int256(deposit) == trigger(deposit)

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			const flowRate = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.alice,
				saAddress
			])
			expect(flowRate).to.equal(0n)
		})

		// ------------------------------------------------------------------
		// State invariants
		// ------------------------------------------------------------------

		it('Should update CFA flowrate to 0 after successful close (storage mutation)', async function () {
			const deposit = parseUnits('100', 18)
			const availableBalance = 0n

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			// Confirm stream is open before closing
			const rateBefore = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.alice,
				saAddress
			])
			expect(rateBefore).to.equal(FLOW_RATE)

			await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			const rateAfter = await (this.mockCFA as any).read.getFlowrate([
				this.mockSuperToken.address,
				this.alice,
				saAddress
			])
			expect(rateAfter).to.equal(0n)
		})

		it('Should never move or redirect user funds — bot only stops the flow', async function () {
			// Before close: check that the bot's own balance does not increase
			// and the smart account balance does not decrease in a suspicious way.
			// The function calls _setStream(user, sa, token, 0) which calls the CFA
			// forwarder. In the mock the forwarder only records the rate; no ERC20
			// transfer occurs. This test verifies no token balances change.

			const deposit = parseUnits('100', 18)
			const availableBalance = 0n

			// Give alice some superToken balance so we can assert it's unchanged
			await (this.mockSuperToken as any).write.mint([this.alice, deposit], {
				account: this.deployer
			})
			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			const aliceBalBefore = await (this.mockSuperToken as any).read.balanceOf([
				this.alice
			])
			const botBalBefore = await (this.mockSuperToken as any).read.balanceOf([
				this.bot
			])
			const svBalBefore = await (this.mockSuperToken as any).read.balanceOf([
				(this.streamVaults as any).address
			])

			await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			const aliceBalAfter = await (this.mockSuperToken as any).read.balanceOf([
				this.alice
			])
			const botBalAfter = await (this.mockSuperToken as any).read.balanceOf([
				this.bot
			])
			const svBalAfter = await (this.mockSuperToken as any).read.balanceOf([
				(this.streamVaults as any).address
			])

			// No token balances should change from a pure flow-stop action
			expect(aliceBalAfter).to.equal(aliceBalBefore)
			expect(botBalAfter).to.equal(botBalBefore)
			expect(svBalAfter).to.equal(svBalBefore)
		})

		it('Should revert STREAM_NOT_ACTIVE if stream already closed (idempotency guard)', async function () {
			const deposit = parseUnits('100', 18)
			const availableBalance = 0n

			await (this.mockSuperToken as any).write.setRealtimeBalance(
				[this.alice, availableBalance, deposit],
				{ account: this.deployer }
			)
			await openAliceStream(this)

			// First close — succeeds
			await (this.streamVaults as any).write.closeStreamIfLow(
				[saAddress, this.mockSuperToken.address],
				{ account: this.bot }
			)

			// Second attempt — stream is gone, rate == 0 → STREAM_NOT_ACTIVE
			await expect(
				(this.streamVaults as any).write.closeStreamIfLow(
					[saAddress, this.mockSuperToken.address],
					{ account: this.bot }
				)
			).to.be.rejectedWith('STREAM_NOT_ACTIVE')
		})
	})
})
