// Deploys Multicall3 at its canonical address on the local Hardhat node via
// `hardhat_setCode`. Hardhat doesn't predeploy Multicall3, but wagmi/viem
// batch reads through it — without this, the frontend's on-chain reads fail.
// The runtime bytecode is read straight from viem's own constant so it always
// matches the address wagmi expects.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'

const viemDir = path.dirname(require.resolve('viem/package.json'))
const src = fs.readFileSync(
	path.join(viemDir, '_esm/constants/contracts.js'),
	'utf-8'
)
const match = src.match(/multicall3Bytecode\s*=\s*'(0x[0-9a-fA-F]+)'/)
if (!match) throw new Error('could not find multicall3Bytecode in viem')
const code = match[1]

const res = await fetch(RPC, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({
		jsonrpc: '2.0',
		id: 1,
		method: 'hardhat_setCode',
		params: [MULTICALL3, code]
	})
})
const json = await res.json()
if (json.error) throw new Error(JSON.stringify(json.error))
console.log(`[setup-multicall3] deployed Multicall3 at ${MULTICALL3} (${code.length} bytes of code)`)
