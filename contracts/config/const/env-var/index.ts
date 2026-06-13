import dotenv from 'dotenv'
import { base, baseSepolia, hardhat } from 'viem/chains'

dotenv.config()

type RegisterEnvVars = {
	etherscan: {
		apiKey: string
	}
	networks: {
		[key: string]: {
			url: string
			chainId: number
			accounts: string[]
		}
	}
	wallets: {
		deployer: {
			address: string
			privateKey: string
		}
		bot: {
			address: string
			privateKey: string
		}
	}
}

/// @dev Hardhat's first well-known test account. Used as a fallback so that
///      tasks like `hardhat compile` work without a populated .env. Never
///      points to real funds.
const HARDHAT_TEST_KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const HARDHAT_TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

function get(envVar: string | undefined, fallback: string): string {
	return envVar && envVar.length > 0 ? envVar : fallback
}

function registerEnvVars(): RegisterEnvVars {
	const {
		ETHERSCAN_API_KEY,
		RPC_HTTPS_BASE_SEPOLIA,
		RPC_HTTPS_BASE_MAINNET,
		WALLET_DEPLOYER_ADDRESS,
		WALLET_DEPLOYER_PRIVATE_KEY,
		WALLET_BOT_ADDRESS,
		WALLET_BOT_PRIVATE_KEY
	} = process.env

	const deployerKey = get(WALLET_DEPLOYER_PRIVATE_KEY, HARDHAT_TEST_KEY)
	const botKey = get(WALLET_BOT_PRIVATE_KEY, HARDHAT_TEST_KEY)
	const accounts: string[] = [deployerKey, botKey]

	return {
		etherscan: {
			apiKey: get(ETHERSCAN_API_KEY, '')
		},

		networks: {
			localhost: {
				url: 'http://127.0.0.1:8545',
				chainId: hardhat.id,
				accounts
			},
			baseSepolia: {
				url: get(RPC_HTTPS_BASE_SEPOLIA, 'https://sepolia.base.org'),
				chainId: baseSepolia.id,
				accounts
			},
			baseMainnet: {
				url: get(RPC_HTTPS_BASE_MAINNET, 'https://mainnet.base.org'),
				chainId: base.id,
				accounts
			}
		},

		wallets: {
			deployer: {
				address: get(WALLET_DEPLOYER_ADDRESS, HARDHAT_TEST_ADDRESS),
				privateKey: deployerKey
			},
			bot: {
				address: get(WALLET_BOT_ADDRESS, HARDHAT_TEST_ADDRESS),
				privateKey: botKey
			}
		}
	}
}

export const register = registerEnvVars()
