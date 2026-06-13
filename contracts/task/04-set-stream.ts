import { task, types } from 'hardhat/config'

const SECONDS_PER_DAY = 86_400n
const SUPER_TOKEN_DECIMALS = 18n

task(
	'streamvaults:set-stream',
	'Opens, updates, or closes (rate=0) a stream into a smart account via StreamVaults.'
)
	.addParam('sa', 'SmartAccountDCA address (receiver)', undefined, types.string)
	.addParam(
		'superToken',
		'SuperToken address (e.g. USDCx)',
		undefined,
		types.string
	)
	.addParam(
		'ratePerDay',
		'Flow rate expressed in tokens/day (human units, e.g. "1" = 1 token/day). Use "0" to close.',
		undefined,
		types.string
	)
	.setAction(async (args, hre) => {
		const { ethers, deployments, getNamedAccounts } = hre

		const sv = await deployments.get('StreamVaults')
		const { deployer } = await getNamedAccounts()
		const signer = await ethers.getSigner(deployer)

		const streamVaults = await ethers.getContractAt(
			'StreamVaults',
			sv.address,
			signer
		)

		// Convert tokens/day -> wei/sec (int96). SuperTokens are always 18 decimals.
		const tokensPerDay = ethers.parseUnits(
			args.ratePerDay,
			Number(SUPER_TOKEN_DECIMALS)
		)
		const flowrate = tokensPerDay / SECONDS_PER_DAY
		const INT96_MAX = (1n << 95n) - 1n
		if (flowrate > INT96_MAX) {
			throw new Error(`flowrate ${flowrate} exceeds int96 max`)
		}

		console.log(`Caller        : ${deployer}`)
		console.log(`smartAccount  : ${args.sa}`)
		console.log(`superToken    : ${args.superToken}`)
		console.log(`ratePerDay    : ${args.ratePerDay}`)
		console.log(`flowrate (wei/sec): ${flowrate.toString()}`)

		const tx = await streamVaults.setStream(args.sa, args.superToken, flowrate)
		const receipt = await tx.wait()

		console.log(`Stream set. txHash: ${receipt?.hash}`)
	})
