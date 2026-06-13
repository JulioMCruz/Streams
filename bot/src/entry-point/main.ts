import { UniswapQuoteProvider } from "../adapters/uniswap-quote-provider";
import { ViemChainStateAdapter } from "../adapters/viem-chain-state";
import { createClients } from "../adapters/viem-clients";
import { ViemSmartAccountRegistryAdapter } from "../adapters/viem-smart-account-registry";
import { ViemStreamGuardAdapter } from "../adapters/viem-stream-guard";
import { ViemSwapExecutorAdapter } from "../adapters/viem-swap-executor";
import { ViemSwapGatewayAdapter } from "../adapters/viem-swap-gateway";
import { loadConfig } from "../settings/config";
import { TickCircuitBreaker } from "../use-cases/loop-policy";
import { RunDcaTickUseCase } from "../use-cases/run-dca-tick";
import { formatError } from "../utils/format-error";
import { getLogger } from "../utils/logger";

/**
 * Driving adapter for the bot. Analogous to the Lambda handler in the
 * Fireblocks adapter, but the "trigger" is a poll loop instead of an AWS
 * event. Responsibilities, in order:
 *   1. load + validate config            [settings]
 *   2. build infra clients               [adapters]
 *   3. wire driven adapters into the use case
 *   4. run the use case (once, or on an interval)
 *
 * No business logic lives here — it only assembles the graph and drives
 * it. Swapping the signer for a Chainlink CRE workflow means changing
 * this file and one adapter, nothing else.
 */
async function main(): Promise<void> {
  const logger = getLogger("streambot");
  const config = loadConfig();
  const clients = createClients(config);

  const useCase = new RunDcaTickUseCase({
    registry: new ViemSmartAccountRegistryAdapter({
      // Discovery uses the logs RPC (wide getLogs); everything else uses the
      // main RPC. Same endpoint unless RPC_HTTPS_LOGS is set.
      publicClient: clients.logsPublicClient,
      streamVaults: config.addresses.streamVaults,
      fromBlock: config.discoveryFromBlock,
    }),
    chain: new ViemChainStateAdapter(clients.publicClient),
    gateway: new ViemSwapGatewayAdapter({
      publicClient: clients.publicClient,
      streamVaults: config.addresses.streamVaults,
    }),
    quotes: new UniswapQuoteProvider({
      apiBase: config.uniswap.apiBase,
      apiKey: config.uniswap.apiKey,
      chainId: config.chain.id,
      logger,
    }),
    executor: new ViemSwapExecutorAdapter({
      publicClient: clients.publicClient,
      walletClient: clients.walletClient,
      account: clients.account,
      streamVaults: config.addresses.streamVaults,
    }),
    guard: new ViemStreamGuardAdapter({
      publicClient: clients.publicClient,
      walletClient: clients.walletClient,
      account: clients.account,
      streamVaults: config.addresses.streamVaults,
    }),
    strategy: config.strategy,
    logger,
  });

  const block = await clients.publicClient.getBlockNumber();
  logger.info(
    {
      chainId: config.chain.id,
      block,
      bot: clients.botAddress,
      streamVaults: config.addresses.streamVaults,
      streamVaultsConfig: config.addresses.streamVaultsConfig,
    },
    "bot_started",
  );

  if (config.runOnce) {
    await useCase.tick();
    return;
  }

  // H-05: exponential backoff + circuit breaker so a sustained RPC/API
  // outage doesn't hammer upstream every pollIntervalMs forever.
  const breaker = new TickCircuitBreaker({
    baseMs: config.pollIntervalMs,
    maxMs: config.pollIntervalMs * 20,
    maxConsecutiveFailures: 5,
  });

  for (;;) {
    try {
      await useCase.tick();
      breaker.recordSuccess();
    } catch (err) {
      breaker.recordFailure();
      logger.error(
        { err: formatError(err), consecutiveFailures: breaker.consecutiveFailures },
        "tick_failed",
      );
      if (breaker.isOpen()) {
        logger.warn(
          { consecutiveFailures: breaker.consecutiveFailures },
          "tick_circuit_open_backing_off",
        );
      }
    }
    await new Promise((r) => setTimeout(r, breaker.nextDelayMs()));
  }
}

main().catch((err) => {
  getLogger("streambot").error({ err: formatError(err) }, "fatal");
  process.exit(1);
});
