import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

/// @dev Deploys all mock contracts needed for unit/integration tests.
///      Tagged 'test' so production deploy scripts never pull these in.
const deployMocks: DeployFunction = async function (
	hre: HardhatRuntimeEnvironment
) {
	const { deployments, getNamedAccounts } = hre
	const { deploy, log } = deployments
	const { deployer } = await getNamedAccounts()

	log('--- Deploying test mocks ---')

	// 1. Mock underlying ERC20 (simulates USDC: 6 decimals, EIP-2612 permit)
	const mockUsdc = await deploy('MockERC20Permit', {
		from: deployer,
		args: ['Mock USDC', 'mUSDC', 6],
		log: true
	})
	log(`MockERC20Permit (USDC) deployed at ${mockUsdc.address}`)

	// 2. Mock output token (simulates WETH: 18 decimals)
	const mockWeth = await deploy('MockMintableERC20', {
		from: deployer,
		args: ['Mock WETH', 'mWETH'],
		log: true
	})
	log(`MockMintableERC20 (WETH) deployed at ${mockWeth.address}`)

	// 3. Mock SuperToken (wraps MockERC20Permit, 18 dec)
	const mockSuperToken = await deploy('MockSuperToken', {
		from: deployer,
		args: ['Mock USDCx', 'mUSDCx', mockUsdc.address, 6],
		log: true
	})
	log(`MockSuperToken (USDCx) deployed at ${mockSuperToken.address}`)

	// 4. Mock CFAv1 Forwarder (Superfluid stub)
	const mockCFA = await deploy('MockCFAv1Forwarder', {
		from: deployer,
		args: [],
		log: true
	})
	log(`MockCFAv1Forwarder deployed at ${mockCFA.address}`)

	// 5. Mock Uniswap Universal Router
	const mockRouter = await deploy('MockUniswapRouter', {
		from: deployer,
		args: [],
		log: true
	})
	log(`MockUniswapRouter deployed at ${mockRouter.address}`)

	// 6. Mock Permit2 (records approve; SmartAccountDCA grants the router a
	//    Permit2 allowance before swapping).
	const mockPermit2 = await deploy('MockPermit2', {
		from: deployer,
		args: [],
		log: true
	})
	log(`MockPermit2 deployed at ${mockPermit2.address}`)
}

export default deployMocks
deployMocks.tags = ['test', 'mocks']
deployMocks.id = 'test-mocks'
