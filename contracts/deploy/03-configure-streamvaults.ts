import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

import { getProtocolAddresses } from '@/config/const'

const configureStreamVaults: DeployFunction = async function (
	hre: HardhatRuntimeEnvironment
) {
	const { deployments } = hre
	const { log, getOrNull } = deployments

	log('----------------------------------------------------')
	log('Configuring StreamVaultsConfig whitelists...')

	const configDeployment = await getOrNull('StreamVaultsConfig')
	if (!configDeployment) {
		throw new Error('StreamVaultsConfig not deployed yet')
	}

	const chainId = Number((await ethers.provider.getNetwork()).chainId)
	const addresses = getProtocolAddresses(chainId)

	const configContract = await ethers.getContractAt(
		'StreamVaultsConfig',
		configDeployment.address
	)

	log(`  allowedTargets  : ${addresses.allowedTargets.join(', ')}`)
	log(`  tokens          : ${Object.values(addresses.tokens).join(', ')}`)

	for (const target of addresses.allowedTargets) {
		if (!(await configContract.isAllowedTarget(target))) {
			const tx = await configContract.setAllowedTarget(target, true)
			await tx.wait()
			log(`  → whitelisted target ${target}`)
		} else {
			log(`  → target ${target} already whitelisted`)
		}
	}

	for (const [symbol, token] of Object.entries(addresses.tokens)) {
		if (!(await configContract.isSupportedSwapToken(token))) {
			const tx = await configContract.setSupportedSwapToken(token, true)
			await tx.wait()
			log(`  → enabled ${symbol.toUpperCase()} as swap token`)
		} else {
			log(`  → ${symbol.toUpperCase()} already supported`)
		}
	}

	log('Configuration complete')
}

export default configureStreamVaults
configureStreamVaults.tags = ['deploy', 'configure', 'core']
configureStreamVaults.dependencies = ['streamvaults-config']
configureStreamVaults.id = 'configure-streamvaults'
configureStreamVaults.runAtTheEnd = true
