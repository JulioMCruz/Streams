#!/usr/bin/env sh
set -e

# The bot reads contract addresses from hardhat-deploy-style files under
# contracts/deployments/<NETWORK_NAME>/<Name>/<Name>.json (json.proxy ?? json.address).
# The contracts are ALREADY deployed; we just materialize those address files
# from env so the target is configurable without rebuilding the image.
# ABIs come from contracts/artifacts/ (compiled at image build time).

NET="${NETWORK_NAME:-baseMainnet}"
DIR="contracts/deployments/${NET}"

write_addr() {
	name="$1"
	addr="$2"
	if [ -z "$addr" ]; then
		echo "[entrypoint] WARN: missing address for ${name} — set STREAM_VAULTS_ADDRESS / STREAM_VAULTS_CONFIG_ADDRESS"
		return
	fi
	mkdir -p "${DIR}/${name}"
	printf '{ "address": "%s" }\n' "$addr" > "${DIR}/${name}/${name}.json"
	echo "[entrypoint] ${name} -> ${addr}"
}

write_addr StreamVaults "$STREAM_VAULTS_ADDRESS"
write_addr StreamVaultsConfig "$STREAM_VAULTS_CONFIG_ADDRESS"

echo "[entrypoint] network=${NET} — starting bot"
exec "$@"
