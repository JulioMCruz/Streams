import { test } from '@chainlink/cre-sdk/test'
import { describe, expect } from 'bun:test'

import type { Config } from '../../src/entry-point/main'
import { initWorkflow } from '../../src/entry-point/main'

// Minimal valid config for wiring tests. Addresses are zero/placeholder —
// these tests exercise the workflow graph (cron schedule + handler), not the
// adapters (which are skeleton stubs that throw). The DCA tick itself is
// covered by the reused use-case unit tests ported from bot/test.
const baseConfig: Config = {
	schedule: '*/30 * * * * *',
	chainSelector: '0',
	chainId: 0,
	addresses: {
		streamVaults: '0x0000000000000000000000000000000000000000',
		streamVaultsConfig: '0x0000000000000000000000000000000000000000',
		superTokenIn: '0x0000000000000000000000000000000000000000',
		tokenIn: '0x0000000000000000000000000000000000000000',
	},
	discoveryFromBlock: '0',
	superTokenDecimals: 18,
	underlyingDecimals: 6,
	uniswapApiBase: 'https://trading-api-labs.interface.gateway.uniswap.org',
}

describe('initWorkflow', () => {
	test('returns one handler wired to the configured cron schedule', async () => {
		const testSchedule = '0 0 * * *'
		const config: Config = { ...baseConfig, schedule: testSchedule }

		const handlers = initWorkflow(config)

		expect(handlers).toBeArray()
		expect(handlers).toHaveLength(1)
		// CronTrigger exposes .config.schedule but the public Trigger<> interface
		// only declares capabilityId/method/outputSchema/configAsAny/adapt — cast
		// to access the concrete runtime property without importing the private class.
		expect(
			(handlers[0]!.trigger as unknown as { config: { schedule: string } }).config.schedule,
		).toBe(testSchedule)
	})

	// TODO(skeleton): once the CRE adapters are implemented, add a tick test
	// that mocks the EVM/HTTP capabilities (see @chainlink/cre-sdk/test:
	// evm-contract-mock) and asserts discover → decide → executeSwap, mirroring
	// bot/test/use-cases/run-dca-tick.test.ts.
})
