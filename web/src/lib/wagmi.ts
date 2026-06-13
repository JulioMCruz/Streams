import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import {
	type AppKitNetwork,
	base,
	baseSepolia,
	defineChain
} from '@reown/appkit/networks'
import { http } from 'viem'
import { cookieStorage, createStorage } from 'wagmi'

export const PROJECT_ID =
	process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? 'YOUR_REOWN_PROJECT_ID'

/// Base mainnet RPC. The default public endpoint allows wide `eth_getLogs`
/// ranges (needed by the swap-history reader); override with a paid endpoint
/// via NEXT_PUBLIC_BASE_RPC_URL if you hit rate limits. NOTE: do NOT point this
/// at a getLogs-capped tier (e.g. Alchemy Free's 10-block cap) — the swap
/// history scans from the deploy block and will fail.
export const BASE_RPC_URL =
	process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org'

/// Local Hardhat node (chainId 31337 — Hardhat/Anvil's default, the network
/// wallets already recognise for 127.0.0.1:8545). Used when running the full
/// stack locally; the in-app Faucet only appears on this chain.
export const LOCAL_RPC_URL =
	process.env.NEXT_PUBLIC_LOCAL_RPC_URL ?? 'http://127.0.0.1:8545'
export const LOCAL_CHAIN_ID = 31337

export const hardhatLocal = defineChain({
	id: LOCAL_CHAIN_ID,
	caipNetworkId: `eip155:${LOCAL_CHAIN_ID}`,
	chainNamespace: 'eip155',
	name: 'Hardhat Local',
	nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
	rpcUrls: { default: { http: [LOCAL_RPC_URL] } }
})

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
	base,
	baseSepolia,
	hardhatLocal
]

export const wagmiAdapter = new WagmiAdapter({
	storage: createStorage({ storage: cookieStorage }),
	ssr: true,
	projectId: PROJECT_ID,
	networks,
	/// Explicit transports so reads (incl. `eth_getLogs` for swap history) hit a
	/// known endpoint per chain instead of an opaque default proxy.
	transports: {
		[base.id]: http(BASE_RPC_URL),
		[baseSepolia.id]: http(),
		[LOCAL_CHAIN_ID]: http(LOCAL_RPC_URL)
	}
})

export const wagmiConfig = wagmiAdapter.wagmiConfig
