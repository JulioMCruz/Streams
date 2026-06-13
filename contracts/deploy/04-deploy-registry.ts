import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

import { developmentChains, networkConfig } from '@/config/const'
import { verify } from '@/helpers/verify'

const deployRegistry: DeployFunction = async function (
	hre: HardhatRuntimeEnvironment
) {
	const { deployments, getNamedAccounts, network } = hre
	const { deploy, log, getOrNull } = deployments
	const { deployer } = await getNamedAccounts()

	log('----------------------------------------------------')
	log('Deploying SmartAccountRegistry...')

	const streamVaults = await getOrNull('StreamVaults')
	if (!streamVaults) {
		throw new Error('StreamVaults not deployed yet')
	}

	const result = await deploy('SmartAccountRegistry', {
		from: deployer,
		args: [streamVaults.address],
		log: true,
		waitConfirmations: networkConfig[network.name]?.blockConfirmations ?? 1
	})

	log(`SmartAccountRegistry deployed at ${result.address}`)
	log(`  streamVaults: ${streamVaults.address}`)

	if (!developmentChains.includes(network.name) && result.newlyDeployed) {
		await verify(result.address, [streamVaults.address])
	}
}

export default deployRegistry
deployRegistry.tags = ['deploy', 'registry', 'core']
deployRegistry.dependencies = ['streamvaults']
deployRegistry.id = 'smart-account-registry'
