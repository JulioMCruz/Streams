import { expect } from 'chai'
import hre from 'hardhat'
import {
	Address,
	decodeAbiParameters,
	decodeEventLog,
	encodeAbiParameters,
	keccak256,
	parseAbiParameters,
	toBytes,
	zeroAddress
} from 'viem'

import SmartAccountRegistryArtifact from '../artifacts/contracts/core/SmartAccountRegistry/SmartAccountRegistry.sol/SmartAccountRegistry.json'
import {
	deployTestFixture,
	SmartAccountRegistryContract,
	StreamVaultsContract,
	TestFixture
} from './helpers/fixtures'

// Helper to create a SA for a user
async function createSmartAccount(
	sv: StreamVaultsContract,
	user: Address
): Promise<Address> {
	await (sv as any).write.createSmartAccount([], { account: user })
	return (sv as any).read.smartAccountOf([user]) as Promise<Address>
}

// Build DNS-encoded name for ENSIP-10 tests: <label>.<parent>
// Format: 1-byte length + label bytes + 1-byte length + parent bytes + 0x00
function encodeDnsName(
	label: string,
	parent: string = 'streamvault'
): `0x${string}` {
	const labelBytes = toBytes(label)
	const parentBytes = toBytes(parent)
	const encoded = new Uint8Array(
		1 + labelBytes.length + 1 + parentBytes.length + 1
	)
	let offset = 0
	encoded[offset++] = labelBytes.length
	encoded.set(labelBytes, offset)
	offset += labelBytes.length
	encoded[offset++] = parentBytes.length
	encoded.set(parentBytes, offset)
	offset += parentBytes.length
	encoded[offset] = 0
	return `0x${Buffer.from(encoded).toString('hex')}`
}

// Build call data for resolve() tests
function buildAddrCalldata(node: `0x${string}`): `0x${string}` {
	// addr(bytes32) selector = 0x3b3b57de
	return `0x3b3b57de${node.slice(2)}`
}

function buildTextCalldata(node: `0x${string}`, key: string): `0x${string}` {
	// text(bytes32,string) selector = 0x59d1d43c
	const encoded = encodeAbiParameters(
		[{ type: 'bytes32' }, { type: 'string' }],
		[node as `0x${string}`, key]
	)
	return `0x59d1d43c${encoded.slice(2)}`
}

// ABI-decode the result of resolve() for a text record: returns the decoded string
function decodeResolveText(result: `0x${string}`): string {
	const [decoded] = decodeAbiParameters(parseAbiParameters('string'), result)
	return decoded
}

// ABI-decode the result of resolve() for an addr record: returns the address
function decodeResolveAddr(result: `0x${string}`): string {
	const [decoded] = decodeAbiParameters(parseAbiParameters('address'), result)
	return (decoded as string).toLowerCase()
}

