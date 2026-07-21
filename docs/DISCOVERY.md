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

## Sources

- GitHub Search API (`api.github.com/search/repositories`) — direct queries, 2026-07-21
- `OffchainLabs/awesome-stylus` (community ecosystem showcase) — fetched 2026-07-21
- `solidoracle/erc4626-rs` GitHub API repo metadata — fetched 2026-07-21
- DuckDuckGo HTML search (`html.duckduckgo.com/html`) — queried 2026-07-21
- `.planning/phases/08-vault-technical-discovery/08-RESEARCH.md` — prior generic GitHub/web search pass (Summary finding 1, Pitfall 3, Assumption A2), extended here with the Stylus-specific secondary pass it called for
