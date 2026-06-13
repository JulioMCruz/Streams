import {
	CronCapability,
	EVMClient,
	handler,
	HTTPClient,
	Runner,
	type Runtime,
} from '@chainlink/cre-sdk'

import { CreChainState } from '../adapters/cre-chain-state'
import { CreSmartAccountRegistry } from '../adapters/cre-smart-account-registry'
import { CreStreamGuard } from '../adapters/cre-stream-guard'
import { CreSwapExecutor } from '../adapters/cre-swap-executor'
import { CreSwapGateway } from '../adapters/cre-swap-gateway'
import { HttpQuoteProvider } from '../adapters/http-quote-provider'
import { type Config, resolveConfig } from '../settings/config'
import { RunDcaTickUseCase } from '../use-cases/run-dca-tick'
import { getLogger } from '../utils/logger'

export type { Config }

/**
 * Driving adapter — the CRE analogue of the baseline bot's
 * `entry-point/main.ts` poll loop. The cron trigger fires the tick on a
 * schedule, so there is no `loop-policy`/backoff here: the DON owns the
 * cadence and retries. This handler does ONLY wiring — resolve config,
 * build the CRE clients + adapters, inject them into the reused
 * `RunDcaTickUseCase`, and run one tick. No business logic lives here.
 *
 * `runtime` is per-trigger and every CRE capability call needs it, so the
 * adapters are constructed here (where the runtime exists) and close over
 * it. The use case stays runtime-agnostic.
 */
export const onCronTrigger = async (runtime: Runtime<Config>): Promise<string> => {
	const cfg = resolveConfig(runtime.config)
	const logger = getLogger(runtime, 'cre-tick')

	const evm = new EVMClient(cfg.chainSelector)
	const http = new HTTPClient()

	const useCase = new RunDcaTickUseCase({
		registry: new CreSmartAccountRegistry(runtime, evm, cfg),
		chain: new CreChainState(runtime, evm, cfg),
		gateway: new CreSwapGateway(runtime, evm, cfg),
		quotes: new HttpQuoteProvider(runtime, http, cfg),
		executor: new CreSwapExecutor(runtime, evm, cfg),
		guard: new CreStreamGuard(runtime, evm, cfg),
		strategy: cfg.strategy,
		logger,
	})

	await useCase.tick()
	return 'tick complete'
}

export const initWorkflow = (config: Config) => {
	const cron = new CronCapability()

	return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
	const runner = await Runner.newRunner<Config>()
	await runner.run(initWorkflow)
}

// The CRE runtime drives the workflow by executing this module, so `main()`
// must run for the Runner to register `initWorkflow`'s handlers and answer the
// subscribe/trigger phases. This matches the SDK's own conformance workflows
// (`@chainlink/cre-sdk` standard_tests), which all end with `await main()`.
// Guard: only invoke main() when the WASM host bindings are present so that
// unit tests can import `initWorkflow` without triggering the Runner.
if (typeof (globalThis as Record<string, unknown>).log === 'function') {
	await main()
}
