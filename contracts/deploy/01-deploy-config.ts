import { ethers, upgrades } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

import { developmentChains, getProtocolAddresses } from '@/config/const'
import { register } from '@/config/const/env-var'
import { saveUpgradeableContractDeploymentInfo } from '@/helpers/upgrades/save-upgradable-contract-deployment-info'
import { verify } from '@/helpers/verify'

const deployConfig: DeployFunction = async function (
	hre: HardhatRuntimeEnvironment
) {
	const { deployments, getNamedAccounts, network } = hre
	const { log, getOrNull } = deployments
	const { deployer } = await getNamedAccounts()

	log('----------------------------------------------------')
	log('Deploying StreamVaultsConfig (UUPS)...')

	const smartAccountImpl = await getOrNull('SmartAccountDCA')
	if (!smartAccountImpl) {
		throw new Error('SmartAccountDCA implementation not deployed yet')
	}

	const chainId = Number((await ethers.provider.getNetwork()).chainId)
	const addresses = getProtocolAddresses(chainId)
	const botAddress = register.wallets.bot.address
	const MIN_STREAM_ACCUMULATION_WINDOW = 86_400 // 1 day in seconds (default)

	log(`  owner                       : ${deployer}`)
	log(`  bot                         : ${botAddress}`)
	log(`  smartAccountImpl            : ${smartAccountImpl.address}`)
	log(`  permit2                     : ${addresses.permit2}`)
	log(`  cfaForwarder                : ${addresses.cfaForwarder}`)
	log(`  minStreamAccumulationWindow : ${MIN_STREAM_ACCUMULATION_WINDOW}`)

	const factory = await ethers.getContractFactory('StreamVaultsConfig')
	const proxy = await upgrades.deployProxy(
		factory,
		[
			deployer,
			botAddress,
			smartAccountImpl.address,
			addresses.permit2,
			addresses.cfaForwarder,
			MIN_STREAM_ACCUMULATION_WINDOW
		],
		{ kind: 'uups' }
	)
	await proxy.waitForDeployment()

	const proxyAddress = await proxy.getAddress()
	log(`StreamVaultsConfig proxy: ${proxyAddress}`)

	await saveUpgradeableContractDeploymentInfo('StreamVaultsConfig', proxy)

	const artifact = await deployments.getArtifact('StreamVaultsConfig')
	await deployments.save('StreamVaultsConfig', {
		abi: artifact.abi,
		address: proxyAddress
	})

	if (!developmentChains.includes(network.name)) {
		const implAddress =
			await upgrades.erc1967.getImplementationAddress(proxyAddress)
		await verify(implAddress, [])
	}
}

export default deployConfig
deployConfig.tags = ['deploy', 'streamvaults-config', 'core']
deployConfig.dependencies = ['smart-account-impl']
deployConfig.id = 'streamvaults-config'
