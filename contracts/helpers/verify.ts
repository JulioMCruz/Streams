import { run } from 'hardhat'

export async function verify(
	contractAddress: string,
	args: unknown[],
	contract?: string
): Promise<void> {
	console.log('Verifying contract...')

	try {
		await run('verify:verify', {
			address: contractAddress,
			constructorArguments: args,
			...(contract && { contract })
		})

		console.log('✅ Contract verified successfully!')
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (message.toLowerCase().includes('already verified')) {
			console.log('✅ Contract is already verified!')
		} else {
			console.error('❌ Verification error:', message)
		}
	}
}
