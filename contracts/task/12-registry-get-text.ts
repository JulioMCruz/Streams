import { task, types } from 'hardhat/config'

task(
	'registry:get-text',
	'Reads a text record (auto-generated `streamvaults:*` keys or user-set values).'
)
	.addParam('label', 'Label', undefined, types.string)
	.addParam('key', 'Text record key', undefined, types.string)
	.setAction(async (args, hre) => {
		const { ethers, deployments } = hre

		const registry = await deployments.get('SmartAccountRegistry')
		const contract = await ethers.getContractAt(
			'SmartAccountRegistry',
			registry.address
		)

		const value: string = await contract.textOf(args.label, args.key)

		console.log(`label : ${args.label}`)
		console.log(`key   : ${args.key}`)
		console.log(`value : ${value || '(empty)'}`)
	})
