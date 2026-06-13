import { parseAbi, type Address } from 'viem'

const pick = (raw: string | undefined, fallback: Address): Address =>
	raw && raw.length > 0 ? (raw as Address) : fallback

/// Protocol addresses. Default to Base Sepolia; override per environment via
/// NEXT_PUBLIC_* (e.g. local Hardhat addresses written by sync-web-env).
///
/// NOTE: each env var MUST be read by its literal name — Next.js only inlines
/// `process.env.NEXT_PUBLIC_*` for the client when the key is a static
/// literal. A dynamic `process.env[name]` access is NOT replaced and resolves
/// to undefined in the browser, silently falling back to the defaults.
export const ADDRESSES = {
	streamVaults: pick(
		process.env.NEXT_PUBLIC_STREAM_VAULTS_ADDRESS,
		'0x0000000000000000000000000000000000000000'
	),
	streamVaultsConfig: pick(
		process.env.NEXT_PUBLIC_STREAM_VAULTS_CONFIG_ADDRESS,
		'0x0000000000000000000000000000000000000000'
	),
	smartAccountRegistry: pick(
		process.env.NEXT_PUBLIC_SMART_ACCOUNT_REGISTRY_ADDRESS,
		'0x0000000000000000000000000000000000000000'
	),
	cfaForwarder: pick(
		process.env.NEXT_PUBLIC_CFA_FORWARDER_ADDRESS,
		'0xcfA132E353cB4E398080B9700609bb008eceB125'
	),
	usdcx: pick(
		process.env.NEXT_PUBLIC_USDCX_ADDRESS,
		'0x0000000000000000000000000000000000000000'
	),
	usdc: pick(
		process.env.NEXT_PUBLIC_USDC_ADDRESS,
		'0x036CbD53842c5426634e7929541eC2318f3dCF7e'
	),
	weth: pick(
		process.env.NEXT_PUBLIC_WETH_ADDRESS,
		'0x4200000000000000000000000000000000000006'
	),
	/// WBTC target. Defaults to the WETH address so the local stack (one
	/// whitelisted target mock) keeps working; on a real network set
	/// NEXT_PUBLIC_WBTC_ADDRESS to a distinct, whitelisted token and the bot
	/// genuinely buys WBTC vs WETH per the user's rule.
	wbtc: pick(
		process.env.NEXT_PUBLIC_WBTC_ADDRESS,
		pick(
			process.env.NEXT_PUBLIC_WETH_ADDRESS,
			'0x4200000000000000000000000000000000000006'
		)
	),
	/// Mock swap router — only set on the local chain (used by the stream
	/// simulator to keep the router funded so swaps succeed).
	router: pick(
		process.env.NEXT_PUBLIC_ROUTER_ADDRESS,
		'0x0000000000000000000000000000000000000000'
	)
} as const

const sameAddress = (a?: string, b?: string): boolean =>
	!!a && !!b && a.toLowerCase() === b.toLowerCase()

/// Decimals of a swap OUTPUT token. WBTC has 8 decimals on Base mainnet; WETH
/// has 18. On the local chain WBTC falls back to WETH's address (one mock
/// target), so it correctly resolves to 18 there.
export const outputDecimals = (token?: string): number =>
	sameAddress(token, ADDRESSES.wbtc) && !sameAddress(ADDRESSES.wbtc, ADDRESSES.weth)
		? 8
		: 18

export const streamVaultsAbi = parseAbi([
	'struct UserRules { uint16 maxSlippageBps; uint256 minTradeAmount; address settlementAddress; address[] targetTokens; }',
	'struct Permit2612Sig { uint256 deadline; uint8 v; bytes32 r; bytes32 s; }',
	'event SmartAccountCreated(address indexed user, address indexed smartAccount)',
	'event StreamUpdated(address indexed user, address indexed smartAccount, address indexed superToken, int96 previousRate, int96 newRate)',
	'event StreamBotStarted(address indexed user, address indexed smartAccount, address indexed superToken, uint256 underlyingAmountWrapped, uint256 superAmountMinted, int96 rate)',
	'function createSmartAccount() returns (address)',
	'function redeploySmartAccount() returns (address smartAccount)',
	'function startStreamBot(address superToken, uint256 underlyingAmount, int96 rate, UserRules rules, Permit2612Sig permitSig) returns (address smartAccount)',
	'function setStream(address smartAccount, address superToken, int96 rate)',
	'function smartAccountOf(address user) view returns (address)',
	'function userOf(address smartAccount) view returns (address)',
	'function config() view returns (address)'
])

/// USDCx SuperToken. `upgrade`/`downgrade` wrap/unwrap USDC<->USDCx (the
/// downgrade is the "recover my USDCx" kill switch); balanceOf reads the
/// user's wallet balance, which decreases block-by-block as it streams.
export const superTokenAbi = parseAbi([
	'function upgrade(uint256 amount)',
	'function upgradeTo(address to, uint256 amount, bytes data)',
	'function downgrade(uint256 amount)',
	'function balanceOf(address account) view returns (uint256)',
	'function getUnderlyingToken() view returns (address)'
])

/// EIP-2612 surface on USDC. The frontend reads `nonces`/`name`/`version`
/// to build the typed-data permit Bob signs off-chain; `startStreamBot`
/// consumes the signature on-chain to pull USDC without a prior approve.
export const erc2612Abi = parseAbi([
	'function nonces(address owner) view returns (uint256)',
	'function name() view returns (string)',
	'function version() view returns (string)'
])

export const smartAccountAbi = parseAbi([
	'struct UserRules { uint16 maxSlippageBps; uint256 minTradeAmount; address settlementAddress; address[] targetTokens; }',
	'event RulesUpdated(uint16 maxSlippageBps, uint256 minTradeAmount, address indexed settlementAddress, address[] targetTokens)',
	'event Executed(address indexed target, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)',
	'function setRules((uint16,uint256,address,address[]))',
	'function withdrawAll(address token, address to)',
	'function owner() view returns (address)',
	'function operator() view returns (address)',
	'function rules() view returns (uint16 maxSlippageBps, uint256 minTradeAmount, address settlementAddress)',
	'function targetTokens() view returns (address[])'
])

export const cfaForwarderAbi = parseAbi([
	'function getFlowrate(address token, address sender, address receiver) view returns (int96)',
	'function grantPermissions(address token, address flowOperator) returns (bool)',
	'function revokePermissions(address token, address flowOperator) returns (bool)'
])

export const erc20Abi = parseAbi([
	'function balanceOf(address account) view returns (uint256)',
	'function decimals() view returns (uint8)',
	'function symbol() view returns (string)',
	'function approve(address spender, uint256 amount) returns (bool)'
])

export const registryAbi = parseAbi([
	'event NameRegistered(address indexed smartAccount, address indexed user, string label, bytes32 indexed labelHash)',
	'function register(address sa, string label)',
	'function release(address sa)',
	'function setText(string label, string key, string value)',
	'function smartAccountOf(string label) view returns (address)',
	'function labelOf(address sa) view returns (string)',
	'function textOf(string label, string key) view returns (string)'
])

export const ENS_PARENT = 'streamvault.eth'
