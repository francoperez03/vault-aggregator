# Vault Aggregator — Web App

Mobile-first Next.js app for the Vault Aggregator mini-app hosted inside Lemon's WebView. It
deposits USDC into a per-user allocation across four lending protocols (Aave, Morpho, Fluid,
Euler) through a single Stylus vault-core contract on Arbitrum.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Money moves (one slider for deposit and withdraw, Lemon account card in-app) above the position summary: total balance, per-protocol breakdown, entry into the allocation step |
| `/rebalance` | Set or change the allocation across protocols; bootstraps a zero position or triggers a real rebalance with a cost disclosure. On `/` the same panel slides in as a second step |
| `/mover`, `/depositar`, `/retirar`, `/rebalancear` | Legacy Spanish aliases; they redirect to `/` and `/rebalance` so old links and Lemon deep links keep working |

Every write flow (deposit, rebalance, withdraw step 1, withdraw step 2) renders through the same
five-state transaction machine: confirm, signing, pending, and a terminal result (success,
rejected, reverted, timeout, or partial).

## Running locally

```bash
npm install
npm run dev
```

Opens on `http://localhost:3000`. Test in a mobile viewport (390x844) — this is a WebView-first
app; standalone browser is auxiliary/QA-only.

```bash
npm run test    # vitest
npm run build   # production build (also type-checks the app routes)
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in the values for the target network. See that file
for the full list and inline docs; the short version:

- `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_CHAIN_ID` — runtime/network selection (Arbitrum Sepolia
  `421614` for dev, Arbitrum One `42161` for mainnet).
- `NEXT_PUBLIC_CORE_ADDRESS`, `NEXT_PUBLIC_PERIPHERY_ADDRESS` — deployed vault contract(s).
- `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_MORPHO_ADAPTER_ADDRESS`,
  `NEXT_PUBLIC_FLUID_ADAPTER_ADDRESS`, `NEXT_PUBLIC_EULER_ADAPTER_ADDRESS`,
  `NEXT_PUBLIC_AAVE_ADAPTER_ADDRESS` — per-network token/adapter addresses.
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` — RainbowKit wallet connector; empty falls back to
  injected-only.
- `NEXT_PUBLIC_LEMON_MINI_APP_ID` — empty forces the local Lemon bridge mock.
- `NEXT_PUBLIC_FAULT_INJECTION` — dev-only toggle for the fault-injection panel. Never set this in
  production; the panel is a developer tool, never shown to end users.

All values are empty by default and safe to leave unset for UI-only work against mock data.

## Current status

The four routes above are built and tested against **mock data only** (`lib/mock/position.ts`).
No wallet connection, contract read/write, or Lemon SDK call is wired yet. Every route ships a
dev-only fixture/phase selector so every UI state (including all five transaction states) is
reachable without a live chain. The on-chain wiring (real position reads, real writes, real Lemon
settle) lands in a later phase and will replace these fixtures without touching the composed view
components.

## Language

User-facing copy is in Spanish (voseo). Code, comments, commit messages, and this README are in
English.
