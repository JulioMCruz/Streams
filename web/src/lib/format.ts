import { type Address, zeroAddress } from 'viem'

export const SECONDS_PER_DAY = 86_400n

export const isZeroAddress = (a?: Address) =>
	!a || a.toLowerCase() === zeroAddress.toLowerCase()

export const truncate = (a?: string) =>
	a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—'
