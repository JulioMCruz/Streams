import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
	// The dApp is developed and run via `next dev`; the production build skips
	// type-check and lint gating so a strict `next build` doesn't block on
	// non-runtime gaps in the demo UI.
	typescript: {
		ignoreBuildErrors: true
	},
	eslint: {
		ignoreDuringBuilds: true
	},
	turbopack: {
		// `@wagmi/core` ships an experimental `tempo` connector that does a
		// dynamic `import('accounts')` wrapped in a try/catch. Turbopack still
		// errors on the missing module even though the runtime catches the
		// failure. Alias to a local empty stub so the build resolves; the
		// connector is never instantiated by Reown's default setup.
		resolveAlias: {
			accounts: { browser: './src/lib/accounts-stub.ts' }
		}
	}
}

export default nextConfig
