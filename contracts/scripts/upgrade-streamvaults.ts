import { deployments, ethers, network, upgrades } from 'hardhat'

import { developmentChains } from '@/config/const'
import { getImplementationAddress } from '@/helpers/upgrades/get-implementation-address'
import { saveUpgradeableContractDeploymentInfo } from '@/helpers/upgrades/save-upgradable-contract-deployment-info'
import { verify } from '@/helpers/verify'

/**
 * Upgrades the StreamVaults UUPS proxy in place (preserves its address + state)
 * to the implementation that adds `closeStreamIfLow` + `setStreamCloseThreshold`.
 *
 * `initialize()` does NOT re-run on a UUPS upgrade, so `_streamCloseThresholdBps`
 * would stay 0 (which makes the auto-close fire only once the stream is already
 * critical — too late). We set it to 1000 (10%) right after the upgrade.
 *
 * Run: yarn hardhat run scripts/upgrade-streamvaults.ts --network baseMainnet
 */
const DEFAULT_THRESHOLD_BPS = 1_000n // 10% of the buffer

async function main() {
	const dep = await deployments.get('StreamVaults')
	const proxy = dep.address
	console.log(`[upgrade] network        : ${network.name}`)
	console.log(`[upgrade] StreamVaults    : ${proxy}`)

	const Factory = await ethers.getContractFactory('StreamVaults')
	console.log('[upgrade] deploying new implementation + upgrading proxy...')
	const upgraded = await upgrades.upgradeProxy(proxy, Factory)
	await upgraded.waitForDeployment()
	console.log('[upgrade] proxy upgraded')

	// initialize() does not re-run → ensure the auto-close threshold is set.
	const sv = await ethers.getContractAt('StreamVaults', proxy)
	const current: bigint = await sv.streamCloseThresholdBps()
	if (current === 0n) {
		const tx = await sv.setStreamCloseThreshold(DEFAULT_THRESHOLD_BPS)
		await tx.wait()
		console.log(`[upgrade] streamCloseThresholdBps set to ${DEFAULT_THRESHOLD_BPS} (10%)`)
	} else {
		console.log(`[upgrade] streamCloseThresholdBps already ${current.toString()} — left as is`)
	}

	await saveUpgradeableContractDeploymentInfo('StreamVaults', upgraded)

	if (!developmentChains.includes(network.name)) {
		const impl = await getImplementationAddress(proxy as `0x${string}`)
		console.log(`[upgrade] new implementation: ${impl}`)
		await verify(impl, [])
	}

	console.log('[upgrade] done')
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
