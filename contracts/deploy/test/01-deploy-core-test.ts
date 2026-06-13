import { ethers, upgrades } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

/// @dev Deploys the full protocol stack using mock addresses for Permit2 and
///      the CFAv1 Forwarder. Tagged 'test' only.
const deployCoreTest: DeployFunction = async function (
	hre: HardhatRuntimeEnvironment
) {
	const { deployments, getNamedAccounts } = hre
	const { log, getOrNull } = deployments
	const { deployer, bot } = await getNamedAccounts()

	log('--- Deploying core contracts (test) ---')

	// Retrieve mock addresses deployed in the previous step.
	const mockCFA = await getOrNull('MockCFAv1Forwarder')
	if (!mockCFA) throw new Error('MockCFAv1Forwarder not deployed')

	const mockRouter = await getOrNull('MockUniswapRouter')
	if (!mockRouter) throw new Error('MockUniswapRouter not deployed')

	// Permit2: a real MockPermit2 (records approve) so the SmartAccountDCA's
	// Permit2 allowance grant is exercised — not the router address (whose
	// fallback would mis-trigger a swap on the approve call).
	const mockPermit2 = await getOrNull('MockPermit2')
	if (!mockPermit2) throw new Error('MockPermit2 not deployed')
	const PERMIT2_STUB = mockPermit2.address

	// 1. SmartAccountDCA implementation
	const saImpl = await getOrNull('SmartAccountDCA')
	if (!saImpl) {
		throw new Error(
			'SmartAccountDCA impl not deployed. Run the smart-account-impl tag first.'
		)
	}

	// 2. StreamVaultsConfig (UUPS)
	const MIN_STREAM_ACCUMULATION_WINDOW = 86_400 // 1 day in seconds (default)
	const configFactory = await ethers.getContractFactory('StreamVaultsConfig')
	const configProxy = await upgrades.deployProxy(
		configFactory,
		[
			deployer,
			bot,
			saImpl.address,
			PERMIT2_STUB,
			mockCFA.address,
			MIN_STREAM_ACCUMULATION_WINDOW
		],
		{ kind: 'uups' }
	)
	await configProxy.waitForDeployment()
	const configAddress = await configProxy.getAddress()
	log(`StreamVaultsConfig proxy (test): ${configAddress}`)

	const configArtifact = await deployments.getArtifact('StreamVaultsConfig')
	await deployments.save('StreamVaultsConfig', {
		abi: configArtifact.abi,
		address: configAddress
	})

	// 3. StreamVaults (UUPS)
	const svFactory = await ethers.getContractFactory('StreamVaults')
	const svProxy = await upgrades.deployProxy(
		svFactory,
		[deployer, configAddress],
		{ kind: 'uups' }
	)
	await svProxy.waitForDeployment()
	const svAddress = await svProxy.getAddress()
	log(`StreamVaults proxy (test): ${svAddress}`)

	const svArtifact = await deployments.getArtifact('StreamVaults')
	await deployments.save('StreamVaults', {
		abi: svArtifact.abi,
		address: svAddress
	})

	// 4. Whitelist the mock router as allowed target + swap tokens
	const mockUsdc = await getOrNull('MockERC20Permit')
	const mockWeth = await getOrNull('MockMintableERC20')
	if (!mockUsdc || !mockWeth || !mockRouter)
		throw new Error('Mock tokens not deployed')

	const configContract = await ethers.getContractAt(
		'StreamVaultsConfig',
		configAddress
	)
	await (await configContract.setAllowedTarget(mockRouter.address, true)).wait()
	await (
		await configContract.setSupportedSwapToken(mockUsdc.address, true)
	).wait()
	await (
		await configContract.setSupportedSwapToken(mockWeth.address, true)
	).wait()
	log(`Whitelisted router + tokens in config`)

	// 5. SmartAccountRegistry
	const registryResult = await deployments.deploy('SmartAccountRegistry', {
		from: deployer,
		args: [svAddress],
		log: true
	})
	log(`SmartAccountRegistry (test): ${registryResult.address}`)
}

export default deployCoreTest
deployCoreTest.tags = ['test', 'core-test']
deployCoreTest.dependencies = ['test-mocks', 'smart-account-impl']
deployCoreTest.id = 'core-test'
