import hre, { viem } from 'hardhat'
import { Address, GetContractReturnType, parseUnits } from 'viem'

import SmartAccountRegistryArtifact from '../../artifacts/contracts/core/SmartAccountRegistry/SmartAccountRegistry.sol/SmartAccountRegistry.json'
import StreamVaultsArtifact from '../../artifacts/contracts/core/StreamVaults/StreamVaults.sol/StreamVaults.json'
import StreamVaultsConfigArtifact from '../../artifacts/contracts/core/StreamVaults/StreamVaultsConfig.sol/StreamVaultsConfig.json'
import MockCFAArtifact from '../../artifacts/contracts/mocks/MockCFAv1Forwarder.sol/MockCFAv1Forwarder.json'
import MockERC20PermitArtifact from '../../artifacts/contracts/mocks/MockERC20Permit.sol/MockERC20Permit.json'
import MockPermit2Artifact from '../../artifacts/contracts/mocks/MockPermit2.sol/MockPermit2.json'
import MockSuperTokenArtifact from '../../artifacts/contracts/mocks/MockSuperToken.sol/MockSuperToken.json'
import MockMintableERC20Artifact from '../../artifacts/contracts/mocks/MockUniswapRouter.sol/MockMintableERC20.json'
import MockRouterArtifact from '../../artifacts/contracts/mocks/MockUniswapRouter.sol/MockUniswapRouter.json'
// Contract artifact imports (resolved via typechain/viem from hardhat artifacts)
import SmartAccountDCAArtifact from '../../artifacts/contracts/strategies/dca/SmartAccountDCA.sol/SmartAccountDCA.json'

export type StreamVaultsContract = GetContractReturnType<
	typeof StreamVaultsArtifact.abi
>
export type StreamVaultsConfigContract = GetContractReturnType<
	typeof StreamVaultsConfigArtifact.abi
>
export type SmartAccountDCAContract = GetContractReturnType<
	typeof SmartAccountDCAArtifact.abi
>
export type SmartAccountRegistryContract = GetContractReturnType<
	typeof SmartAccountRegistryArtifact.abi
>
export type MockERC20PermitContract = GetContractReturnType<
	typeof MockERC20PermitArtifact.abi
>
export type MockMintableERC20Contract = GetContractReturnType<
	typeof MockMintableERC20Artifact.abi
>
export type MockSuperTokenContract = GetContractReturnType<
	typeof MockSuperTokenArtifact.abi
>
export type MockCFAContract = GetContractReturnType<typeof MockCFAArtifact.abi>
export type MockRouterContract = GetContractReturnType<
	typeof MockRouterArtifact.abi
>
export type MockPermit2Contract = GetContractReturnType<
	typeof MockPermit2Artifact.abi
>

export interface TestFixture {
	// Named accounts
	deployer: Address
	bot: Address
	alice: Address
	bob: Address
	charlie: Address

	// Core contracts
	streamVaults: StreamVaultsContract
	streamVaultsConfig: StreamVaultsConfigContract
	smartAccountRegistry: SmartAccountRegistryContract

	// Mock contracts
	mockUsdc: MockERC20PermitContract
	mockWeth: MockMintableERC20Contract
	mockSuperToken: MockSuperTokenContract
	mockCFA: MockCFAContract
	mockRouter: MockRouterContract
	mockPermit2: MockPermit2Contract
}

/// @notice Amount constants for test readability
export const USDC_AMOUNT = parseUnits('200', 6) // 200 USDC
export const SUPER_AMOUNT = parseUnits('200', 18) // 200 USDCx
export const FLOW_RATE = 33_333_333_333_333n // ~1 USDCx/30s in wei/sec

/// @notice Default UserRules used across most tests.
export function defaultRules(settlementAddress: Address) {
	return {
		maxSlippageBps: 100,
		minTradeAmount: parseUnits('1', 6),
		settlementAddress,
		targetTokens: [] as Address[] // filled per test
	}
}

