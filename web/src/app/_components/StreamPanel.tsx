'use client'

import { type Address, formatUnits } from 'viem'
import {
	useReadContract,
	useWaitForTransactionReceipt,
	useWriteContract
} from 'wagmi'

import {
	ADDRESSES,
	cfaForwarderAbi,
	smartAccountAbi,
	streamVaultsAbi
} from '@/lib/contracts'
import { SECONDS_PER_DAY } from '@/lib/format'

import { Card } from './Card'
import { Field, inputCls } from './Field'
import { TxButton } from './TxButton'

/// Cadence anchor: the stream delivers exactly one `minTradeAmount` every N
/// seconds, so the bot can trade once per window. 30s matches the demo cadence.
const TRADE_CADENCE_SECONDS = 30n

/**
 * Stream control panel. Open / update / close the USDCx flow into the bot,
 * and grant / revoke Superfluid's operator permission (the nuclear kill
 * switch). Mirrors the on-chain CFA state via `getFlowrate`.
 */
export function StreamPanel({
	userAddress,
	smartAccount
}: {
	userAddress: Address
	smartAccount: Address
}) {
	const flowrateQuery = useReadContract({
		address: ADDRESSES.cfaForwarder,
		abi: cfaForwarderAbi,
		functionName: 'getFlowrate',
		args: [ADDRESSES.usdcx, userAddress, smartAccount],
		query: { refetchInterval: 5_000 }
	})

	// The stream rate is DERIVED from the bot's rules (min trade), not typed —
	// so opening a stream always matches what the user configured.
	const rulesQuery = useReadContract({
		address: smartAccount,
		abi: smartAccountAbi,
		functionName: 'rules',
		query: { refetchInterval: 5_000 }
	})

	const { writeContract, data: txHash, isPending } = useWriteContract()
	const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
		hash: txHash
	})
	if (isSuccess) void flowrateQuery.refetch()

	const currentRate = (flowrateQuery.data as bigint | undefined) ?? 0n
	const currentPerDay = currentRate * SECONDS_PER_DAY
	const streamActive = currentRate > 0n
	const busy = isPending || confirming

	// rules() → [maxSlippageBps, minTradeAmount (USDC, 6 dec), settlementAddress]
	const rules = rulesQuery.data as
		| readonly [number, bigint, Address]
		| undefined
	const minTradeAmount = rules?.[1] ?? 0n
	const rulesSet = minTradeAmount > 0n
	// Deliver one min-trade every TRADE_CADENCE_SECONDS. USDCx is 18-dec, USDC
	// 6-dec, so scale by 10^12: flowrate (wei/s) = minTrade·10^12 / cadence.
	const derivedFlowrate = (minTradeAmount * 10n ** 12n) / TRADE_CADENCE_SECONDS
	const derivedPerDay = derivedFlowrate * SECONDS_PER_DAY

	const grant = () =>
		writeContract({
			address: ADDRESSES.cfaForwarder,
			abi: cfaForwarderAbi,
			functionName: 'grantPermissions',
			args: [ADDRESSES.usdcx, ADDRESSES.streamVaults]
		})

	const revoke = () =>
		writeContract({
			address: ADDRESSES.cfaForwarder,
			abi: cfaForwarderAbi,
			functionName: 'revokePermissions',
			args: [ADDRESSES.usdcx, ADDRESSES.streamVaults]
		})

	const setStreamFlowrate = (flowrate: bigint) =>
		writeContract({
			address: ADDRESSES.streamVaults,
			abi: streamVaultsAbi,
			functionName: 'setStream',
			args: [smartAccount, ADDRESSES.usdcx, flowrate]
		})

	return (
		<Card
			title="Stream control"
			subtitle="Open, update, or close the USDCx flow. Revoke at any time — the bot loses access in the next block."
			tone={streamActive ? 'success' : 'active'}
		>
			<div className="mb-4 flex items-center gap-2 text-sm">
				<span
					className={`h-2 w-2 rounded-full ${streamActive ? 'bg-emerald-400' : 'bg-zinc-600'}`}
				/>
				<span className="text-zinc-300">
					{streamActive
						? `${formatUnits(currentPerDay, 18)} USDCx/day`
						: 'No active stream'}
				</span>
			</div>

			<div className="flex flex-wrap items-end gap-3">
				<Field
					label="Stream rate (USDCx/day) · from your rules"
					className="grow"
				>
					<input
						value={rulesSet ? formatUnits(derivedPerDay, 18) : '—'}
						readOnly
						disabled
						className={`${inputCls} cursor-not-allowed opacity-70`}
					/>
				</Field>
				<TxButton
					onClick={() => setStreamFlowrate(derivedFlowrate)}
					pending={busy}
					disabled={!rulesSet}
				>
					{streamActive ? 'Update' : 'Open stream'}
				</TxButton>
				{streamActive ? (
					<TxButton
						tone="danger"
						onClick={() => setStreamFlowrate(0n)}
						pending={busy}
					>
						Close
					</TxButton>
				) : null}
			</div>
			<p className="mt-2 text-xs text-zinc-500">
				{rulesSet ? (
					<>
						Derived from your min trade ({formatUnits(minTradeAmount, 6)} USDC) —
						one trade every {TRADE_CADENCE_SECONDS.toString()}s. Set it in{' '}
						<span className="text-zinc-400">Manage → Rules</span>.
					</>
				) : (
					<>Set your trading rules first (Manage → Rules) to open a stream.</>
				)}
			</p>

			<div className="mt-4 flex flex-wrap gap-2">
				<TxButton tone="ghost" onClick={grant} pending={busy}>
					Grant permissions
				</TxButton>
				<TxButton tone="ghost" onClick={revoke} pending={busy}>
					Revoke (kill switch)
				</TxButton>
			</div>
		</Card>
	)
}
