import { task, types } from 'hardhat/config'

task(
	'registry:register',
	'Registers a label for the caller smart account in SmartAccountRegistry.'
)
	.addParam('sa', 'SmartAccountDCA address', undefined, types.string)
	.addParam(
		'label',
		'Label to register (will resolve as <label>.streamvault.eth)',
		undefined,
		types.string
	)
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

		console.log(`Caller        : ${deployer}`)
		console.log(`Registry      : ${registry.address}`)
		console.log(`smartAccount  : ${args.sa}`)
		console.log(`label         : ${args.label}`)

		const tx = await contract.register(args.sa, args.label)
		const receipt = await tx.wait()

		console.log(`Registered. txHash: ${receipt?.hash}`)
	})
