'use client'

import { useState } from 'react'
import type { Address } from 'viem'
import { useAccount, useReadContract } from 'wagmi'

import { ADDRESSES, streamVaultsAbi } from '@/lib/contracts'
import { isZeroAddress } from '@/lib/format'

import { Dashboard } from './_components/Dashboard'
import { Landing } from './_components/Landing'
import { Onboarding } from './_components/Onboarding'
import { PublicDashboard } from './_components/PublicDashboard'
import { TopNav } from './_components/TopNav'

export default function Page() {
	const { address, isConnected } = useAccount()

	// Read-only bot the visitor is exploring from the landing gallery/search.
	const [exploreBot, setExploreBot] = useState<Address | null>(null)
	// Force the landing even when connected (e.g. clicking the nav brand).
	const [showLanding, setShowLanding] = useState(false)

	const goHome = () => {
		setExploreBot(null)
		setShowLanding(true)
	}

	const smartAccountQuery = useReadContract({
		address: ADDRESSES.streamVaults,
		abi: streamVaultsAbi,
		functionName: 'smartAccountOf',
		args: address ? [address] : undefined,
		query: { enabled: Boolean(address) }
	})
	const smartAccount = smartAccountQuery.data as Address | undefined
	const hasSmartAccount = !isZeroAddress(smartAccount)

	// Selecting a bot (from a gallery/search). Your own bot opens the full
	// dashboard (you can drive it); anyone else's opens read-only.
	const selectBot = (sa: Address) => {
		if (smartAccount && sa.toLowerCase() === smartAccount.toLowerCase()) {
			setExploreBot(null)
			setShowLanding(false)
		} else {
			setExploreBot(sa)
		}
	}

	return (
		<>
			<TopNav onHome={goHome} />
			<main className="flex-1 min-h-0 overflow-y-auto">
				{exploreBot ? (
					// Read-only bot view — works connected or not.
					<PublicDashboard
						smartAccount={exploreBot}
						onBack={() => setExploreBot(null)}
					/>
				) : showLanding ? (
					// Brand-triggered landing, even when connected.
					<Landing
						onSelectBot={selectBot}
						isConnected={Boolean(isConnected && address)}
						onEnter={() => setShowLanding(false)}
					/>
				) : !isConnected || !address ? (
					<Landing
						onSelectBot={selectBot}
						isConnected={false}
						onEnter={() => setShowLanding(false)}
					/>
				) : hasSmartAccount && smartAccount ? (
					<Dashboard
						userAddress={address}
						smartAccount={smartAccount}
						onSelectBot={selectBot}
					/>
				) : (
					<Onboarding
						userAddress={address}
						refetchSa={smartAccountQuery.refetch}
					/>
				)}
			</main>
		</>
	)
}
