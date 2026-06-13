import '@nomicfoundation/hardhat-toolbox-viem'
import '@nomicfoundation/hardhat-verify'
import '@openzeppelin/hardhat-upgrades'
import 'tsconfig-paths/register'
import 'hardhat-deploy'
import '@/task'

import type { HardhatUserConfig } from 'hardhat/config'

import { register } from '@/config/const/env-var'

// Environment variables
/// compilers
const opt012_IR_prague = {
	optimizer: { enabled: true, runs: 200 },
	evmVersion: 'prague',
	viaIR: true
}

const opt012_IR_cancun = {
	optimizer: { enabled: true, runs: 200 },
	evmVersion: 'cancun',
	viaIR: true
}

/// networks
const networks = Object.fromEntries(
	Object.entries(register.networks).map(
		([name, { url, chainId, accounts }]) => [
			name,
			{
				url,
				chainId,
				accounts
			}
		]
	)
)

const config: HardhatUserConfig = {
	defaultNetwork: 'hardhat',

	networks: {
		hardhat: {
			allowUnlimitedContractSize: true,
			// 31337 is Hardhat/Anvil's default local chainId — matches the
			// network wallets like MetaMask already expect for 127.0.0.1:8545.
			chainId: 31337
		},
		...networks
	},

	namedAccounts: {
		deployer: { default: 0 },
		bot: { default: 1 }
	},

	solidity: {
		compilers: [
			{ version: '0.8.30', settings: opt012_IR_prague },
			{ version: '0.8.26', settings: opt012_IR_cancun }
		]
	},

	etherscan: {
		apiKey: register.etherscan.apiKey
	},

	mocha: { timeout: 200000 }
}

export default config
