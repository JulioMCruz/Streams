import { task, types } from 'hardhat/config'

task(
	'streamvaults:execute-swap',
	'Bot-only: routes a single swap through StreamVaults -> SmartAccountDCA. Calldata is typically obtained from the Uniswap Trading API.'
)
	.addParam('sa', 'SmartAccountDCA address', undefined, types.string)
	.addParam(
		'superTokenIn',
		'SuperToken to downgrade (use 0x0 to skip)',
		undefined,
		types.string
	)
	.addParam(
		'superAmountIn',
		'Amount of SuperToken to downgrade (raw)',
		'0',
		types.string
	)
	.addParam('tokenIn', 'Underlying input token', undefined, types.string)
	.addParam('tokenOut', 'Expected output token', undefined, types.string)
	.addParam(
		'target',
		'Swap target contract (e.g. UniversalRouter)',
		undefined,
		types.string
	)
	.addParam('data', 'Hex-encoded swap calldata', undefined, types.string)
	.addParam(
		'minOut',
		'Minimum acceptable output amount (raw)',
		'0',
		types.string
	)
	.addParam('value', 'Native value forwarded with the call', '0', types.string)
	.setAction(async (args, hre) => {
		const { ethers, deployments, getNamedAccounts } = hre

		const sv = await deployments.get('StreamVaults')
		const { bot } = await getNamedAccounts()
		const signer = await ethers.getSigner(bot)

		const streamVaults = await ethers.getContractAt(
			'StreamVaults',
			sv.address,
			signer
		)

		const params = {
			superTokenIn: args.superTokenIn,
			superAmountIn: BigInt(args.superAmountIn),
			tokenIn: args.tokenIn,
			tokenOut: args.tokenOut,
			target: args.target,
			value: BigInt(args.value),
			data: args.data,
			minAmountOut: BigInt(args.minOut)
		}

		console.log(`Bot           : ${bot}`)
		console.log(`smartAccount  : ${args.sa}`)
		console.log(`tokenIn       : ${params.tokenIn}`)
		console.log(`tokenOut      : ${params.tokenOut}`)
		console.log(`target        : ${params.target}`)
		console.log(`minAmountOut  : ${params.minAmountOut.toString()}`)
		console.log(`calldata      : ${params.data.slice(0, 10)}...`)

		const tx = await streamVaults.executeSwap(args.sa, params, {
			value: params.value
		})
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
			.find(parsed => parsed?.name === 'SwapExecuted')

		const amountOut = event?.args.amountOut as bigint | undefined
		console.log(`Swap executed. amountOut: ${amountOut?.toString() ?? 'n/a'}`)
		console.log(`txHash        : ${receipt?.hash}`)
	})
