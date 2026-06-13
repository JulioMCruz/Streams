/**
 * Contract ABIs as inline constants.
 *
 * The baseline bot loads ABIs from `contracts/artifacts/...` at
 * run time (`utils/abis.ts` reads the filesystem). CRE workflows run inside
 * the DON's WASM sandbox with NO filesystem, so the fragments the adapters
 * need are **inlined here** and bundled into the workflow by `cre-compile`.
 *
 * Keep these in sync with the compiled artifacts. Only the fragments the
 * CRE adapters actually call belong here — not the full ABIs. Declared
 * `as const` so viem infers exact decode types for `decodeFunctionResult`.
 */

/** SmartAccountDCA reads used by `cre-chain-state`. `rules()` omits the
 * dynamic `targetTokens` array (Solidity skips it in struct getters), so it
 * is read separately via `targetTokens()`. */
export const SMART_ACCOUNT_DCA_ABI = [
	{
		type: 'function',
		name: 'owner',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'address' }],
	},
	{
		type: 'function',
		name: 'operator',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'address' }],
	},
	{
		type: 'function',
		name: 'rules',
		stateMutability: 'view',
		inputs: [],
		outputs: [
			{ name: 'maxSlippageBps', type: 'uint16' },
			{ name: 'minTradeAmount', type: 'uint256' },
			{ name: 'settlementAddress', type: 'address' },
		],
	},
	{
		type: 'function',
		name: 'targetTokens',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'address[]' }],
	},
] as const

/** ERC20 `balanceOf` — used to read the streamed SuperToken balance. */
export const ERC20_ABI = [
	{
		type: 'function',
		name: 'balanceOf',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: '', type: 'uint256' }],
	},
] as const

/** SuperToken `realtimeBalanceOfNow` — for the auto-close guardian. */
export const SUPER_TOKEN_ABI = [
	{
		type: 'function',
		name: 'realtimeBalanceOfNow',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [
			{ name: 'availableBalance', type: 'int256' },
			{ name: 'deposit', type: 'uint256' },
			{ name: 'owedDeposit', type: 'uint256' },
			{ name: 'timestamp', type: 'uint256' },
		],
	},
] as const

/** StreamVaults fragments. Reads (`cre-swap-gateway`) + writes
 * (`cre-swap-executor`, `cre-stream-guard`). The `SmartAccountCreated` event is
 * defined inline in cre-smart-account-registry. */
export const STREAM_VAULTS_ABI = [
	{
		type: 'function',
		name: 'swapCooldownBlocks',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'lastSwapBlock',
		stateMutability: 'view',
		inputs: [{ name: 'smartAccount', type: 'address' }],
		outputs: [{ name: '', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'streamCloseThresholdBps',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'executeSwap',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'smartAccount', type: 'address' },
			{
				name: 'params',
				type: 'tuple',
				components: [
					{ name: 'superTokenIn', type: 'address' },
					{ name: 'superAmountIn', type: 'uint256' },
					{ name: 'tokenIn', type: 'address' },
					{ name: 'tokenOut', type: 'address' },
					{ name: 'target', type: 'address' },
					{ name: 'value', type: 'uint256' },
					{ name: 'data', type: 'bytes' },
					{ name: 'minAmountOut', type: 'uint256' },
				],
			},
		],
		outputs: [{ name: 'amountOut', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'closeStreamIfLow',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'smartAccount', type: 'address' },
			{ name: 'superToken', type: 'address' },
		],
		outputs: [{ name: 'closed', type: 'bool' }],
	},
] as const
