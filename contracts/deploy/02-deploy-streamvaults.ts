import { ethers, upgrades } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

import { developmentChains } from '@/config/const'
import { saveUpgradeableContractDeploymentInfo } from '@/helpers/upgrades/save-upgradable-contract-deployment-info'
import { verify } from '@/helpers/verify'

const deployStreamVaults: DeployFunction = async function (
	hre: HardhatRuntimeEnvironment
) {
	const { deployments, getNamedAccounts, network } = hre
	const { log, getOrNull } = deployments
	const { deployer } = await getNamedAccounts()

	log('----------------------------------------------------')
	log('Deploying StreamVaults (UUPS)...')

	const config = await getOrNull('StreamVaultsConfig')
	if (!config) {
		throw new Error('StreamVaultsConfig not deployed yet')
	}

	log(`  owner  : ${deployer}`)
	log(`  config : ${config.address}`)

	const factory = await ethers.getContractFactory('StreamVaults')
	const proxy = await upgrades.deployProxy(
		factory,
		[deployer, config.address],
		{ kind: 'uups' }
	)
	await proxy.waitForDeployment()

	const proxyAddress = await proxy.getAddress()
	log(`StreamVaults proxy: ${proxyAddress}`)

	await saveUpgradeableContractDeploymentInfo('StreamVaults', proxy)

	const artifact = await deployments.getArtifact('StreamVaults')
	await deployments.save('StreamVaults', {
		abi: artifact.abi,
		address: proxyAddress
	})

	if (!developmentChains.includes(network.name)) {
		const implAddress =
			await upgrades.erc1967.getImplementationAddress(proxyAddress)
		await verify(implAddress, [])
	}
}

export default deployStreamVaults
deployStreamVaults.tags = ['deploy', 'streamvaults', 'core']
deployStreamVaults.dependencies = ['streamvaults-config']
deployStreamVaults.id = 'streamvaults'
