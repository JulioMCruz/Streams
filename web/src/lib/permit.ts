import { type Address, type Hex, parseSignature } from 'viem'

/**
 * EIP-2612 `Permit` typed-data builder. Kept pure (no wallet, no network)
 * so the component only has to read `nonces`/`name`/`version` on-chain and
 * hand the result to `signTypedData`. The on-chain `startStreamBot` then
 * consumes the signature to pull USDC without a prior `approve`.
 */
export type PermitTypedDataArgs = {
	/** ERC-20 name from `name()` — part of the EIP-712 domain. */
	tokenName: string
	/** EIP-712 domain version. USDC (Circle FiatToken) uses "2". */
	version: string
	chainId: number
	/** The token contract — `verifyingContract` in the domain. */
	token: Address
	/** Permit signer (token holder). */
	owner: Address
	/** Address allowed to pull the tokens — here, StreamVaults. */
	spender: Address
	/** Allowance granted, in the token's native decimals. */
	value: bigint
	/** Current `nonces(owner)` value. */
	nonce: bigint
	/** Unix-seconds expiry. */
	deadline: bigint
}

const PERMIT_TYPES = {
	Permit: [
		{ name: 'owner', type: 'address' },
		{ name: 'spender', type: 'address' },
		{ name: 'value', type: 'uint256' },
		{ name: 'nonce', type: 'uint256' },
		{ name: 'deadline', type: 'uint256' }
	]
} as const

/** Build the `signTypedData` payload for an EIP-2612 permit. */
export function buildPermitTypedData(args: PermitTypedDataArgs) {
	return {
		domain: {
			name: args.tokenName,
			version: args.version,
			chainId: args.chainId,
			verifyingContract: args.token
		},
		types: PERMIT_TYPES,
		primaryType: 'Permit' as const,
		message: {
			owner: args.owner,
			spender: args.spender,
			value: args.value,
			nonce: args.nonce,
			deadline: args.deadline
		}
	}
}

/** Solidity `Permit2612Sig` struct the aggregator expects. */
export type Permit2612Sig = {
	deadline: bigint
	v: number
	r: Hex
	s: Hex
}

/**
 * Split a 65-byte permit signature into the `{ deadline, v, r, s }` tuple
 * `startStreamBot` consumes. Recovers `v` from `yParity` when viem omits it
 * (it returns `27`/`28` for legacy signatures, `yParity` otherwise).
 */
export function toPermit2612Sig(signature: Hex, deadline: bigint): Permit2612Sig {
	const { r, s, v, yParity } = parseSignature(signature)
	const vNum = v !== undefined ? Number(v) : yParity + 27
	return { deadline, v: vNum, r, s }
}
