#!/usr/bin/env bash
# Deploys three instances of the SAME vault-adapter WASM to Arbitrum One, one per protocol, and
# init's each one against its own vault (Phase 9 Plan 6, D-01: one blueprint, three instances —
# never one instance serving three vaults).
#
# Activation is cached per codehash, so only the first of the three deploys pays the ArbWasm
# activation cost; the other two are code-deposit only.
#
# The `core` of every instance is the M2 wallet itself — the interim EOA core for this phase
# (D-04). These three instances are disposable: Phase 11 deploys production instances pointed at
# the real core contract, and no fund migration from these is designed.
#
# Required env vars:
#   (none — everything has a default; override any of the vars below)
#
# Optional env vars:
#   ARB_ONE_RPC_URL          - Arbitrum One RPC endpoint (default: public arb1)
#   KEY_PATH                 - file holding the M2 private key (default: ~/.wakeup-m2-arb1.key)
#   MAX_FEE_GWEI             - gas-price ceiling, guards against a fee spike draining the wallet
#   MORPHO_ADAPTER_ADDR      - set to skip that protocol's deploy (resume after a partial run)
#   FLUID_ADAPTER_ADDR       - idem
#   EULER_ADAPTER_ADDR       - idem
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ARB_ONE_RPC_URL="${ARB_ONE_RPC_URL:-https://arb1.arbitrum.io/rpc}"
KEY_PATH="${KEY_PATH:-$HOME/.wakeup-m2-arb1.key}"
MAX_FEE_GWEI="${MAX_FEE_GWEI:-0.1}"
ENV_OUT="$ROOT/docs/.m2-env"

# Deploy targets on Arbitrum One (DISCOVERY.md §2/§3, ADR 001 as amended 2026-07-21).
USDC="0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
MORPHO_VAULT="0x7e97fa6893871A2751B5fE961978DCCb2c201E65" # gtUSDCc  (Gauntlet USDC Core)
FLUID_VAULT="0x1A996cb54bb95462040408C06122D45D6Cdb6096"  # fUSDC
EULER_VAULT="0x6afb8d3f6d4a34e9cb2f217317f4dc8e05aa673b"  # eUSDC-2

MIN_USDC=10000000 # 10 USDC at 6 decimals

# --- Preflight: fail loudly before spending anything (RESEARCH Pitfall 4) -------------------

[ -r "$KEY_PATH" ] || { echo "No key file at $KEY_PATH — see docs/RUNBOOK-M2.md" >&2; exit 1; }

# cast has no --private-key-path flag; read the key file inline (contents never echoed).
CORE="$(cast wallet address --private-key "$(cat "$KEY_PATH")")"
echo "M2 wallet (deployer + interim core): $CORE"

CHAIN_ID="$(cast chain-id --rpc-url "$ARB_ONE_RPC_URL")"
[ "$CHAIN_ID" = "42161" ] || { echo "RPC is chain $CHAIN_ID, expected 42161 (Arbitrum One)" >&2; exit 1; }

ETH_BAL="$(cast balance "$CORE" --rpc-url "$ARB_ONE_RPC_URL")"
[ "$ETH_BAL" != "0" ] || { echo "M2 wallet has no ETH for gas" >&2; exit 1; }

USDC_BAL="$(cast call "$USDC" "balanceOf(address)(uint256)" "$CORE" --rpc-url "$ARB_ONE_RPC_URL" | cut -d' ' -f1)"
[ "$USDC_BAL" -ge "$MIN_USDC" ] || { echo "M2 wallet holds $USDC_BAL native USDC, need >= $MIN_USDC" >&2; exit 1; }

# cargo stylus deploy defaults to the reproducible Docker build (no --no-verify, matching M1's
# 07-02 D-05/D-06) — without a running daemon it fails after the wallet checks pass.
docker info >/dev/null 2>&1 || { echo "Docker is not running (needed for the reproducible build)" >&2; exit 1; }

echo "Preflight OK: $ETH_BAL wei ETH, $USDC_BAL USDC (6dp)"

# The reproducible build mounts only the project directory, so a key living in $HOME is invisible
# inside the container ("could not open private key file"). M1 hit this too and solved it with a
# gitignored copy inside the repo (packages/contracts/README.md:204); the trap removes it on any
# exit path, so a mid-script failure never leaves a key sitting in the working tree.
TMP_KEY="$ROOT/.deploy-key.tmp"
trap 'rm -f "$TMP_KEY"' EXIT
(umask 077 && cp "$KEY_PATH" "$TMP_KEY")

