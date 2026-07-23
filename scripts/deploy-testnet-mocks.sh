#!/usr/bin/env bash
# Deploys the full testnet mock rig to Arbitrum Sepolia: MockUsdc, four MockVault instances
# (stand-ins for Morpho/Fluid/Euler/Aave-Stata), the real vault-core, and four real
# vault-adapter instances wired vault->adapter->core — everything the Sepolia e2e needs to
# exercise the production deposit/rebalance/redeem plumbing with controllable on-chain state.
#
# vault-core and vault-adapter are built with `--features testnet`, which swaps their compiled
# USDC constant to the deployed MockUsdc address. **The testnet artifacts must never be deployed
# to mainnet.** The mainnet rig (`scripts/deploy-adapters.sh`, docs/RUNBOOK-M2.md) is untouched.
#
# Two-step bootstrap: the MockUsdc address only exists after its own deploy, and the adapter/core
# carry it as a compile-time constant. First run deploys MockUsdc, then STOPS with instructions to
# update the `testnet` constants; the second run verifies the constants match and continues. The
# env file makes re-runs resume instead of redeploying.
#
# Required env vars:
#   ARB_SEPOLIA_RPC_URL  - Arbitrum Sepolia RPC endpoint
#
# Optional env vars:
#   KEY_PATH             - file holding the Sepolia deployer key (default: ~/.wakeup-sepolia.key)
#   MAX_FEE_GWEI         - gas-price ceiling (default: 0.1)
#   MOCK_USDC_ADDR etc.  - any address already recorded in docs/.sepolia-env is reused
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${ARB_SEPOLIA_RPC_URL:?Set ARB_SEPOLIA_RPC_URL}"
KEY_PATH="${KEY_PATH:-$HOME/.wakeup-sepolia.key}"
MAX_FEE_GWEI="${MAX_FEE_GWEI:-0.1}"
ENV_OUT="$ROOT/docs/.sepolia-env"

ADAPTER_CONST_FILE="$ROOT/packages/contracts/vault-adapter/src/adapter.rs"
CORE_CONST_FILE="$ROOT/packages/contracts/vault-core/src/core.rs"

# 1,000 mock USDC (6 decimals) minted to the deployer so the e2e always has balance.
MINT_UNITS=1000000000

# --- Preflight ------------------------------------------------------------------------------

[ -r "$KEY_PATH" ] || { echo "No key file at $KEY_PATH" >&2; exit 1; }

DEPLOYER="$(cast wallet address --private-key "$(cat "$KEY_PATH")")"
echo "Sepolia deployer (owner of the whole rig): $DEPLOYER"

CHAIN_ID="$(cast chain-id --rpc-url "$ARB_SEPOLIA_RPC_URL")"
[ "$CHAIN_ID" = "421614" ] || { echo "RPC is chain $CHAIN_ID, expected 421614 (Arbitrum Sepolia)" >&2; exit 1; }

ETH_BAL="$(cast balance "$DEPLOYER" --rpc-url "$ARB_SEPOLIA_RPC_URL")"
[ "$ETH_BAL" != "0" ] || { echo "Deployer has no Sepolia ETH for gas" >&2; exit 1; }

echo "Preflight OK: $ETH_BAL wei ETH"

# --no-verify below skips the reproducible Docker build: these are disposable testnet fixtures,
# Arbiscan source verification is not a deliverable here. The key still needs to be repo-local
# only for Docker builds, but keep the same gitignored-copy + trap pattern for consistency.
TMP_KEY="$ROOT/.deploy-key.tmp"
trap 'rm -f "$TMP_KEY"' EXIT
(umask 077 && cp "$KEY_PATH" "$TMP_KEY")

DEPLOYED_ADDR=""

# deploy_one <contract-name> [extra cargo-stylus flags...]
deploy_one() {
  local name="$1" out
  shift

  out="$(cd "$ROOT" && cargo stylus deploy \
    --contract="$name" \
    --endpoint="$ARB_SEPOLIA_RPC_URL" \
    --private-key-path=".deploy-key.tmp" \
    --max-fee-per-gas-gwei="$MAX_FEE_GWEI" \
    --no-verify \
    "$@" 2>&1 | tee /dev/stderr)"

  DEPLOYED_ADDR="$(printf '%s' "$out" \
    | sed -E 's/\x1b\[[0-9;]*m//g' \
    | grep -oiE "deployed code at address:? *0x[a-fA-F0-9]{40}" \
    | grep -oE "0x[a-fA-F0-9]{40}" | tail -1)"
  [ -n "$DEPLOYED_ADDR" ] || { echo "Could not parse the deployed address for $name" >&2; exit 1; }
  echo "$name: deployed at $DEPLOYED_ADDR"
}

