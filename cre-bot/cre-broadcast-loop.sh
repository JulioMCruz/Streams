#!/usr/bin/env bash
# CRE BROADCAST LOOP — runs the CRE workflow in a loop WITH --broadcast, so the
# DON-attested report actually lands on-chain via the KeystoneForwarder →
# StreamVaults.onReport (executeSwap / closeStreamIfLow). This is the CRE
# running "in place of" the Node bot on Base mainnet.
#
# Prereqs (already done in this session):
#   - config.bot() set to the simulator forwarder 0x5E342… (so onReport accepts)
#   - tick/config.production.json has a working uniswapApiKey (local only)
#   - tick/src/utils/write-report.ts sends the raw executeSwap calldata + gasConfig
#
# Stop with: pkill -f cre-broadcast-loop
export PATH="$HOME/.cre/bin:$HOME/.bun/bin:$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"
i=0
while true; do
  i=$((i+1))
  echo ""
  echo "════════ CRE BROADCAST · tick #$i · $(date -u +%H:%M:%S)Z ════════"
  # `timeout` so a hung RPC/quote/tx never freezes the whole loop — a stuck tick
  # is killed after 100s and the loop moves on to the next.
  timeout 100 cre workflow simulate ./tick --target=production-settings --broadcast 2>&1 \
    | grep -E '\[USER LOG\]|execute_swap_submitted|stream_auto_closed|txHash' \
    | sed -E 's/.*\[USER LOG\] \[cre-tick\] /  /'
  [ "${PIPESTATUS[0]}" = "124" ] && echo "  ⏱️  tick timed out (100s) — skipping to next"
  sleep 30
done
