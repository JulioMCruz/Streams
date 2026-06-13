import { upgrades } from 'hardhat'
import { Address } from 'viem'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/// @dev On live networks the EIP-1967 implementation slot is sometimes not yet
///      readable on the RPC node right after the proxy is mined (state
///      propagation lag across the provider's backends). The read then throws
///      "doesn't look like an ERC 1967 proxy". Retry with backoff so a fresh
///      deploy doesn't fail on a transient lag.
export async function getImplementationAddress(
	proxyAddress: Address,
	retries = 8,
	delayMs = 3000
): Promise<Address> {
	let lastError: unknown
	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const implementationAddress =
				await upgrades.erc1967.getImplementationAddress(proxyAddress)
			return implementationAddress as Address
		} catch (error) {
			lastError = error
			await sleep(delayMs)
		}
	}
	throw lastError
}

export async function getProxyAdmin(proxyAddress: Address): Promise<Address> {
	const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxyAddress)

	return proxyAdmin as Address
}
