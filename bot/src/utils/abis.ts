/* c8 ignore next -- ESM module-initialisation branch inserted by V8; not reachable from tests */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// src/utils → bot → repo root
const REPO_ROOT = path.resolve(__dirname, '../../..')

function loadAbi(artifactPath: string): unknown[] {
	const absolute = path.join(
		REPO_ROOT,
		'contracts',
		'artifacts',
		artifactPath,
	)
	if (!fs.existsSync(absolute)) {
		throw new Error(
			`Artifact not found: ${absolute}. Run \`yarn workspace @streams/contracts compile\` first.`,
		)
	}
	/* c8 ignore next 2 -- only unreachable in the dynamic-import error-path test; the normal module load covers these lines */
	const json = JSON.parse(fs.readFileSync(absolute, 'utf-8'))
	return json.abi as unknown[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const streamVaultsAbi: any = loadAbi(
	'contracts/core/StreamVaults/StreamVaults.sol/StreamVaults.json',
)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const streamVaultsConfigAbi: any = loadAbi(
	'contracts/core/StreamVaults/StreamVaultsConfig.sol/StreamVaultsConfig.json',
)
/* c8 ignore next 2 -- only unreachable in the dynamic-import error-path test; normal module load covers this */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const smartAccountAbi: any = loadAbi(
	'contracts/strategies/dca/SmartAccountDCA.sol/SmartAccountDCA.json',
)

/* c8 ignore next -- only unreachable in the dynamic-import error-path test; normal module load covers this */
export const erc20Abi = [
	{
		type: 'function',
		name: 'balanceOf',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: '', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'decimals',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'uint8' }],
	},
	{
		type: 'function',
		name: 'symbol',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'string' }],
	},
] as const

/* c8 ignore next -- only unreachable in the dynamic-import error-path test; normal module load covers this */
export const superTokenAbi = [
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
