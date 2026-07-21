# ADR 001: Vault Adapter Design for the Vault Aggregator on Stylus

## Status

Accepted

## Context

The Vault Aggregator custodies USDC and splits it across four lending protocols (Aave v3,
Morpho Blue, Fluid, Beefy) behind a single ERC-4626-shaped router. Each protocol exposes a
different real interface on Arbitrum One, verified in `DISCOVERY.md` §2, and the fork-test
architecture available to Phases 9/10/13 is not what the PRD assumed. This ADR freezes both
questions — adapter shape per protocol, and the fork-test path — before Phase 9 designs the
generic adapter trait and Phase 10 builds the Aave adapter, so neither phase re-litigates
interfaces `DISCOVERY.md` already closed.

### Exit criteria (D-04, D-05)

The fork-tooling question had one decisive test (D-04): a dummy Stylus contract deployed to a
forked Arbitrum One state making a real call against forked Aave Pool state — nitro-testnode
forking or booting from genesis does not count, and `TestVMBuilder::rpc_url()` forking only the
contract-under-test's own storage does not count either. Both were run to exhaustion (D-06, no
timebox); neither passed. That failure is itself the frozen input this ADR uses to decide the
fork-test path (D-05): the decision is made now, with the spike's evidence in hand, not deferred
again.

The adapter-shape question's exit criterion is simpler: does the verified on-chain interface
(`DISCOVERY.md` §2) match the ERC-4626 selectors (`deposit(uint256,address)`,
`redeem(uint256,address,address)`, `convertToAssets(uint256)`, `maxRedeem(address)`) byte-for-byte,
or does it need a protocol-specific shim. Each protocol's answer is graded against that bar, not
against a general "it's basically 4626-like" impression.

## Options Considered

| Option | Description | Tradeoff |
|--------|-------------|----------|
| **Adapter shape A: one generic ERC-4626 adapter for all four protocols** | A single adapter contract parameterized only by target-vault address, calling the standard 4626 selectors on every protocol | Simplest to build and audit once, but Beefy's shortlisted vault (`DISCOVERY.md` §2.4) does not expose `asset()`/`convertToAssets()`/`maxRedeem()` at all (all revert) — this option cannot actually route to Beefy without a translation layer, so it does not fit the verified reality |
| **Adapter shape B: generic ERC-4626 adapter (Morpho/Fluid/Aave-via-Stata) + one Beefy-specific adapter** | Reuse the same 4626 adapter code for the three protocols that are genuinely 4626-conformant (or made conformant via Stata), and give Beefy its own adapter mapping `deposit(uint256)`/`withdraw(uint256)`/`getPricePerFullShare()` to the router's `deposit`/`redeem`/`convertToAssets` | Two adapter shapes to audit instead of one, but each shape matches a verified real interface instead of forcing an interface that doesn't exist; Beefy's 18-decimal mooToken vs 6-decimal USDC scaling is isolated to the one adapter that needs it |
| **Aave holding: raw rebasing `aArbUSDC` vs official Stata (`StaticATokenLM`) wrapper** | Hold Aave's aToken directly (rebases `balanceOf` in place) vs hold Stata's static-exchange-rate wrapper shares | Raw `aArbUSDC` breaks 4626 share-accounting invariants outright (PITFALLS.md §6) since `balanceOf` grows without a transfer; Stata is Aave's own official wrapper, verified deployed and 4626-shaped for native USDC on Arbitrum One (`DISCOVERY.md` §2.1) — no custom wrapper needs to be written or audited |
| **Protocol bindings: `sol_interface!` vs `sol!` bare-fn + manual dispatch** | Stylus SDK's `sol_interface!` macro auto-generates typed call bindings; the alternative hand-writes `alloy_sol_types::sol!` function signatures and dispatches manually | `sol_interface!` computes the wrong function selector for struct-shaped calldata parameters (M1 carryover 1.1, proven byte-for-byte against CoinFlip's Permit2 intake and cross-checked with `cast sig`) — a defect that would silently miscall Aave/Morpho entrypoints that take struct params; `sol!` bare-fn requires one extra manual dispatch step per binding but matches `cast sig` selectors exactly |
| **Fork-test architecture: nitro-testnode fork vs TestVM `rpc_url()` vs real-USDC ABI-level tests on Arbitrum One** | Three candidate ways to exercise adapters against real protocol state before mainnet deploy | nitro-testnode has no fork/import-state flag at all (spike 002, direct CLI inspection); TestVM's `rpc_url()` forks only the contract-under-test's own storage, never external calls, so it cannot exercise an adapter calling out to Aave/Morpho/Fluid/Beefy; small real-USDC transactions on Arbitrum One (`cast call`/`cast send`/`forge script`) are proven to work today against all four protocols (`DISCOVERY.md` §2, spike 002) — the only candidate that actually satisfies D-04's bar, at the cost of real (small) USDC spend and losing pure local iteration speed |

