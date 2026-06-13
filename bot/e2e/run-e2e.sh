#!/usr/bin/env bash
#
# End-to-end orchestration: spins up a local Hardhat node, deploys the mock
# protocol stack, seeds the steady-state scenario, and runs the real bot tick
# against it (user → bot → contract). Tears the node down on exit.
#
# Usage: yarn workspace @streams/bot e2e   (or `yarn e2e` from the bot dir)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS="$ROOT/contracts"
BOT="$ROOT/bot"
RPC="http://127.0.0.1:8545"
NODE_LOG="$(mktemp)"

cleanup() {
	# Kill the whole node process tree; `yarn` spawns hardhat as a child.
	pkill -f "hardhat node" 2>/dev/null || true
}
trap cleanup EXIT

echo "▶ starting hardhat node (log: $NODE_LOG)…"
# --no-deploy: skip hardhat-deploy's auto-run on node start; we deploy the
# `test` tag explicitly below (the core `deploy` tag needs per-chain protocol
# addresses that aren't configured for the local chainId).
(cd "$CONTRACTS" && yarn hardhat node --no-deploy >"$NODE_LOG" 2>&1) &

echo "▶ waiting for JSON-RPC to come up…"
for _ in $(seq 1 60); do
	if curl -s "$RPC" -H 'content-type: application/json' \
		-d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' >/dev/null 2>&1; then
		break
	fi
	sleep 1
done

# OpenZeppelin's UUPS proxy deploys wait for block confirmations; the node's
# default auto-mine only mines on a tx, so deployProxy would hang forever.
# Interval mining produces the follow-up blocks and unblocks it.
echo "▶ enabling interval mining…"
curl -s "$RPC" -H 'content-type: application/json' \
	-d '{"jsonrpc":"2.0","id":1,"method":"evm_setIntervalMining","params":[1000]}' >/dev/null

# wagmi/viem batch reads through Multicall3, which Hardhat doesn't predeploy.
echo "▶ deploying Multicall3 at its canonical address…"
(cd "$CONTRACTS" && RPC_URL="$RPC" node scripts/setup-multicall3.mjs)

# Fresh chain each run → discard stale localhost deployment artifacts so the
# addresses match the contracts actually deployed on this node.
echo "▶ deploying mocks + core (test tag)…"
rm -rf "$CONTRACTS/deployments/localhost"
(cd "$CONTRACTS" && yarn hardhat deploy --network localhost --tags test)

echo "▶ seeding e2e scenario…"
(cd "$CONTRACTS" && yarn hardhat run scripts/e2e-setup.ts --network localhost)

echo "▶ running bot tick…"
(cd "$BOT" && yarn tsx e2e/run-tick.ts)
