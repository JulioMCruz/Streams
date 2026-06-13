import { deployments, ethers, network } from 'hardhat'

import { developmentChains } from '@/config/const'
import { verify } from '@/helpers/verify'

/**
 * Deploys the fixed SmartAccountDCA implementation (adds the Permit2 spender
 * approval so Universal Router swaps stop reverting with SWAP_CALL_FAILED) and
 * points StreamVaultsConfig at it. Existing EIP-1167 clones are immutable and
 * keep the old impl — only smart accounts created AFTER this use the fix.
 *
 * Run: yarn hardhat run scripts/upgrade-smart-account-impl.ts --network baseMainnet
 */
async function main() {
	console.log(`[sa-impl] network: ${network.name}`)

	const Factory = await ethers.getContractFactory('SmartAccountDCA')
	console.log('[sa-impl] deploying new SmartAccountDCA implementation...')
	const impl = await Factory.deploy()
	await impl.waitForDeployment()
	const implAddr = await impl.getAddress()
	console.log(`[sa-impl] new implementation: ${implAddr}`)

	const configDep = await deployments.get('StreamVaultsConfig')
	const config = await ethers.getContractAt(
		'StreamVaultsConfig',
		configDep.address
	)
	const prev: string = await config.smartAccountImplementation()
	console.log(`[sa-impl] config: ${configDep.address}`)
	console.log(`[sa-impl] previous impl: ${prev}`)

	const tx = await config.setSmartAccountImplementation(implAddr)
	console.log(`[sa-impl] setSmartAccountImplementation tx: ${tx.hash} — waiting...`)
	await tx.wait()
	console.log('[sa-impl] config now points at the fixed implementation')

	const artifact = await deployments.getArtifact('SmartAccountDCA')
	await deployments.save('SmartAccountDCA', {
		abi: artifact.abi,
		address: implAddr
	})

	if (!developmentChains.includes(network.name)) {
		await verify(implAddr, [])
	}

	console.log('[sa-impl] done')
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
