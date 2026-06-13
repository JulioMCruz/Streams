import { task, types } from 'hardhat/config'

import { getProtocolAddresses } from '@/config/const'

const FORWARDER_ABI = [
	'function grantPermissions(address token, address flowOperator) external returns (bool)',
	'function revokePermissions(address token, address flowOperator) external returns (bool)'
]

task(
	'superfluid:grant-permissions',
	'Grants Superfluid CFA flow-operator permissions to StreamVaults for a given SuperToken (consent gate).'
)
	.addParam(
		'superToken',
		'SuperToken address (e.g. USDCx on the active network)',
		undefined,
		types.string
	)
	.addFlag('revoke', 'Revoke instead of grant')
	.setAction(async (args, hre) => {
		const { ethers, deployments, getNamedAccounts } = hre

		const sv = await deployments.get('StreamVaults')
		const { deployer } = await getNamedAccounts()
		const signer = await ethers.getSigner(deployer)

		const chainId = Number((await ethers.provider.getNetwork()).chainId)
		const { cfaForwarder } = getProtocolAddresses(chainId)

		const forwarder = new ethers.Contract(cfaForwarder, FORWARDER_ABI, signer)

		console.log(`Caller         : ${deployer}`)
		console.log(`SuperToken     : ${args.superToken}`)
		console.log(`Forwarder      : ${cfaForwarder}`)
		console.log(`StreamVaults   : ${sv.address}`)

		const tx = args.revoke
			? await forwarder.revokePermissions(args.superToken, sv.address)
			: await forwarder.grantPermissions(args.superToken, sv.address)
		const receipt = await tx.wait()

		console.log(
			`${args.revoke ? 'Revoked' : 'Granted'} permissions. txHash: ${receipt?.hash}`
		)
	})
