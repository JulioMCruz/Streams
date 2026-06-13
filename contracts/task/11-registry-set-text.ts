import { task, types } from 'hardhat/config'

task(
	'registry:set-text',
	'Sets a free-form ENS text record for a label (caller must own the smart account).'
)
	.addParam('label', 'Label', undefined, types.string)
	.addParam(
		'key',
		'Text record key (e.g. "description", "url")',
		undefined,
		types.string
	)
	.addParam('value', 'Text record value', undefined, types.string)
	.setAction(async (args, hre) => {
		const { ethers, deployments, getNamedAccounts } = hre
		const { deployer } = await getNamedAccounts()
		const signer = await ethers.getSigner(deployer)

		const registry = await deployments.get('SmartAccountRegistry')
		const contract = await ethers.getContractAt(
			'SmartAccountRegistry',
			registry.address,
			signer
		)

		console.log(`label : ${args.label}`)
		console.log(`key   : ${args.key}`)
		console.log(`value : ${args.value}`)

		const tx = await contract.setText(args.label, args.key, args.value)
		const receipt = await tx.wait()

		console.log(`Text set. txHash: ${receipt?.hash}`)
	})
