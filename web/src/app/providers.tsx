'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { WagmiProvider } from 'wagmi'

import '@/lib/reown'
import { wagmiConfig } from '@/lib/wagmi'
import { WalletProvider } from '@/lib/wallet-context'

export function Providers({ children }: { children: ReactNode }) {
	const [queryClient] = useState(() => new QueryClient())

	return (
		<WagmiProvider config={wagmiConfig}>
			<QueryClientProvider client={queryClient}>
				<WalletProvider>{children}</WalletProvider>
			</QueryClientProvider>
		</WagmiProvider>
	)
}