send() {
  cast send "$@" --rpc-url "$ARB_SEPOLIA_RPC_URL" --private-key "$(cat "$KEY_PATH")" >/dev/null
}

# Persist incrementally so any mid-run failure resumes instead of redeploying.
save_env() {
  {
    echo "export MOCK_USDC_ADDR=${MOCK_USDC_ADDR:-}"
    echo "export MOCK_MORPHO_VAULT=${MOCK_MORPHO_VAULT:-}"
    echo "export MOCK_FLUID_VAULT=${MOCK_FLUID_VAULT:-}"
    echo "export MOCK_EULER_VAULT=${MOCK_EULER_VAULT:-}"
    echo "export MOCK_AAVE_VAULT=${MOCK_AAVE_VAULT:-}"
    echo "export TESTNET_CORE_ADDR=${TESTNET_CORE_ADDR:-}"
    echo "export TESTNET_MORPHO_ADAPTER_ADDR=${TESTNET_MORPHO_ADAPTER_ADDR:-}"
    echo "export TESTNET_FLUID_ADAPTER_ADDR=${TESTNET_FLUID_ADAPTER_ADDR:-}"
    echo "export TESTNET_EULER_ADAPTER_ADDR=${TESTNET_EULER_ADAPTER_ADDR:-}"
    echo "export TESTNET_AAVE_ADAPTER_ADDR=${TESTNET_AAVE_ADAPTER_ADDR:-}"
  } >"$ENV_OUT"
}

[ -r "$ENV_OUT" ] && . "$ENV_OUT"

# --- Step 1: MockUsdc -----------------------------------------------------------------------

if [ -n "${MOCK_USDC_ADDR:-}" ]; then
  echo "MockUsdc: reusing $MOCK_USDC_ADDR"
else
  deploy_one mock-usdc
  MOCK_USDC_ADDR="$DEPLOYED_ADDR"
  save_env
fi

