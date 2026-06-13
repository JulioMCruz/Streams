import {
	encodeCallMsg,
	type EVMClient,
	LATEST_BLOCK_NUMBER,
	type Runtime,
} from '@chainlink/cre-sdk'
import {
	type Address,
	bytesToHex,
	decodeFunctionResult,
	encodeFunctionData,
	type Hex,
	zeroAddress,
} from 'viem'

/**
 * Canonical Multicall3 — deployed at the same address on Base mainnet and
 * virtually every chain (the project's web stack relies on it too).
 */
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

const MULTICALL3_ABI = [
	{
		type: 'function',
		name: 'aggregate3',
		stateMutability: 'payable',
		inputs: [
			{
				name: 'calls',
				type: 'tuple[]',
				components: [
					{ name: 'target', type: 'address' },
					{ name: 'allowFailure', type: 'bool' },
					{ name: 'callData', type: 'bytes' },
				],
			},
		],
		outputs: [
			{
				name: 'returnData',
				type: 'tuple[]',
				components: [
					{ name: 'success', type: 'bool' },
					{ name: 'returnData', type: 'bytes' },
				],
			},
		],
	},
] as const

export type AggregatedCall = {
	target: Address
	abi: readonly unknown[]
	functionName: string
	args?: readonly unknown[]
}

/**
 * Batch N contract reads into ONE `evm.callContract` via Multicall3.aggregate3.
 *
 * CRE enforces a per-workflow CallContract limit (~15), so issuing one eth_call
 * per field does not scale past a couple of accounts. Aggregating the reads
 * that are always needed together collapses them into a single capability call.
 * Returns each sub-call's decoded result, in order; throws if any reverted
 * (`allowFailure=false`), which the use case treats as an account-level skip.
 */
export function multicallRead(
	runtime: Runtime<unknown>,
	evm: EVMClient,
	calls: readonly AggregatedCall[],
): unknown[] {
	const encoded = calls.map((c) => ({
		target: c.target,
		allowFailure: false,
		callData: encodeFunctionData({
			abi: c.abi,
			functionName: c.functionName,
			...(c.args ? { args: c.args } : {}),
		} as Parameters<typeof encodeFunctionData>[0]),
	}))

	const data = encodeFunctionData({
		abi: MULTICALL3_ABI,
		functionName: 'aggregate3',
		args: [encoded],
	})

	const reply = evm
		.callContract(runtime, {
			call: encodeCallMsg({ from: zeroAddress, to: MULTICALL3_ADDRESS, data }),
			blockNumber: LATEST_BLOCK_NUMBER,
		})
		.result()

	const results = decodeFunctionResult({
		abi: MULTICALL3_ABI,
		functionName: 'aggregate3',
		data: bytesToHex(reply.data),
	}) as readonly { success: boolean; returnData: Hex }[]

	return results.map((r, i) => {
		const call = calls[i]
		if (!r.success) {
			throw new Error(`multicall sub-call '${call.functionName}' reverted`)
		}
		return decodeFunctionResult({
			abi: call.abi,
			functionName: call.functionName,
			data: r.returnData,
		} as Parameters<typeof decodeFunctionResult>[0])
	})
}