describe('SmartAccountRegistry', function () {
	// =========================================================================
	// FIXTURE
	// =========================================================================

	async function deployFixture(): Promise<TestFixture> {
		return deployTestFixture()
	}

	// =========================================================================
	// MÓDULO: constructor
	// =========================================================================

	describe('constructor', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should store streamVaults address as immutable', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			const sv = await (reg as any).read.streamVaults()
			expect(sv.toLowerCase()).to.equal(this.streamVaults.address.toLowerCase())
		})
	})

	// =========================================================================
	// MÓDULO: register
	// =========================================================================

	describe('register', function () {
		let saAlice: Address

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
			saAlice = await createSmartAccount(this.streamVaults, this.alice)
		})

		it('Should register a label for a smart account', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract

			await (reg as any).write.register([saAlice, 'alice-bot'], {
				account: this.alice
			})

			const resolved = await (reg as any).read.smartAccountOf(['alice-bot'])
			expect(resolved.toLowerCase()).to.equal(saAlice.toLowerCase())

			const label = await (reg as any).read.labelOf([saAlice])
			expect(label).to.equal('alice-bot')
		})

		it('Should emit NameRegistered with correct params', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract

			const txHash = await (reg as any).write.register([saAlice, 'alice-bot'], {
				account: this.alice
			})
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: (reg as any).address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const registeredLogs = logs.filter(log => {
				try {
					const decoded = decodeEventLog({
						abi: SmartAccountRegistryArtifact.abi,
						data: log.data,
						topics: log.topics
					})
					return (decoded as any).eventName === 'NameRegistered'
				} catch {
					return false
				}
			})
			expect(registeredLogs.length).to.equal(1)

			const decoded = decodeEventLog({
				abi: SmartAccountRegistryArtifact.abi,
				data: registeredLogs[0].data,
				topics: registeredLogs[0].topics
			})
			expect((decoded as any).args.smartAccount?.toLowerCase()).to.equal(
				saAlice.toLowerCase()
			)
			// The NameRegistered event uses 'user' (not 'owner') as the field name
			expect((decoded as any).args.user?.toLowerCase()).to.equal(
				this.alice.toLowerCase()
			)
			expect((decoded as any).args.label).to.equal('alice-bot')
		})

		it('Should revert if label is empty string', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			await expect(
				(reg as any).write.register([saAlice, ''], {
					account: this.alice
				})
			).to.be.rejectedWith('INVALID_LABEL')
		})

		it('Should revert if caller is not the smart account owner', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			await expect(
				(reg as any).write.register([saAlice, 'alice-bot'], {
					account: this.bob
				})
			).to.be.rejectedWith('NOT_SMART_ACCOUNT_OWNER')
		})

		it('Should revert if smart account is already registered (NAME_ALREADY_REGISTERED)', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			await (reg as any).write.register([saAlice, 'alice-bot'], {
				account: this.alice
			})
			await expect(
				(reg as any).write.register([saAlice, 'alice-bot-2'], {
					account: this.alice
				})
			).to.be.rejectedWith('NAME_ALREADY_REGISTERED')
		})

		it('Should revert if label is already taken by another smart account (LABEL_TAKEN)', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			const saBob = await createSmartAccount(this.streamVaults, this.bob)

			// Alice registers 'taken-label'
			await (reg as any).write.register([saAlice, 'taken-label'], {
				account: this.alice
			})

			// Bob tries to register the same label
			await expect(
				(reg as any).write.register([saBob, 'taken-label'], {
					account: this.bob
				})
			).to.be.rejectedWith('LABEL_TAKEN')
		})
	})

	// =========================================================================
	// MÓDULO: release
	// =========================================================================

	describe('release', function () {
		let saAlice: Address

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
			saAlice = await createSmartAccount(this.streamVaults, this.alice)
		})

		it('Should release a registered name', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract

			await (reg as any).write.register([saAlice, 'alice-bot'], {
				account: this.alice
			})
			await (reg as any).write.release([saAlice], {
				account: this.alice
			})

			const label = await (reg as any).read.labelOf([saAlice])
			expect(label).to.equal('')
			const resolved = await (reg as any).read.smartAccountOf(['alice-bot'])
			expect(resolved).to.equal(zeroAddress)
		})

		it('Should emit NameReleased with correct params', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract

			await (reg as any).write.register([saAlice, 'alice-bot'], {
				account: this.alice
			})
			const txHash = await (reg as any).write.release([saAlice], {
				account: this.alice
			})
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: (reg as any).address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const releasedLogs = logs.filter(log => {
				try {
					const decoded = decodeEventLog({
						abi: SmartAccountRegistryArtifact.abi,
						data: log.data,
						topics: log.topics
					})
					return (decoded as any).eventName === 'NameReleased'
				} catch {
					return false
				}
			})
			expect(releasedLogs.length).to.equal(1)

			const decoded = decodeEventLog({
				abi: SmartAccountRegistryArtifact.abi,
				data: releasedLogs[0].data,
				topics: releasedLogs[0].topics
			})
			expect((decoded as any).args.smartAccount?.toLowerCase()).to.equal(
				saAlice.toLowerCase()
			)
			expect((decoded as any).args.label).to.equal('alice-bot')
		})

		it('Should allow re-registration of a released label', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			const saBob = await createSmartAccount(this.streamVaults, this.bob)

			await (reg as any).write.register([saAlice, 'shared-label'], {
				account: this.alice
			})
			await (reg as any).write.release([saAlice], { account: this.alice })

			// Bob can now claim the same label
			await (reg as any).write.register([saBob, 'shared-label'], {
				account: this.bob
			})
			const resolved = await (reg as any).read.smartAccountOf(['shared-label'])
			expect(resolved.toLowerCase()).to.equal(saBob.toLowerCase())
		})

		it('Should revert if caller is not the smart account owner', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract

			await (reg as any).write.register([saAlice, 'alice-bot'], {
				account: this.alice
			})
			await expect(
				(reg as any).write.release([saAlice], { account: this.bob })
			).to.be.rejectedWith('NOT_SMART_ACCOUNT_OWNER')
		})

		it('Should revert if name is not found (NAME_NOT_FOUND)', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			// saAlice is not registered
			await expect(
				(reg as any).write.release([saAlice], { account: this.alice })
			).to.be.rejectedWith('NAME_NOT_FOUND')
		})
	})

	// =========================================================================
	// MÓDULO: setText
	// =========================================================================

	describe('setText', function () {
		let saAlice: Address

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
			saAlice = await createSmartAccount(this.streamVaults, this.alice)

			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			await (reg as any).write.register([saAlice, 'alice-bot'], {
				account: this.alice
			})
		})

		it('Should set a text record for a registered label', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract

			await (reg as any).write.setText(['alice-bot', 'twitter', '@alice'], {
				account: this.alice
			})

			const value = await (reg as any).read.textOf(['alice-bot', 'twitter'])
			expect(value).to.equal('@alice')
		})

		it('Should emit TextSet event', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract

			const txHash = await (reg as any).write.setText(
				['alice-bot', 'url', 'https://alice.example'],
				{ account: this.alice }
			)
			const publicClient = await hre.viem.getPublicClient()
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash
			})

			const logs = await publicClient.getLogs({
				address: (reg as any).address as Address,
				fromBlock: receipt.blockNumber,
				toBlock: receipt.blockNumber
			})

			const textLogs = logs.filter(log => {
				try {
					const decoded = decodeEventLog({
						abi: SmartAccountRegistryArtifact.abi,
						data: log.data,
						topics: log.topics
					})
					return (decoded as any).eventName === 'TextSet'
				} catch {
					return false
				}
			})
			expect(textLogs.length).to.equal(1)
		})

		it('Should overwrite an existing text record', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract

			await (reg as any).write.setText(['alice-bot', 'twitter', '@alice_v1'], {
				account: this.alice
			})
			await (reg as any).write.setText(['alice-bot', 'twitter', '@alice_v2'], {
				account: this.alice
			})

			const value = await (reg as any).read.textOf(['alice-bot', 'twitter'])
			expect(value).to.equal('@alice_v2')
		})

		it('Should revert if label is not registered (NAME_NOT_FOUND)', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			await expect(
				(reg as any).write.setText(['unknown-label', 'key', 'value'], {
					account: this.alice
				})
			).to.be.rejectedWith('NAME_NOT_FOUND')
		})

		it('Should revert if caller is not the smart account owner', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			await expect(
				(reg as any).write.setText(['alice-bot', 'key', 'value'], {
					account: this.bob
				})
			).to.be.rejectedWith('NOT_SMART_ACCOUNT_OWNER')
		})
	})

	// =========================================================================
	// MÓDULO: resolve (ENSIP-10)
	// =========================================================================

	describe('resolve (ENSIP-10)', function () {
		let saAlice: Address

		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
			saAlice = await createSmartAccount(this.streamVaults, this.alice)

			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			await (reg as any).write.register([saAlice, 'alice'], {
				account: this.alice
			})
			await (reg as any).write.setText(
				['alice', 'twitter', '@alice_on_chain'],
				{ account: this.alice }
			)
		})

		it('Should return smart account address for addr(bytes32) selector', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			const dnsName = encodeDnsName('alice')
			const node = keccak256(toBytes('alice')) as `0x${string}`
			const calldata = buildAddrCalldata(node)

			const result = await (reg as any).read.resolve([dnsName, calldata])
			// Result is abi.encode(address)
			const decoded = decodeResolveAddr(result)
			expect(decoded).to.equal(saAlice.toLowerCase())
		})

		it('Should return streamvaults:smart-account record via resolve text', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			const dnsName = encodeDnsName('alice')
			const node = keccak256(toBytes('alice')) as `0x${string}`
			const calldata = buildTextCalldata(node, 'streamvaults:smart-account')

			const result = await (reg as any).read.resolve([dnsName, calldata])
			// Result is ABI-encoded string — decode it first
			const decoded = decodeResolveText(result)
			// Contract returns Strings.toHexString(uint160(sa), 20) = "0x<address>"
			expect(decoded.toLowerCase()).to.include(saAlice.slice(2).toLowerCase())
		})

		it('Should return streamvaults:owner record via resolve text', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			const dnsName = encodeDnsName('alice')
			const node = keccak256(toBytes('alice')) as `0x${string}`
			const calldata = buildTextCalldata(node, 'streamvaults:owner')

			const result = await (reg as any).read.resolve([dnsName, calldata])
			const decoded = decodeResolveText(result)
			expect(decoded.toLowerCase()).to.include(
				this.alice.slice(2).toLowerCase()
			)
		})

		it('Should return streamvaults:operator record via resolve text', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			const dnsName = encodeDnsName('alice')
			const node = keccak256(toBytes('alice')) as `0x${string}`
			const calldata = buildTextCalldata(node, 'streamvaults:operator')

			const result = await (reg as any).read.resolve([dnsName, calldata])
			const decoded = decodeResolveText(result)
			expect(decoded.toLowerCase()).to.include(
				this.streamVaults.address.slice(2).toLowerCase()
			)
		})

		it('Should return user-set text record via resolve text', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			const dnsName = encodeDnsName('alice')
			const node = keccak256(toBytes('alice')) as `0x${string}`
			const calldata = buildTextCalldata(node, 'twitter')

			const result = await (reg as any).read.resolve([dnsName, calldata])
			const decoded = decodeResolveText(result)
			expect(decoded).to.include('@alice_on_chain')
		})

		it('Should return empty bytes for unknown selector', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			const dnsName = encodeDnsName('alice')
			// Unknown selector
			const unknownCall = '0xdeadbeef' + '0'.repeat(64)

			const result = await (reg as any).read.resolve([dnsName, unknownCall])
			expect(result).to.equal('0x')
		})

		it('Should return zero address for unregistered name', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			const dnsName = encodeDnsName('unknown-label')
			const node = keccak256(toBytes('unknown-label')) as `0x${string}`
			const calldata = buildAddrCalldata(node)

			const result = await (reg as any).read.resolve([dnsName, calldata])
			const decoded = decodeResolveAddr(result)
			expect(decoded).to.equal(zeroAddress.toLowerCase())
		})

		it('Should return empty bytes for empty DNS name', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			// Empty calldata for resolve(bytes, bytes)
			const node = keccak256(toBytes('')) as `0x${string}`
			const calldata = buildAddrCalldata(node)

			const result = await (reg as any).read.resolve(['0x', calldata])
			// Empty label -> returns address(0)
			expect(result).to.exist
		})
	})

	// =========================================================================
	// MÓDULO: supportsInterface
	// =========================================================================

	describe('supportsInterface', function () {
		beforeEach(async function () {
			const fixture = await deployFixture()
			Object.assign(this, fixture)
		})

		it('Should return true for ENSIP-10 interface (0x9061b923)', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			expect(
				await (reg as any).read.supportsInterface(['0x9061b923'])
			).to.equal(true)
		})

		it('Should return true for ERC-165 interface (0x01ffc9a7)', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			expect(
				await (reg as any).read.supportsInterface(['0x01ffc9a7'])
			).to.equal(true)
		})

		it('Should return false for unknown interface', async function () {
			const reg = this.smartAccountRegistry as SmartAccountRegistryContract
			expect(
				await (reg as any).read.supportsInterface(['0xdeadbeef'])
			).to.equal(false)
		})
	})
})
