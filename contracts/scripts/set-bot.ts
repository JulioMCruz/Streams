import { deployments, ethers } from 'hardhat'

/**
 * Sets `StreamVaultsConfig.bot` (owner-only) to a new authorized swap executor.
 *
 * This is the CRE go-live step #2 (step #1 is the proxy upgrade, already handled
 * by `scripts/upgrade-streamvaults.ts`, which deploys the impl that now includes
 * `onReport`). In a CRE deployment the `bot` is the **KeystoneForwarder** address
 * for this DON: `StreamVaults.onReport` is gated to `msg.sender == config.bot()`,
 * so pointing `bot` at the forwarder lets DON-attested reports drive
 * `executeSwap` / `closeStreamIfLow`.
 *
 * ⚠️ This REPLACES the previous bot. Setting it to the forwarder disables the
 * single-EOA path on this config (the EOA can no longer call executeSwap
 * directly). Pass the EOA back to revert.
 *
 * Run: BOT_ADDRESS=0x<keystoneForwarder> \
 *      yarn hardhat run scripts/set-bot.ts --network baseMainnet
 */
async function main() {
	const newBot = process.env.BOT_ADDRESS
	if (!newBot || !ethers.isAddress(newBot)) {
		throw new Error(
			`BOT_ADDRESS must be a valid address (got "${newBot ?? ''}"). ` +
				'Pass the KeystoneForwarder address: BOT_ADDRESS=0x... yarn hardhat run scripts/set-bot.ts --network <net>'
		)
	}

	const dep = await deployments.get('StreamVaultsConfig')
	const cfg = await ethers.getContractAt('StreamVaultsConfig', dep.address)

	const before: string = await cfg.bot()
	console.log(`[set-bot] StreamVaultsConfig: ${dep.address}`)
	console.log(`[set-bot] current bot       : ${before}`)
	console.log(`[set-bot] new bot (forwarder): ${newBot}`)

	if (before.toLowerCase() === newBot.toLowerCase()) {
		console.log('[set-bot] already set — nothing to do')
		return
	}

	const tx = await cfg.setBot(newBot)
	console.log(`[set-bot] tx: ${tx.hash} — waiting...`)
	await tx.wait()

	const after: string = await cfg.bot()
	console.log(`[set-bot] bot now set to    : ${after}`)
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
