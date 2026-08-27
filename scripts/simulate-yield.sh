#!/usr/bin/env bash
# The four Sepolia MockVaults have zero organic accrual: `total_assets()` is just the vault's raw
# USDC balance (Landmine 1, RESEARCH.md). This script injects real yield by donating USDC directly
# to each MockVault on a repeating cadence, so the live yield counter (VFE-02) has a genuine
# on-chain signal to react to during the QA walkthrough (Plan 06), not a one-off stub.
#
# A plain unsigned ERC-20 transfer needs no contract change and no owner privilege (research A3 —
# anyone can donate to total_assets()), so this is Option A from the Wave-0 decision.
#
# Run with:
#   source .sepolia-env
#   ARB_SEPOLIA_RPC_URL=... SEPOLIA_WALLET_KEY=... ./scripts/simulate-yield.sh
#
# Testnet-only. Never point this at Arbitrum One or a mainnet key.
#
# Required env vars:
#   ARB_SEPOLIA_RPC_URL  - Arbitrum Sepolia RPC endpoint
#   SEPOLIA_WALLET_KEY   - private key funding the donation transfers (testnet-only)
#
# Optional env vars:
#   AMOUNT    - atomic USDC donated per vault per round (default: 250000 = 0.25 USDC)
#   INTERVAL  - seconds between rounds (default: 90 — must exceed the hook's
#               MIN_SAMPLE_INTERVAL_S=60 so each round is a fresh yield sample)
#   ROUNDS    - number of donation rounds (default: 8)
set -euo pipefail

: "${ARB_SEPOLIA_RPC_URL:?Set ARB_SEPOLIA_RPC_URL}"
: "${SEPOLIA_WALLET_KEY:?Set SEPOLIA_WALLET_KEY}"

USDC=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d

# Morpho / Fluid / Euler / Aave MockVault slots.
MOCK_VAULTS=(
  0x09135d78253449c5f0df675b6b6e18582bdcfbab # Morpho
  0x65ab69fa086fa134b1645f81be64f15ed5793464 # Fluid
  0x2d368ef0746c75e87ca1768284fbe7adb827ca98 # Euler
  0x2325bbea0b93ecd9c6c3a8a9f680af5cd99a0230 # Aave
)

AMOUNT="${AMOUNT:-250000}"   # 0.25 USDC atomic, well above the ~1-atomic-unit rounding floor
INTERVAL="${INTERVAL:-90}"   # > MIN_SAMPLE_INTERVAL_S=60, keeps each round a fresh sample
ROUNDS="${ROUNDS:-8}"

for ((round = 1; round <= ROUNDS; round++)); do
  for i in "${!MOCK_VAULTS[@]}"; do
    vault="${MOCK_VAULTS[$i]}"
    echo "round $round/$ROUNDS: donating $AMOUNT USDC units to MockVault[$i]=$vault"
    cast send "$USDC" "transfer(address,uint256)" "$vault" "$AMOUNT" \
      --rpc-url "$ARB_SEPOLIA_RPC_URL" --private-key "$SEPOLIA_WALLET_KEY" >/dev/null
  done
  if ((round < ROUNDS)); then
    sleep "$INTERVAL"
  fi
done