# The adapter/core `testnet` USDC constant must equal the deployed MockUsdc — a mismatch would
# point the whole rig at a dead address. Grep the line under the #[cfg(feature = "testnet")] gate.
check_const() {
  local file="$1" have
  have="$(grep -A1 '#\[cfg(feature = "testnet")\]' "$file" | grep -oE 'address!\("[0-9a-fA-F]{40}"\)' | grep -oE '[0-9a-fA-F]{40}' | head -1)"
  if [ "$(echo "$have" | tr 'A-F' 'a-f')" != "$(echo "${MOCK_USDC_ADDR#0x}" | tr 'A-F' 'a-f')" ]; then
    echo "" >&2
    echo "STOP: the testnet USDC constant in $file is 0x$have but MockUsdc deployed at $MOCK_USDC_ADDR." >&2
    echo "Update the #[cfg(feature = \"testnet\")] USDC constant in BOTH files to:" >&2
    echo "    const USDC: Address = address!(\"${MOCK_USDC_ADDR#0x}\");" >&2
    echo "  - $ADAPTER_CONST_FILE" >&2
    echo "  - $CORE_CONST_FILE" >&2
    echo "then re-run this script (it resumes from $ENV_OUT, nothing is redeployed)." >&2
    exit 1
  fi
}
check_const "$ADAPTER_CONST_FILE"
check_const "$CORE_CONST_FILE"
echo "testnet USDC constants match $MOCK_USDC_ADDR"

# --- Step 2: four MockVault instances -------------------------------------------------------

# Idempotent init: maxWithdraw(address) is behind ensure_initialized, so it answers iff init took.
init_mock_vault() {
  local name="$1" vault="$2"
  if cast call "$vault" "maxWithdraw(address)(uint256)" "$DEPLOYER" --rpc-url "$ARB_SEPOLIA_RPC_URL" >/dev/null 2>&1; then
    echo "$name: already initialised"
  else
    echo "$name: init(asset=$MOCK_USDC_ADDR, owner=$DEPLOYER)"
    send "$vault" "init(address,address)" "$MOCK_USDC_ADDR" "$DEPLOYER"
  fi
}

for name in MORPHO FLUID EULER AAVE; do
  var="MOCK_${name}_VAULT"
  if [ -n "${!var:-}" ]; then
    echo "MockVault[$name]: reusing ${!var}"
  else
    deploy_one mock-vault
    declare "$var=$DEPLOYED_ADDR"
    save_env
  fi
  init_mock_vault "MockVault[$name]" "${!var}"
done

# --- Step 3: vault-core (testnet build) -----------------------------------------------------

if [ -n "${TESTNET_CORE_ADDR:-}" ]; then
  echo "vault-core: reusing $TESTNET_CORE_ADDR"
else
  deploy_one vault-core --features testnet
  TESTNET_CORE_ADDR="$DEPLOYED_ADDR"
  save_env
  echo "vault-core: init(owner=$DEPLOYER)"
  send "$TESTNET_CORE_ADDR" "init(address)" "$DEPLOYER"
fi

# --- Step 4: four vault-adapter instances (testnet build) -----------------------------------

init_adapter() {
  local name="$1" adapter="$2" vault="$3"
  if cast call "$adapter" "maxWithdraw()(uint256)" --rpc-url "$ARB_SEPOLIA_RPC_URL" >/dev/null 2>&1; then
    echo "$name: already initialised"
  else
    echo "$name: init(vault=$vault, core=$TESTNET_CORE_ADDR)"
    send "$adapter" "init(address,address)" "$vault" "$TESTNET_CORE_ADDR"
  fi
}

for name in MORPHO FLUID EULER AAVE; do
  vault_var="MOCK_${name}_VAULT"
  adapter_var="TESTNET_${name}_ADAPTER_ADDR"
  if [ -n "${!adapter_var:-}" ]; then
    echo "adapter[$name]: reusing ${!adapter_var}"
  else
    deploy_one vault-adapter --features testnet
    declare "$adapter_var=$DEPLOYED_ADDR"
    save_env
  fi
  init_adapter "adapter[$name]" "${!adapter_var}" "${!vault_var}"
done

# --- Step 5: register adapters + bootstrap allocation ---------------------------------------

# addAdapter is not idempotent (AdapterAlreadyRegistered), so simulate first and only send when
# the simulation succeeds — a resumed run skips already-registered adapters without spending gas.
for name in MORPHO FLUID EULER AAVE; do
  adapter_var="TESTNET_${name}_ADAPTER_ADDR"
  if cast call --from "$DEPLOYER" "$TESTNET_CORE_ADDR" "addAdapter(address)" "${!adapter_var}" --rpc-url "$ARB_SEPOLIA_RPC_URL" >/dev/null 2>&1; then
    echo "core.addAdapter(${!adapter_var}) [$name]"
    send "$TESTNET_CORE_ADDR" "addAdapter(address)" "${!adapter_var}"
  else
    echo "core: adapter[$name] already registered"
  fi
done

# Bootstrap allocation 25/25/25/25. With an empty pool rebalance only writes weights (zero slices
# are skipped by design), and on a resumed run with funds it just unwinds+redeposits — harmless.
echo "core.rebalance -> 2500 bps x4"
send "$TESTNET_CORE_ADDR" "rebalance(address[],uint256[])" \
  "[$TESTNET_MORPHO_ADAPTER_ADDR,$TESTNET_FLUID_ADAPTER_ADDR,$TESTNET_EULER_ADAPTER_ADDR,$TESTNET_AAVE_ADAPTER_ADDR]" \
  "[2500,2500,2500,2500]"

# --- Step 6: mint mock USDC to the deployer -------------------------------------------------

USDC_BAL="$(cast call "$MOCK_USDC_ADDR" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$ARB_SEPOLIA_RPC_URL" | cut -d' ' -f1)"
if [ "$USDC_BAL" -lt "$MINT_UNITS" ]; then
  echo "MockUsdc.mint($DEPLOYER, $MINT_UNITS)"
  send "$MOCK_USDC_ADDR" "mint(address,uint256)" "$DEPLOYER" "$MINT_UNITS"
else
  echo "MockUsdc: deployer already holds $USDC_BAL units"
fi

save_env
echo
echo "Wrote $ENV_OUT:"
cat "$ENV_OUT"
echo
echo "Next — the Sepolia e2e:"
echo "  source $ENV_OUT"
echo "  ARB_SEPOLIA_RPC_URL=$ARB_SEPOLIA_RPC_URL SEPOLIA_WALLET_KEY=\$(cat $KEY_PATH) \\"
echo "    cargo test -p adapter-e2e --test sepolia_core_flow --test sepolia_edge_cases -- --test-threads=1 --nocapture"