# --- One instance per protocol --------------------------------------------------------------

# Revert selectors from src/errors.rs, the ground truth for "did the guard fire".
SEL_NOT_INITIALIZED="0x87138d5c"
SEL_ALREADY_INITIALIZED="0x0dc149f0"

# Deploy sets this rather than echoing, so parsing never has to fight the command's own logging.
DEPLOYED_ADDR=""

deploy_one() {
  local name="$1" out

  # Always deploy by `--contract=` name. M1 (quick 260721-fx3) learned that deploying a
  # prebuilt wasm by path skips the constructor; this adapter has none, but stay on the
  # documented path anyway.
  out="$(cd "$ROOT" && cargo stylus deploy \
    --contract=vault-adapter \
    --endpoint="$ARB_ONE_RPC_URL" \
    --private-key-path=".deploy-key.tmp" \
    --max-fee-per-gas-gwei="$MAX_FEE_GWEI" 2>&1 | tee /dev/stderr)"

  # cargo stylus colours its output, so the address is wrapped in ANSI escapes — strip them
  # before matching or the deploy succeeds while the parse fails (and the gas is already spent).
  DEPLOYED_ADDR="$(printf '%s' "$out" \
    | sed -E 's/\x1b\[[0-9;]*m//g' \
    | grep -oiE "deployed code at address:? *0x[a-fA-F0-9]{40}" \
    | grep -oE "0x[a-fA-F0-9]{40}" | tail -1)"
  [ -n "$DEPLOYED_ADDR" ] || { echo "Could not parse the deployed address for $name" >&2; exit 1; }
  echo "$name: deployed at $DEPLOYED_ADDR"
}

# Idempotent: an instance that already answers maxWithdraw() is initialised, so a resumed run
# neither wastes gas nor trips the one-shot guard by accident.
init_one() {
  local name="$1" adapter="$2" vault="$3" out

  if cast call "$adapter" "maxWithdraw()(uint256)" --rpc-url "$ARB_ONE_RPC_URL" >/dev/null 2>&1; then
    echo "$name: already initialised, skipping init"
  else
    echo "$name: init(vault=$vault, core=$CORE)"
    cast send "$adapter" "init(address,address)" "$vault" "$CORE" \
      --rpc-url "$ARB_ONE_RPC_URL" \
      --private-key "$(cat "$KEY_PATH")"

    # init took iff the guarded view answers: every method calls ensure_initialized() first.
    cast call "$adapter" "maxWithdraw()(uint256)" --rpc-url "$ARB_ONE_RPC_URL" >/dev/null \
      || { echo "$name: still reverts $SEL_NOT_INITIALIZED after init" >&2; exit 1; }
  fi

  # Live proof of the one-shot guard (T-09-11). This tx is expected to revert; the revert data
  # goes into the runbook. Costs one failed tx's gas. Matched by selector, not by message text.
  echo "$name: second init must revert AlreadyInitialized ($SEL_ALREADY_INITIALIZED) —"
  out="$(cast send "$adapter" "init(address,address)" "$vault" "$CORE" \
    --rpc-url "$ARB_ONE_RPC_URL" \
    --private-key "$(cat "$KEY_PATH")" 2>&1 || true)"
  echo "$out"
  case "$out" in
    *"${SEL_ALREADY_INITIALIZED#0x}"*) echo "$name: one-shot guard confirmed" ;;
    *) echo "$name: second init did NOT revert AlreadyInitialized — stop and investigate" >&2; exit 1 ;;
  esac
}

: >"$ENV_OUT"
for spec in "MORPHO:$MORPHO_VAULT" "FLUID:$FLUID_VAULT" "EULER:$EULER_VAULT"; do
  name="${spec%%:*}"
  vault="${spec#*:}"
  var="${name}_ADAPTER_ADDR"

  if [ -n "${!var:-}" ]; then
    echo "$name: reusing already-deployed ${!var} (set via $var), skipping deploy"
    addr="${!var}"
  else
    deploy_one "$name"
    addr="$DEPLOYED_ADDR"
  fi

  init_one "$name" "$addr" "$vault"
  echo "export ${var}=${addr}" >>"$ENV_OUT"
done

echo
echo "Wrote $ENV_OUT:"
cat "$ENV_OUT"
echo
echo "Next — the live round-trips (Task 3):"
echo "  source $ENV_OUT"
echo "  ARB_ONE_RPC_URL=$ARB_ONE_RPC_URL M2_WALLET_KEY=\$(cat $KEY_PATH) \\"
echo "    cargo test -p adapter-e2e -- --test-threads=1"
