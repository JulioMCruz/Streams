import { task, types } from 'hardhat/config'

import { getProtocolAddresses } from '@/config/const'

const FORWARDER_ABI = [
	'function getFlowrate(address token, address sender, address receiver) external view returns (int96)'
]

const SECONDS_PER_DAY = 86_400n

task(
	'superfluid:flowrate',
	'Reads the current Superfluid flow rate from a sender to a receiver for a SuperToken.'
)
	.addParam('superToken', 'SuperToken address', undefined, types.string)
	.addParam('sender', 'Stream sender (user)', undefined, types.string)
	.addParam(
		'receiver',
		'Stream receiver (smart account)',
		undefined,
		types.string
	)
	.setAction(async (args, hre) => {
		const { ethers } = hre

		const chainId = Number((await ethers.provider.getNetwork()).chainId)
		const { cfaForwarder } = getProtocolAddresses(chainId)

		const forwarder = new ethers.Contract(
			cfaForwarder,
			FORWARDER_ABI,
			ethers.provider
		)

		const rate: bigint = await forwarder.getFlowrate(
			args.superToken,
			args.sender,
			args.receiver
		)

		const perDay = rate * SECONDS_PER_DAY
		console.log(`forwarder       : ${cfaForwarder}`)
		console.log(`superToken      : ${args.superToken}`)
		console.log(`sender          : ${args.sender}`)
		console.log(`receiver        : ${args.receiver}`)
		console.log(`flowrate /sec   : ${rate.toString()}`)
		console.log(
			`flowrate /day   : ${ethers.formatUnits(perDay, 18)} tokens/day`
		)
	})
