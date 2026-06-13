import { task, types } from 'hardhat/config'

task(
	'smart-account:withdraw',
	'Owner-only: withdraws a specific amount of `token` from the smart account. Omit --amount to withdraw the full balance.'
)
	.addParam('sa', 'SmartAccountDCA address', undefined, types.string)
	.addParam('token', 'Token to withdraw', undefined, types.string)
	.addParam('to', 'Recipient address', undefined, types.string)
	.addOptionalParam(
		'amount',
		'Amount to withdraw (raw). Omit for withdrawAll.',
		undefined,
		types.string
	)
	.setAction(async (args, hre) => {
		const { ethers, getNamedAccounts } = hre
		const { deployer } = await getNamedAccounts()
		const signer = await ethers.getSigner(deployer)

		const sa = await ethers.getContractAt('SmartAccountDCA', args.sa, signer)

		console.log(`Owner         : ${deployer}`)
		console.log(`smartAccount  : ${args.sa}`)
		console.log(`token         : ${args.token}`)
		console.log(`to            : ${args.to}`)

		const tx = args.amount
			? await sa.withdraw(args.token, BigInt(args.amount), args.to)
			: await sa.withdrawAll(args.token, args.to)
		const receipt = await tx.wait()

		console.log(
			`${args.amount ? 'Withdraw' : 'WithdrawAll'} executed. txHash: ${receipt?.hash}`
		)
	})