## Decision

**Adapter shape B is chosen: a generic ERC-4626 adapter for Aave-via-Stata/Morpho/Fluid, plus a
dedicated Beefy adapter.** Every decision below is anchored to a verified `DISCOVERY.md` finding,
not an unverified assertion.

- **Aave v3:** the adapter holds `stataArbUSDCn` (`0x7cfadfd5645b50be87d546f42699d863648251ad`)
  shares, not raw `aArbUSDC` (`0x625e7708f30ca75bfd92586e17077590c60eb4cd`). Verified: Stata's
  `asset()` returns native USDC (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`), `totalAssets()`
  returns a live non-zero `324579866025`, and `convertToAssets` returns a non-1:1 rate — proving
  genuine 4626 share accounting (`DISCOVERY.md` §2.1). This closes PITFALLS.md §6 for Aave with
  no custom wrapper.
- **Morpho Blue:** the generic 4626 adapter targets a MetaMorpho USDC vault. Verified: the
  Morpho Blue singleton (`0x6c247b1F6182318877311737BaC0844bAa518F5e`) is deployed on Arbitrum
  One (Morpho's own `blue-api.morpho.org` GraphQL API plus `cast code` cross-check), and the
  shortlisted vaults (`DISCOVERY.md` §3.1: Gauntlet USDC Core primary, Steakhouse High Yield
  USDC backup) expose the standard `deposit`/`redeem`/`convertToAssets` selectors non-reverting.
  No adapter deviation beyond the generic shape.
- **Fluid:** the generic 4626 adapter targets fUSDC (`0x1A996cb54bb95462040408C06122D45D6Cdb6096`).
  Verified: `asset()` returns native USDC, `convertToAssets`/`maxRedeem` are both callable and
  non-reverting, share price is non-1:1 (`DISCOVERY.md` §2.3). No adapter deviation.
- **Beefy:** a dedicated adapter, not the generic 4626 shape. Verified: the shortlisted vault
  (`mooMorphoArbGauntletCoreUSDC`, `0x3e101847e64987CE01E56918dcc8c437F4c6B24c`) reverts on
  `asset()`, `convertToAssets()`, and `maxRedeem()` — it only exposes `want()` (underlying),
  `getPricePerFullShare()`, `deposit(uint256)`, `withdraw(uint256)` (`DISCOVERY.md` §2.4). The
  Beefy adapter maps `deposit(uint256)`/`withdraw(uint256)` to the router's `deposit`/`redeem`,
  and computes `convertToAssets`/`convertToShares` manually from `getPricePerFullShare()`'s
  1e18-scaled price. The adapter must also handle the verified 18-decimal mooToken vs 6-decimal
  USDC scaling mismatch (`DISCOVERY.md` §2.4) — this is a second deviation beyond the interface
  shape, not folded into a single "minor wrapper" over the generic adapter.
- **Protocol bindings use `alloy_sol_types::sol!` bare-function signatures with manual dispatch,
  never `sol_interface!`.** Frozen per M1 carryover 1.1: `sol_interface!` computes the wrong
  selector for struct-shaped calldata params, proven byte-for-byte in CoinFlip's Permit2 intake
  and cross-checked against `cast sig`. Every selector this ADR cites (e.g. Aave `supply`
  `0x617ba037`, `withdraw` `0x69328dec`; the shared 4626 `deposit` `0x6e553f65`, `redeem`
  `0xba087652`) was independently verified via `cast sig` in `DISCOVERY.md` §2, and adapter code
  must cross-check its own `sol!` binding against those exact values before freezing.
- **Fork-test architecture: real-USDC ABI-level assertions on Arbitrum One, not a fork node.**
  Per spike 002 (`.planning/spikes/002-fork-tooling/README.md`, folded into `DISCOVERY.md` §4):
  neither nitro-testnode nor `TestVMBuilder::rpc_url()` satisfies D-04's bar (nitro-testnode has
  no fork mechanism at all; TestVM forks only the contract-under-test's own storage, never
  external calls, which is exactly the shape an adapter's Aave/Morpho/Fluid/Beefy call needs).
  Per D-05, Phases 9/10/13 budget for small real-USDC transactions (`cast call`/`cast
  send`/`forge script` against live Arbitrum One, ~$50-100 per D-05's fallback estimate) as the
  actual fork-test substitute, since that path is proven working today against all four
  protocols (`DISCOVERY.md` §2).
- **Router existence:** no deployed Stylus-native ERC-4626 router was found (`DISCOVERY.md` §1,
  three independent negative searches). The aggregator core, generic adapter trait, and Beefy
  adapter are all built from scratch — this ADR is the design that gets built, not a wrapper
  around existing infra.
- **Protocol swap-in recommendation (pending Gonzalo/WakeUp approval, D-07):** none of the four
  verified interfaces (§2) disqualifies its protocol outright, so no swap is recommended today.
  If any of Morpho/Fluid/Beefy's shortlisted vault becomes unavailable before deploy, the
  replacement-protocols bench (`DISCOVERY.md` §3.1, D-13: Euler v2 for Beefy, Yearn V3 for
  Morpho, Silo v2 for Fluid — all cast-verified strict ERC-4626) swaps in without reopening this
  ADR's adapter shapes: Euler/Yearn/Silo all fit the generic 4626 adapter unchanged (none needs
  Beefy's dedicated shape). Any actual swap still needs Gonzalo/WakeUp sign-off per D-07.

## Consequences

- **Inflation/first-depositor protection is Phase 11 core work, not a later hardening pass.**
  PITFALLS.md §7 flags this as a day-one share-accounting requirement for the aggregator core;
  it must be designed into Phase 11's share math from the start, not bolted on after a review
  finds it missing.
- **The 22KB/1-fragment Arbitrum One gate binds every adapter crate from day one.** M1's
  decisive lever (`-Cpanic=immediate-abort` + `-Zbuild-std` on a pinned nightly, ~9.9KB
  compressed recovered) is inherited by this workspace's build pipeline unchanged; `cargo stylus
  check --endpoint arb1` must run in CI from the first adapter crate, per the lesson that
  CoinFlip's core crossed the gate mid-Phase-3 and carried the problem across three plans.
- **`cargo stylus verify` / `-Zbuild-std` reproducibility risk resurfaces at Phase 15.** Open
  since Phase 04.1, carried through Phase 7 (M1); because this workspace's build recipe inherits
  the same nightly `-Zbuild-std` pipeline, the same Docker-image reproducibility gap applies to
  every adapter and the core at Phase 15's mainnet deploy, unless Phase 7 closes it first.
- **Beefy's dedicated adapter is real audit surface, not a thin wrapper.** Its manual
  `convertToAssets`/`convertToShares` math against `getPricePerFullShare()`, plus the 18-vs-6
  decimal scaling, is exactly the kind of custom arithmetic that needs its own test coverage in
  Phase 10, separate from the generic adapter's tests.
- **Final market addresses await client confirmation (D-07), adapter code does not.** The
  shortlist in `DISCOVERY.md` §3 is a recommendation; Gonzalo/WakeUp confirms the deployed
  address per protocol before mainnet config. Because adapters are built per-interface (this
  ADR), not per-address, Phase 9 starts today without waiting for that sign-off.
- **The real-USDC fork-test substitute has a real cost.** Every fork-style adapter test in
  Phases 9/10/13 spends small amounts of real USDC on Arbitrum One instead of running for free
  against a local devnode — budget and gas-funding for this must be planned into those phases'
  scope, not assumed to be zero-cost like a typical fork test.

## Client share (D-12)

This ADR plus the market shortlist (`DISCOVERY.md` §3) are ready to send to Gonzalo/WakeUp
proactively. Phase 9 starts today without waiting for their sign-off on this design freeze — only
the final per-protocol market addresses (D-07) wait for client confirmation, and that
confirmation only gates mainnet deploy configuration, not adapter code.
