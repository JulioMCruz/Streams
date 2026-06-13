import { task, types } from 'hardhat/config'

task(
	'smart-account:set-rules',
	'Sets DCA trading rules on the caller smart account.'
)
	.addParam('sa', 'SmartAccountDCA address', undefined, types.string)
	.addParam(
		'slippageBps',
		'Max slippage in basis points (1 = 0.01%)',
		50,
		types.int
	)
	.addParam(
		'minTrade',
		'Minimum input amount (raw, in tokenIn decimals)',
		undefined,
		types.string
	)
	.addParam(
		'settlement',
		'Address that receives swap output',
		undefined,
		types.string
	)
	.addParam(
		'targets',
		'Comma-separated target token addresses (whitelist for tokenOut)',
		undefined,
		types.string
	)
	.setAction(async (args, hre) => {
		const { ethers, getNamedAccounts } = hre
		const { deployer } = await getNamedAccounts()
		const signer = await ethers.getSigner(deployer)

		const sa = await ethers.getContractAt('SmartAccountDCA', args.sa, signer)

		const targetTokens = (args.targets as string)
			.split(',')
			.map(t => t.trim())
			.filter(Boolean)

		if (targetTokens.length === 0) {
			throw new Error('At least one target token is required')
		}

		const rules = {
			maxSlippageBps: Number(args.slippageBps),
			minTradeAmount: BigInt(args.minTrade),
			settlementAddress: args.settlement,
			targetTokens
		}

		console.log('Submitting setRules:')
		console.log(`  smartAccount      : ${args.sa}`)
		console.log(`  maxSlippageBps    : ${rules.maxSlippageBps}`)
		console.log(`  minTradeAmount    : ${rules.minTradeAmount.toString()}`)
		console.log(`  settlementAddress : ${rules.settlementAddress}`)
		console.log(`  targetTokens      : [${rules.targetTokens.join(', ')}]`)

		const tx = await sa.setRules(rules)
		const receipt = await tx.wait()
		console.log(`Rules updated. txHash: ${receipt?.hash}`)
	})
