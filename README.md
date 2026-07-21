# Vault Aggregator

Vault Aggregator (WakeUp Labs M2) — Stylus/Rust USDC yield aggregator across Aave, Morpho, Fluid and Beefy on Arbitrum One. Milestone 2 of the WakeUp Stylus mini-apps program. Contracts and frontend land from Phase 9 onward; this phase (8) holds the technical-discovery docs under `docs/`.

Every contract in this repo must clear the Arbitrum One mainnet gate: 24KB compressed WASM (in practice ~22KB/1-fragment, since Arbitrum One's ArbOS does not support multi-fragment programs). The build pipeline is inherited verbatim from the CoinFlip repo: workspace-root release profile (`opt-level = "z"`, `lto = true`, `panic = "abort"`, `strip = true`) plus a nightly `-Cpanic=immediate-abort` / `-Zbuild-std` build for the final size reduction pass.
