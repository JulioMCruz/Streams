import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

import { developmentChains, networkConfig } from '@/config/const'
import { verify } from '@/helpers/verify'

const deploySmartAccountImpl: DeployFunction = async function (
	hre: HardhatRuntimeEnvironment
) {
	const { deployments, getNamedAccounts, network } = hre
	const { deploy, log } = deployments
	const { deployer } = await getNamedAccounts()

	log('----------------------------------------------------')
	log('Deploying SmartAccountDCA implementation...')

	const result = await deploy('SmartAccountDCA', {
		from: deployer,
		args: [],
		log: true,
		waitConfirmations: networkConfig[network.name]?.blockConfirmations ?? 1
	})

	log(`SmartAccountDCA impl deployed at ${result.address}`)

	if (!developmentChains.includes(network.name) && result.newlyDeployed) {
		await verify(result.address, [])
	}
}

export default deploySmartAccountImpl
deploySmartAccountImpl.tags = ['deploy', 'smart-account-impl', 'core']
deploySmartAccountImpl.id = 'smart-account-impl'
