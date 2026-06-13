/**
 * Fund an address on a local anvil Base fork for the Ledger full-onboarding test:
 * 10k ETH (gas) + 200 USDC (the stream budget). The USDC balance is dealt by
 * brute-forcing the balanceOf storage slot (foundry stdStorage trick).
 *
 *   anvil --fork-url <base-rpc> --hardfork prague --port 8546
 *   ADDR=0xYourLedgerAddress node fund-fork.mjs
 */
import {
	createPublicClient,
	encodeAbiParameters,
	http,
	keccak256,
	toHex
} from 'viem'
import { base } from 'viem/chains'

const RPC = process.env.ANVIL_RPC ?? 'http://127.0.0.1:8546'
const ADDR = process.env.ADDR
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const AMOUNT = 200_000_000n // 200 USDC

if (!ADDR) throw new Error('set ADDR=0xYourLedgerAddress')

const c = createPublicClient({ chain: base, transport: http(RPC) })
const bal = () =>
	c.readContract({
		address: USDC,
		abi: [
			{
				type: 'function',
				name: 'balanceOf',
				stateMutability: 'view',
				inputs: [{ name: 'a', type: 'address' }],
				outputs: [{ type: 'uint256' }]
			}
		],
		functionName: 'balanceOf',
		args: [ADDR]
	})

await c.request({
	method: 'anvil_setBalance',
	params: [ADDR, '0x21e19e0c9bab2400000']
})

const valHex = toHex(AMOUNT, { size: 32 })
let dealt = false
for (let i = 0; i < 40; i++) {
	const key = keccak256(
		encodeAbiParameters(
			[{ type: 'address' }, { type: 'uint256' }],
			[ADDR, BigInt(i)]
		)
	)
	const orig = await c.getStorageAt({ address: USDC, slot: key })
	await c.request({ method: 'anvil_setStorageAt', params: [USDC, key, valHex] })
	if ((await bal()) === AMOUNT) {
		dealt = true
		break
	}
	await c.request({
		method: 'anvil_setStorageAt',
		params: [USDC, key, orig ?? `0x${'0'.repeat(64)}`]
	})
}
if (!dealt) throw new Error('USDC balanceOf slot not found')

console.log(`funded ${ADDR}: ETH ok, USDC ${await bal()}`)
