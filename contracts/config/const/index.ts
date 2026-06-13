import { NetworkConfigInfo } from '@/models'

import { register } from './env-var'

export type { ProtocolAddresses } from './addresses'
export { ADDRESSES, getProtocolAddresses } from './addresses'

export const developmentChains = ['localhost', 'hardhat']

export const networkConfig: NetworkConfigInfo = Object.entries(
	register.networks
).reduce<NetworkConfigInfo>((acc, [key, _value]) => {
	acc[key] = {
		blockConfirmations: 3
	}
	return acc
}, {})
