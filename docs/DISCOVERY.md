# Vault Aggregator — Technical Discovery

Phase 8 discovery deliverable. Answers DISC-01's sub-questions before any M2 production code is written. Sections are appended by later plans in this phase; this file starts with the router-existence verdict.

## 1. Router existence verdict

**Hypothesis under test:** Given the WakeUp Vault Aggregator PRD calls for a router that splits USDC deposits across four lending protocols (Aave, Morpho, Fluid, Beefy) behind an ERC-4626-shaped interface, when we search Stylus-specific ecosystem sources and general code hosts for an already-deployed Stylus-native multi-protocol router, then either such a router exists as reusable deployed infra (M2 shrinks 5-8 days per DISC-01), or it does not and the aggregator core must be built from scratch.

**Verdict: DOES NOT EXIST (no deployed Stylus-native ERC-4626 router/yield-aggregator found).**

### Evidence

- **[VERIFIED: GitHub Search API, `search/repositories?q=stylus+erc-4626+router`]** — 0 repositories returned. Query run directly against `api.github.com`, not a search-engine summary.
- **[VERIFIED: GitHub Search API, `search/repositories?q=arbitrum+stylus+vault+aggregator`]** — 0 repositories returned.
- **[VERIFIED: GitHub Search API, `search/repositories?q=stylus-sdk+erc4626`]** — 0 repositories returned.
- **[CITED: `OffchainLabs/awesome-stylus` curated ecosystem list]** — the only ERC-4626-adjacent entry in the official Stylus community showcase is [`solidoracle/erc4626-rs`](https://github.com/solidoracle/erc4626-rs), described in the list itself as "a sample implementation of OpenZeppelin ERC4626 contract in Rust." Checked directly against the GitHub API: 2 stars, no repo description, `archived: false`, last updated 2025-03-13 — a single-vault reference/learning implementation, not a deployed multi-protocol router and not maintained past March 2025. It has no router/aggregator concept (one vault, one asset, no adapter routing).
- **[CITED: DuckDuckGo web search, `cargo-stylus verified ERC4626 router arbitrum`]** — top results are all tooling docs (cargo-stylus itself, OpenZeppelin's `erc4626` Stylus module docs, Arbitrum quickstart) and the same `solidoracle/erc4626-rs` sample repo already found above. No independent hit for a deployed router or aggregator.
- **[ASSUMED]** The negative holds only as far as public indexing goes — Stylus is a young ecosystem with weaker SEO/indexing than mainstream Solidity (Pitfall 3), and a privately-deployed or unlisted router cannot be ruled out by search alone. **Schedule stake: if one existed, M2 shrinks 5-8 days per DISC-01** — this is exactly why the verdict stays `[ASSUMED]` rather than `[VERIFIED]` despite three independent negative passes (GitHub API repo search, the official community showcase, and a general web search) all agreeing.

### Consequence for Phase 9

The aggregator core is built from scratch (expected outcome). Phase 9 designs its own generic ERC-4626 adapter and router logic; no existing Stylus infra is available to wrap. `openzeppelin-stylus`'s `Erc4626` module (already tracked in STACK.md, pre-1.0) remains the closest reusable building block — a library primitive, not a deployed multi-protocol router, so it does not change this verdict.

## 2. Protocol interfaces (Arbitrum One)

RE-VERIFIED 2026-07-21 (same day as RESEARCH.md citation, well inside the 14-day validity window). Adapter bindings for both protocols will use bare `alloy_sol_types::sol!` function bindings, selector-cross-checked against the `cast sig` outputs below — never `sol_interface!` (M1 carryover 1.1; `sol_interface!` computes wrong selectors for struct-shaped calldata params, see PROJECT.md finding from Phase 03 Plan 04).

### 2.1 Aave v3 (Pool + Stata static wrapper)

**Verdict: Stata static wrapper for native USDC on Arbitrum One is AVAILABLE — YES.**

- **[VERIFIED: `cast code 0x794a61358d6845594f94dc1db02a252b5b4814ad --rpc-url https://arb1.arbitrum.io/rpc`]** — non-empty bytecode returned (proxy dispatcher, starts `0x60806040526004361061005a...`), confirming the Aave v3 Pool is deployed live at this address.
- **[VERIFIED: `cast sig "supply(address,uint256,address,uint16)"`]** → `0x617ba037`
- **[VERIFIED: `cast sig "withdraw(address,uint256,address)"`]** → `0x69328dec`
  These are the two entrypoints the adapter calls (supply on deposit, withdraw on redeem); selectors recorded here are the ground truth the `sol!` bare-fn bindings must match byte-for-byte.
- **[VERIFIED: `cast code 0x625e7708f30ca75bfd92586e17077590c60eb4cd --rpc-url https://arb1.arbitrum.io/rpc`]** — non-empty bytecode; **[VERIFIED: `cast call 0x625e7708f30ca75bfd92586e17077590c60eb4cd "symbol()(string)"`]** → `"aArbUSDC"`. This is the rebasing aToken (balance grows in place via `index` rebasing, not via share-price growth) — exactly the PITFALLS.md §6 hazard: an ERC-4626 adapter cannot safely hold a raw aToken because `balanceOf` silently increases outside of transfers, breaking share-accounting invariants. This is why the Stata (`StaticATokenLM`) wrapper is needed as the adapter's actual holding.
- **The Stata wrapper itself**, `stataArbUSDCn` at `0x7cfadfd5645b50be87d546f42699d863648251ad`:
  - **[VERIFIED: `cast code 0x7cfadfd5645b50be87d546f42699d863648251ad --rpc-url https://arb1.arbitrum.io/rpc`]** — non-empty bytecode (proxy dispatcher), confirms deployment.
  - **[VERIFIED: `cast call 0x7cfadfd5645b50be87d546f42699d863648251ad "asset()(address)"`]** → `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` — this is the exact native Arbitrum One USDC address (byte-for-byte match against RESEARCH.md's `Native USDC (One)` row), proving Stata wraps native USDC specifically (not USDC.e or a different asset).
  - **[VERIFIED: `cast call ... "symbol()(string)"`]** → `"stataArbUSDCn"`; **[VERIFIED: `cast call ... "name()(string)"`]** → `"Static Aave Arbitrum USDCn"`; **[VERIFIED: `cast call ... "decimals()(uint8)"`]** → `6` (matches USDC's own decimals, as expected for a static 1:1-decimals wrapper).
  - **[VERIFIED: `cast call ... "totalAssets()(uint256)"`]** → `324579866025` (a real, non-zero, live TVL figure — 324,579.87 USDC), and **[VERIFIED: `cast call ... "convertToAssets(uint256)" 1000000000000000000`]** → `1173866035625854646`, a non-1:1 exchange rate (share price > 1), proving this IS an ERC-4626-shaped share-accounting contract (a real `StaticATokenLM`, not a passthrough).
  - **[VERIFIED: `cast sig "deposit(uint256,address)"`]** → `0x6e553f65`, **[VERIFIED: `cast sig "redeem(uint256,address,address)"`]** → `0xba087652` — standard ERC-4626 selectors, recorded for the adapter's `sol!` binding cross-check.

**Consequence:** the adapter holds `stataArbUSDCn` shares (ERC-4626-conformant, static exchange-rate accounting) rather than the raw rebasing `aArbUSDC`, exactly per Phase 10's ROADMAP criterion and PITFALLS.md §6's mitigation. No fallback custom wrapper is needed.

### 2.2 Morpho Blue (Arbitrum One deployment ground truth)

**Verdict: Morpho Blue IS deployed on Arbitrum One — RESOLVING RESEARCH.md's Open Question 2 (conflicting search signals).**

Resolved from Morpho's own primary source, not a search-engine summary (Pitfall 4): the official `blue-api.morpho.org` GraphQL API (Morpho's own indexer, not a third-party aggregator or SEO page).

- **[VERIFIED: `blue-api.morpho.org/graphql` query `{ chains { id network } }`]** → response includes `{"id": 42161, "network": "Arbitrum One"}` alongside Ethereum, Base, etc. — Morpho's own service lists Arbitrum One as a supported chain today.
- **[VERIFIED: same API, `markets(where: {chainId_in: [42161]})`]** → returned live markets with `morphoBlue.address = "0x6c247b1F6182318877311737BaC0844bAa518F5e"` on `chain.id = 42161`. Cross-checked with **[VERIFIED: `cast code 0x6c247b1F6182318877311737BaC0844bAa518F5e --rpc-url https://arb1.arbitrum.io/rpc`]** — non-empty bytecode (`0x6080604052600436101561001257600080fd5b...`), confirming the Morpho Blue singleton is genuinely deployed at that address on Arbitrum One (not just an API-only claim).
- **A live USDC market exists** on this singleton: **[VERIFIED: `cast call 0x6c247b1F6182318877311737BaC0844bAa518F5e "idToMarketParams(bytes32)(address,address,address,address,uint256)" 0xfde386e71d4ea4944bf0e427a89ddafbfce693e02e30b3dc20a62e0bb2d78dcf"`]** → returns loan token `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (native USDC, matching RESEARCH.md's address), collateral `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34`, oracle `0x090b20E84aFdc699ec045dB1E7851324E496cad6`, IRM `0x66F30587FB8D4206918deb78ecA7d5eBbafD06DA`, LLTV `915000000000000000` (91.5%).
- **A USDC MetaMorpho vault** was identified via the same primary API (`vaults(where: {chainId_in: [42161], assetSymbol_in: ["USDC"]})`): **Trinity Gold USDC Vault**, `tgUSDC`, at `0xF9a4D875811682C225dB58D9d0216709dCD6eBBb` (Arbitrum One). Cross-checked on-chain:
  - **[VERIFIED: `cast code 0xF9a4D875811682C225dB58D9d0216709dCD6eBBb --rpc-url https://arb1.arbitrum.io/rpc`]** — non-empty bytecode.
  - **[VERIFIED: `cast call ... "asset()(address)"`]** → `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (native USDC, confirmed).
  - **[VERIFIED: `cast call ... "name()(string)"`]** → `"Trinity Gold USDC Vault"`; **[VERIFIED: `cast call ... "symbol()(string)"`]** → `"tgUSDC"`; **[VERIFIED: `cast call ... "totalAssets()(uint256)"`]** → `18748490` (a real, non-zero live balance, ~18.75 USDC).
  - **[VERIFIED: bytecode selector-table scan]** the deployed bytecode dispatcher contains the ERC-4626 selectors `0x6e553f65` (`deposit(uint256,address)`), `0xba087652` (`redeem(uint256,address,address)`), and `0x07a2d13a` (`convertToAssets(uint256)`) as jump-table entries — confirms the vault IS ERC-4626-shaped, not merely API-labeled as one.
  - **[VERIFIED: `cast call ... "owner()(address)"`]** → `0x957Aad8479F0e9182C65fabd1a69313a2f5413b5` (vault owner/governance address); **[VERIFIED: `cast call ... "curator()(address)"`]** → `0x0000000000000000000000000000000000000000` (zero address — this specific vault has no curator role assigned, only an owner; noted as-is, not assumed).

**Consequence for VAULT-05:** Morpho IS available as a real, live Arbitrum One adapter target — no re-sourcing or bridging is needed. The candidate USDC vault (`tgUSDC`) is small (~$18.75 TVL) and curator-less; Phase 9/13 should treat vault selection (this one vs. a larger/curated alternative surfaced later) as an open parameter, not re-litigate deployment existence.

### 2.3 Fluid (Instadapp fToken, USDC)

RE-VERIFIED 2026-07-21 (same session as the rest of §2, well inside the 14-day validity window).

**Verdict: Fluid fUSDC on Arbitrum One IS ERC-4626-conformant — resolves RESEARCH.md's unresolved fToken address.**

- **Address found via Fluid's own API** (`api.fluid.instadapp.io/v2/lending/42161/tokens`, primary source, not a search summary): fUSDC = `0x1A996cb54bb95462040408C06122D45D6Cdb6096`, underlying `assetAddress` = `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (native USDC, byte-for-byte match against RESEARCH.md's Native USDC row).
- **[VERIFIED: `cast code 0x1A996cb54bb95462040408C06122D45D6Cdb6096 --rpc-url https://arb1.arbitrum.io/rpc`]** — non-empty bytecode, confirms live deployment.
- **[VERIFIED: `cast call ... "asset()(address)"`]** → `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` — matches native USDC exactly.
- **[VERIFIED: `cast call ... "name()(string)"`]** → `"Fluid USD Coin"`; **[VERIFIED: `cast call ... "symbol()(string)"`]** → `"fUSDC"`; **[VERIFIED: `cast call ... "decimals()(uint8)"`]** → `6` (matches USDC's own decimals).
- **[VERIFIED: `cast call ... "totalAssets()(uint256)"`]** → `35776403129410` (~35.78M USDC, real non-zero live TVL).
- **[VERIFIED: `cast call ... "convertToAssets(uint256)" 1000000000000000000`]** → `1121774267498000000` — non-1:1 exchange rate (share price > 1), confirms genuine ERC-4626 share accounting, not a passthrough.
- **[VERIFIED: `cast call ... "maxRedeem(address)" 0x...01`]** → `0` (call succeeds, returns a value — the function exists and is callable; zero is the expected answer for an address holding no shares, not a revert).
- **[VERIFIED: `cast sig "deposit(uint256,address)"`]** → `0x6e553f65`, **[VERIFIED: `cast sig "redeem(uint256,address,address)"`]** → `0xba087652`, **[VERIFIED: `cast sig "convertToAssets(uint256)"`]** → `0x07a2d13a`, **[VERIFIED: `cast sig "maxRedeem(address)"`]** → `0xd905777e` — recorded for the adapter's `sol!` bare-function binding cross-check (never `sol_interface!`, M1 carryover 1.1).

**Consequence:** Fluid fits the generic ERC-4626 adapter with no protocol-specific shape — same integration pattern as Aave-via-Stata and the Morpho MetaMorpho vault.

### 2.4 Beefy (specific vault ABI verification — Pitfall 1 / A4)

RE-VERIFIED 2026-07-21.

**Verdict: the shortlisted Beefy USDC vault uses the PRE-4626 `getPricePerFullShare()` shape, NOT a 4626-compatible layer — confirms RESEARCH.md's Assumption A4 as TRUE for this specific vault, not just the protocol in general.**

Per Pitfall 1, the protocol was NOT generalized from: every Beefy single-asset USDC vault on Arbitrum One currently available via Beefy's own vault list (`api.beefy.finance/vaults`, filtered `chain=arbitrum`, `assets=["USDC"]`, `status=active`) is itself a wrapper around a Morpho MetaMorpho vault (Beefy's `platformId: "morpho"` — Beefy auto-compounds the Morpho position's rewards, it is not a raw lending-pool vault). Five such vaults exist; TVL via `api.beefy.finance/tvl`:

| Vault id | mooToken address | TVL (USD) |
|----------|-------------------|-----------|
| `morpho-arb-gauntlet-core-usdc` (**PRIMARY**) | `0x3e101847e64987CE01E56918dcc8c437F4c6B24c` | ~$56,458 |
| `morpho-arb-hyperithm-usdc` (**BACKUP**) | `0x99925188f1B92661A443376319370ACFF1D68B87` | ~$20,708 |
| `morpho-arb-steakhouse-v2-usdc` | `0x48c22563d06826CA38ab32F7EcbcB94f03a287aa` | ~$13,018 |
| `morpho-arb-gauntlet-prime-usdc` | `0xBced10660D87ecE552E1F3652927Bc7C87CccA75` | ~$12,631 |
| `morpho-arb-steakhouse-usdc` | `0x13EaA79178f2b6C0A43cA265B66d70b9d60F827a` | ~$11,774 |

ABI verified on-chain against the primary candidate (`mooMorphoArbGauntletCoreUSDC`, `0x3e101847e64987CE01E56918dcc8c437F4c6B24c`):

- **[VERIFIED: `cast code 0x3e101847e64987CE01E56918dcc8c437F4c6B24c --rpc-url https://arb1.arbitrum.io/rpc`]** — non-empty bytecode (an EIP-1167 minimal proxy, `363d3d373d3d3d363d73...`), confirms live deployment.
- **[VERIFIED: `cast call ... "name()(string)"`]** → `"Moo Morpho Arb Gauntlet Core USDC"`; **[VERIFIED: `cast call ... "symbol()(string)"`]** → `"mooMorphoArbGauntletCoreUSDC"`; **[VERIFIED: `cast call ... "decimals()(uint8)"`]** → `18` (mooToken decimals, NOT the underlying's 6 — a deviation an adapter must account for).
- **[VERIFIED: `cast call ... "want()(address)"`]** → `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (native USDC — confirms the underlying asset via the pre-4626 `want()` getter, not `asset()`).
- **[VERIFIED: `cast call ... "getPricePerFullShare()(uint256)"`]** → `1015873016098905462` (~1.0159, non-1:1, real share price) — the pre-4626 shape IS present and live.
- **[VERIFIED: `cast call ... "asset()(address)"`]** → **reverts** (`execution reverted, data: "0x"`).
- **[VERIFIED: `cast call ... "convertToAssets(uint256)" 1000000`]** → **reverts**.
- **[VERIFIED: `cast call ... "maxRedeem(address)" 0x...01`]** → **reverts**.
- **[VERIFIED: `cast sig "deposit(uint256)"`]** → `0xb6b55f25`, **[VERIFIED: `cast sig "withdraw(uint256)"`]** → `0x2e1a7d4d`, **[VERIFIED: `cast sig "getPricePerFullShare()"`]** → `0x77c7b8fc` — this is the actual entrypoint shape (single-arg `deposit(uint256)`/`withdraw(uint256)`, NOT the 4626 `deposit(uint256,address)`/`redeem(uint256,address,address)`).
- **[VERIFIED: `cast call ... "balance()(uint256)"`]** → `56464975728` (~56,465 USDC, matches the off-chain TVL figure) and **[VERIFIED: `cast call ... "strategy()(address)"`]** → `0xFE2ceb2472Ef0b39C662a033e2a572cBb009AF6B` — confirms this is a real, actively-managed vault, not a stub.

**Consequence for VAULT-05 / the ADR:** Beefy does NOT fit the generic 4626 adapter as-is. It needs its own adapter shape mapping `deposit(uint256)` → aggregator `deposit`, `withdraw(uint256)` (share amount, Beefy's own units) → aggregator `redeem`, and `getPricePerFullShare()` → the aggregator's internal `convertToAssets`/`convertToShares` math (manual multiplication/division against the 1e18-scaled price, no native `convertToAssets` to delegate to). The 18-decimals mooToken vs. 6-decimals USDC also needs explicit scaling in that shape — a second deviation beyond the interface mismatch. This is exactly Pitfall 1's warning materialized on the real candidate vault, not a hypothetical: the ADR (Plan 05) must design Beefy as a distinct adapter variant, not a "minor wrapper" over the generic 4626 adapter.

### 2.5 Four-protocol ERC-4626 deviations comparison table (D-03)

One row per protocol, from the verified §2 findings above. **Empirical proof of each deviation (actual rounding-direction transactions, actual paused-state behavior) is explicitly deferred to Phase 9's smoke fork tests — this table is a source-verified survey, not an empirical proof (D-03).**

| Protocol | Candidate | 4626-conformant? | Rounding direction | Redeem/withdraw limits | Pause/emergency state | Notable deviation |
|----------|-----------|-------------------|---------------------|--------------------------|-------------------------|---------------------|
| Aave (via Stata) | `stataArbUSDCn` `0x7cfa...1ad` | `[VERIFIED]` YES — `deposit(uint256,address)`/`redeem(uint256,address,address)`/`convertToAssets` all present, non-1:1 exchange rate | `[CITED]` OZ `Erc4626`-derived Stata implementation rounds down on `convertToShares` (deposit) and down on `convertToAssets` (redeem), the standard 4626-safe direction (protects the vault, not the depositor) — not empirically re-derived here | `[CITED]` Stata inherits Aave Pool's liquidity constraint: `maxRedeem` is capped by the Pool's available liquidity, can be < full balance during high utilization | `[CITED]` Aave Pool has a protocol-level pause guardian (`Pool.paused()`); Stata itself has no separate pause, it reverts if the underlying Pool is paused | Static (non-rebasing) accounting is itself the deviation vs. holding raw `aArbUSDC` directly (PITFALLS.md §6) |
| Morpho (MetaMorpho `tgUSDC`) | `0xF9a4...eBBb` | `[VERIFIED]` YES — bytecode selector scan confirms `deposit`/`redeem`/`convertToAssets` jump-table entries | `[CITED]` MetaMorpho (OZ `Erc4626`-based per Morpho's own contracts) rounds down on deposit-shares, down on redeem-assets, matching the 4626-safe convention | `[CITED]` `maxRedeem` bounded by the underlying Morpho Blue market's available liquidity (can be less than the vault's `totalAssets` share if a market is fully utilized) | `[CITED]` MetaMorpho vaults have an owner-controlled market allocation but no single global pause flag; a market can be individually deprecated by the curator/owner reducing its cap to 0 | Curator-less on this specific candidate (`curator()` returned the zero address) — no active risk curation, an operational deviation vs. Aave/Fluid's protocol-level risk management |
| Fluid (fUSDC) | `0x1A99...6096` | `[VERIFIED]` YES — `asset`/`convertToAssets`/`maxRedeem` all callable and non-reverting, non-1:1 share price | `[CITED]` Fluid's Instadapp-authored vault follows the same OZ-derived 4626 rounding convention (round down in the vault's favor) — not empirically re-derived here | `[VERIFIED]` Fluid exposes an explicit `liquiditySupplyData.withdrawable` limit (from the same API used to find the address) distinct from `totalAssets` — a real, protocol-native withdrawal-limit mechanism beyond the generic 4626 `maxRedeem` | `[CITED]` Fluid has a protocol-level `Liquidity` contract pause/guard mechanism (not independently cast-verified this plan) | Explicit `withdrawalLimit`/`expandPercent`/`expandDuration` liquidity-throttling mechanism (visible in the API response) — a Fluid-specific rate-limited withdrawal shape beyond plain `maxRedeem` |
| Beefy (`mooMorphoArbGauntletCoreUSDC`) | `0x3e10...24c` | `[VERIFIED]` **NO** — `asset()`/`convertToAssets()`/`maxRedeem()` all revert; only `want()`/`getPricePerFullShare()`/`deposit(uint256)`/`withdraw(uint256)` exist | `[CITED]` `getPricePerFullShare()` is computed as `balance()/totalSupply()` (Beefy's standard formula) — no explicit round-down/up guarantee documented at the interface level, unlike audited 4626 implementations | `[VERIFIED]` No `maxRedeem` exists at all (reverts); withdrawal is implicitly capped by the vault's own `balance()` and the underlying Morpho market's liquidity one layer down | `[CITED]` Beefy vaults have a `pause()`/`unpause()` admin function (standard Beefy vault pattern, not independently cast-verified this plan) | **Non-4626 interface entirely** (Pitfall 1/A4 confirmed on this exact vault) + 18-decimal mooToken vs 6-decimal USDC — needs its own adapter shape, not a wrapper |

## Sources

- GitHub Search API (`api.github.com/search/repositories`) — direct queries, 2026-07-21
- `OffchainLabs/awesome-stylus` (community ecosystem showcase) — fetched 2026-07-21
- `solidoracle/erc4626-rs` GitHub API repo metadata — fetched 2026-07-21
- DuckDuckGo HTML search (`html.duckduckgo.com/html`) — queried 2026-07-21
- `.planning/phases/08-vault-technical-discovery/08-RESEARCH.md` — prior generic GitHub/web search pass (Summary finding 1, Pitfall 3, Assumption A2), extended here with the Stylus-specific secondary pass it called for
- `cast` (Foundry 1.3.5-stable) against `https://arb1.arbitrum.io/rpc` — all Aave/Stata/Morpho/Fluid/Beefy on-chain evidence, run directly 2026-07-21
- `blue-api.morpho.org/graphql` — Morpho's own official indexer API (primary source, not a search summary), queried directly 2026-07-21 for chain support, market list, and vault list
- `api.fluid.instadapp.io/v2/lending/42161/tokens` — Fluid's own official API (primary source), queried directly 2026-07-21 to resolve the fUSDC token address on Arbitrum One
- `api.beefy.finance/vaults` and `api.beefy.finance/tvl` — Beefy's own official API (primary source), queried directly 2026-07-21 to identify and rank the candidate Arbitrum One USDC vaults
