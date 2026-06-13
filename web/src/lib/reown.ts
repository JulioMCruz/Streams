import { createAppKit } from '@reown/appkit/react'

import { networks, PROJECT_ID, wagmiAdapter } from './wagmi'

const metadata = {
	name: 'StreamVaults',
	description:
		'Capital streaming as a security layer for DeFi strategies. Pay your bot while you use it.',
	url: 'https://streamvault.eth',
	icons: []
}

/// AppKit must be initialized once on the client. This module is imported
/// from `providers.tsx` so the side effect runs in the browser.
createAppKit({
	adapters: [wagmiAdapter],
	networks,
	projectId: PROJECT_ID,
	metadata,
	features: {
		analytics: false
	}
})