/// @notice Deploys (or retrieves) the full test stack using hardhat-deploy tags.
export async function deployTestFixture(): Promise<TestFixture> {
	const { deployments, getNamedAccounts, getUnnamedAccounts } = hre
	const { deployer, bot } = await getNamedAccounts()
	const unnamed = await getUnnamedAccounts()
	const alice = unnamed[0] as Address
	const bob = unnamed[1] as Address
	const charlie = unnamed[2] as Address

	await deployments.fixture(['test'])

	const streamVaultsDeployment = await deployments.get('StreamVaults')
	const streamVaultsConfigDeployment =
		await deployments.get('StreamVaultsConfig')
	const registryDeployment = await deployments.get('SmartAccountRegistry')
	const mockUsdcDeployment = await deployments.get('MockERC20Permit')
	const mockWethDeployment = await deployments.get('MockMintableERC20')
	const mockSuperTokenDeployment = await deployments.get('MockSuperToken')
	const mockCFADeployment = await deployments.get('MockCFAv1Forwarder')
	const mockRouterDeployment = await deployments.get('MockUniswapRouter')
	const mockPermit2Deployment = await deployments.get('MockPermit2')

	const streamVaults = (await viem.getContractAt(
		'StreamVaults',
		streamVaultsDeployment.address as Address
	)) as unknown as StreamVaultsContract

	const streamVaultsConfig = (await viem.getContractAt(
		'StreamVaultsConfig',
		streamVaultsConfigDeployment.address as Address
	)) as unknown as StreamVaultsConfigContract

	const smartAccountRegistry = (await viem.getContractAt(
		'SmartAccountRegistry',
		registryDeployment.address as Address
	)) as unknown as SmartAccountRegistryContract

	const mockUsdc = (await viem.getContractAt(
		'MockERC20Permit',
		mockUsdcDeployment.address as Address
	)) as unknown as MockERC20PermitContract

	const mockWeth = (await viem.getContractAt(
		'MockMintableERC20',
		mockWethDeployment.address as Address
	)) as unknown as MockMintableERC20Contract

	const mockSuperToken = (await viem.getContractAt(
		'MockSuperToken',
		mockSuperTokenDeployment.address as Address
	)) as unknown as MockSuperTokenContract

	const mockCFA = (await viem.getContractAt(
		'MockCFAv1Forwarder',
		mockCFADeployment.address as Address
	)) as unknown as MockCFAContract

	const mockRouter = (await viem.getContractAt(
		'MockUniswapRouter',
		mockRouterDeployment.address as Address
	)) as unknown as MockRouterContract

	const mockPermit2 = (await viem.getContractAt(
		'MockPermit2',
		mockPermit2Deployment.address as Address
	)) as unknown as MockPermit2Contract

	return {
		deployer: deployer as Address,
		bot: bot as Address,
		alice,
		bob,
		charlie,
		streamVaults,
		streamVaultsConfig,
		smartAccountRegistry,
		mockUsdc,
		mockWeth,
		mockSuperToken,
		mockCFA,
		mockRouter,
		mockPermit2
	}
}

/// @notice Decodes an event from publicClient.getLogs using a contract ABI.
///         Use this when `contract.getEvents.EventName()` returns empty arrays
///         due to viem/hardhat-deploy snapshot handling.
export async function getLogsForTx(
	contractAddress: Address,
	txHash: `0x${string}`
): Promise<any[]> {
	const publicClient = await hre.viem.getPublicClient()
	const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
	return publicClient.getLogs({
		address: contractAddress,
		fromBlock: receipt.blockNumber,
		toBlock: receipt.blockNumber
	})
}

/// @notice Signs an EIP-2612 permit for mockUsdc off-chain.
export async function signPermit(params: {
	signer: Address
	token: MockERC20PermitContract
	spender: Address
	value: bigint
	deadline: bigint
	chainId?: number
}) {
	const { signer, token, spender, value, deadline } = params
	const walletClient = await hre.viem.getWalletClient(signer)

	const nonce = await (token as any).read.nonces([signer])
	const name = await (token as any).read.name()
	// Use the live network chainId so the EIP-712 domain matches the
	// contract's block.chainid regardless of the configured local chain.
	const chainId = params.chainId ?? (await walletClient.getChainId())

	const signature = await walletClient.signTypedData({
		account: signer,
		domain: {
			name,
			version: '1',
			chainId,
			verifyingContract: (token as any).address as Address
		},
		types: {
			Permit: [
				{ name: 'owner', type: 'address' },
				{ name: 'spender', type: 'address' },
				{ name: 'value', type: 'uint256' },
				{ name: 'nonce', type: 'uint256' },
				{ name: 'deadline', type: 'uint256' }
			]
		},
		primaryType: 'Permit',
		message: {
			owner: signer,
			spender,
			value,
			nonce,
			deadline
		}
	})

	// Parse v, r, s from signature
	const r = signature.slice(0, 66) as `0x${string}`
	const s = `0x${signature.slice(66, 130)}` as `0x${string}`
	const v = parseInt(signature.slice(130, 132), 16)

	return { v, r, s, deadline }
}
