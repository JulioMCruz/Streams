import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
