import { base, baseSepolia } from 'viem/chains'

export type ProtocolAddresses = {
	/// @notice Canonical Uniswap Permit2 deployment.
	permit2: string
	/// @notice Canonical Superfluid CFAv1Forwarder.
	cfaForwarder: string
	/// @notice Swap routers whitelisted in StreamVaultsConfig.allowedTargets.
	///         The Uniswap Trading API may route a swap through different
	///         Universal Router versions, so we whitelist every router it can
	///         target on this chain — whitelisting only one risks an
	///         INVALID_TARGET revert when the API picks the other.
	allowedTargets: string[]
	/// @notice Underlying tokens whitelisted in StreamVaultsConfig.supportedSwapTokens.
	tokens: {
		usdc: string
		weth: string
		wbtc?: string
	}
}

/// @dev Canonical across all major EVM chains where Permit2 / Superfluid are deployed.
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const CFA_FORWARDER = '0xcfA132E353cB4E398080B9700609bb008eceB125'

/// @dev Per-chain addresses. Verify each against official docs before deploying:
///      - Uniswap UR: https://docs.uniswap.org/contracts/v3/reference/deployments/
///      - Circle USDC testnet: https://developers.circle.com/stablecoins/docs/usdc-on-test-networks
///      - Base WETH (canonical OP-stack predeploy): 0x42...6
/// @dev Placeholder addresses for the in-memory hardhat network. They satisfy
///      the deploy scripts' non-zero check so smoke tests pass; they do NOT
///      correspond to real contracts. Use a fork or testnet for real e2e flows.
const HARDHAT_PLACEHOLDER = '0x000000000000000000000000000000000000dEaD'

export const ADDRESSES: Record<number, ProtocolAddresses> = {
	1337: {
		permit2: HARDHAT_PLACEHOLDER,
		cfaForwarder: HARDHAT_PLACEHOLDER,
		allowedTargets: [HARDHAT_PLACEHOLDER],
		tokens: {
			usdc: HARDHAT_PLACEHOLDER,
			weth: HARDHAT_PLACEHOLDER
		}
	},
	[baseSepolia.id]: {
		permit2: PERMIT2,
		cfaForwarder: CFA_FORWARDER,
		allowedTargets: ['0x95273d871c8156636e114b63797d78D7E1720d81'],
		tokens: {
			usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
			weth: '0x4200000000000000000000000000000000000006'
		}
	},
	[base.id]: {
		permit2: PERMIT2,
		cfaForwarder: CFA_FORWARDER,
		/// Uniswap Universal Router v2.0 and v2.1.1 on Base mainnet. The Trading
		/// API routes to one of these depending on the chosen path — both are
		/// whitelisted; confirm the live `to` with a real /v1/swap before demo.
		allowedTargets: [
			'0x6fF5693b99212Da76ad316178A184AB56D299b43',
			'0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7'
		],
		tokens: {
			usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
			weth: '0x4200000000000000000000000000000000000006',
			wbtc: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c'
		}
	}
}

export function getProtocolAddresses(chainId: number): ProtocolAddresses {
	const addrs = ADDRESSES[chainId]
	if (!addrs) {
		throw new Error(
			`No protocol addresses configured for chainId ${chainId}. ` +
				`Add an entry to contracts/config/const/addresses.ts.`
		)
	}
	return addrs
}
