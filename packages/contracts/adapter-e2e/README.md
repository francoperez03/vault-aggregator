# adapter-e2e

Live Arbitrum One integration test. A plain host crate (NOT a Stylus contract, NOT `no_std`) so
it can pull in the full `alloy` client without touching the WASM contracts' dependency graph.

Phase 8's spike closed the fork-tooling question with verdict NEITHER — nitro-testnode has no
fork mechanism and `TestVMBuilder::rpc_url()` forks only the contract-under-test's own storage,
never external calls. Real small-USDC transactions against the real Morpho/Fluid/Euler vaults on
Arbitrum One are the frozen substitute (D-05), not a fallback.

**These tests spend real USDC and real ETH gas on Arbitrum One (~$3 per protocol per run,
D-06).** With `ARB_ONE_RPC_URL` unset they skip cleanly and cost nothing — this is what keeps
`cargo test --workspace` green and free for anyone who has not funded a wallet.

## Env-var contract

| Var | Required for | Meaning |
|-----|---------------|---------|
| `ARB_ONE_RPC_URL` | any live test to run at all | Arbitrum One RPC endpoint. Unset -> every test early-returns `Ok(())` and skips. |
| `M2_WALLET_KEY` | every live test's tx | Private key (0x-prefixed hex) of D-07's dedicated M2 wallet, funded with USDC + ETH gas. Read from env only — never committed. |
| `MORPHO_ADAPTER_ADDR` | `morpho_roundtrip.rs` | Deployed adapter instance wired to Morpho `gtUSDCc`. |
| `FLUID_ADAPTER_ADDR` | `fluid_roundtrip.rs` | Deployed adapter instance wired to Fluid `fUSDC`. |
| `EULER_ADAPTER_ADDR` | `euler_roundtrip.rs` | Deployed adapter instance wired to Euler `eUSDC-2`. |
| `AAVE_ADAPTER_ADDR` | `aave_roundtrip.rs` | Deployed adapter instance wired to Stata (`stataArbUSDCn`). |

USDC and the three vault addresses are compile-time constants in `src/lib.rs`, not env vars —
they are fixed and putting them behind env invites a typo pointing real money at the wrong
contract.

## Run

```bash
# Default (no env set): stays green, skips, no network touched — same as `cargo test --workspace`.
cargo test -p adapter-e2e

# Live, against a deployed adapter (spends real USDC + gas):
ARB_ONE_RPC_URL=https://arb1.arbitrum.io/rpc \
M2_WALLET_KEY=$(cat ~/.wakeup-m2-arb1.key) \
MORPHO_ADAPTER_ADDR=0x... FLUID_ADAPTER_ADDR=0x... EULER_ADAPTER_ADDR=0x... \
cargo test -p adapter-e2e -- --nocapture
```

## Tests

- `morpho_roundtrip.rs` / `fluid_roundtrip.rs` / `euler_roundtrip.rs`: approve -> deposit -> assert
  shares -> withdraw -> assert USDC back within a bounded rounding tolerance. One file per
  protocol so a failure is readable from the test name alone (same rationale as Plan 04's
  separate conformance modules).
- `fluid_roundtrip.rs` additionally carries `fluid_withdraw_above_max_reverts`, the live boundary
  probe that answers FLUID-THROTTLE (`docs/PROTOCOL-PROBES.md`) empirically: whether Fluid's
  `maxWithdraw()` over-reports relative to its `withdrawalLimit` throttle.

Written in Plan 05, run for real in Plan 06 once the M2 wallet is funded.
