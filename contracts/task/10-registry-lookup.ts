import { task, types } from 'hardhat/config'

task('registry:lookup', 'Resolves a label to its SmartAccountDCA address.')
	.addParam('label', 'Label to resolve', undefined, types.string)
	.setAction(async (args, hre) => {
		const { ethers, deployments } = hre

		const registry = await deployments.get('SmartAccountRegistry')
		const contract = await ethers.getContractAt(
			'SmartAccountRegistry',
			registry.address
		)

		const sa: string = await contract.smartAccountOf(args.label)
		const owner: string =
			sa === ethers.ZeroAddress
				? ethers.ZeroAddress
				: await ethers.getContractAt('SmartAccountDCA', sa).then(c => c.owner())

		console.log(`label         : ${args.label}`)
		console.log(`smartAccount  : ${sa}`)
		console.log(`owner         : ${owner}`)

		if (sa === ethers.ZeroAddress) {
			console.log('(not registered)')
		}
	})
