import { task } from 'hardhat/config'

task(
	'streamvaults:create-smart-account',
	'Creates a SmartAccountDCA for the caller (named account: deployer).'
).setAction(async (_args, hre) => {
	const { ethers, deployments, getNamedAccounts } = hre

	const sv = await deployments.get('StreamVaults')
	const { deployer } = await getNamedAccounts()
	const signer = await ethers.getSigner(deployer)

	const streamVaults = await ethers.getContractAt(
		'StreamVaults',
		sv.address,
		signer
	)

	const existing: string = await streamVaults.smartAccountOf(deployer)
	if (existing !== ethers.ZeroAddress) {
		console.log(`Smart account already exists for ${deployer}: ${existing}`)
		return
	}

	const tx = await streamVaults.createSmartAccount()
	const receipt = await tx.wait()

	const event = receipt?.logs
		.map(log => {
			try {
				return streamVaults.interface.parseLog({
					data: log.data,
					topics: [...log.topics]
				})
			} catch {
				return null
			}
		})
		.find(parsed => parsed?.name === 'SmartAccountCreated')

	const sa = event?.args.smartAccount as string
	console.log(`Smart account created`)
	console.log(`  user          : ${deployer}`)
	console.log(`  smartAccount  : ${sa}`)
	console.log(`  txHash        : ${receipt?.hash}`)
})
