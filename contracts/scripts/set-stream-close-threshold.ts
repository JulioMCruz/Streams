import { deployments, ethers } from 'hardhat'

/**
 * Sets `StreamVaults.streamCloseThresholdBps` (owner-only). Run after a UUPS
 * upgrade, where `initialize()` does not re-run and the value would stay 0
 * (which disables the auto-close margin). 1000 = 10% of the buffer.
 *
 * Run: yarn hardhat run scripts/set-stream-close-threshold.ts --network baseMainnet
 */
const THRESHOLD_BPS = BigInt(process.env.THRESHOLD_BPS ?? '1000')

async function main() {
	const dep = await deployments.get('StreamVaults')
	const sv = await ethers.getContractAt('StreamVaults', dep.address)

	const before: bigint = await sv.streamCloseThresholdBps()
	console.log(`[threshold] StreamVaults: ${dep.address}`)
	console.log(`[threshold] current     : ${before.toString()}`)
	if (before === THRESHOLD_BPS) {
		console.log('[threshold] already set — nothing to do')
		return
	}

	const tx = await sv.setStreamCloseThreshold(THRESHOLD_BPS)
	console.log(`[threshold] tx: ${tx.hash} — waiting...`)
	await tx.wait()

	const after: bigint = await sv.streamCloseThresholdBps()
	console.log(`[threshold] now set to  : ${after.toString()} (10%)`)
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
