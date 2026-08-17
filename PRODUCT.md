# Vaulty

## Register

Dual. The connected app (`/`, `/rebalance`) is **product** (design serves the money
flows). The unconnected `/` and any marketing surface is **brand** (the landing is the pitch).

## What it is

Vaulty is a USDC yield aggregator on Arbitrum One. A user picks weights across four real lending
protocols (Aave, Morpho, Fluid, Euler — all ERC-4626 vaults), deposits once, and the Stylus core
contract splits, rebalances and redeems in single transactions. Non-custodial: the ledger is
per-user on-chain; exit is always available.

## Users

- **Lemon mini-app users** (primary distribution): Argentine fintech users inside the Lemon
  WebView. Wallet is automatic (SIWE); they never see wallet chrome. Money vocabulary must be
  plain Spanish ("poner a rendir", "retirar"), never DeFi jargon.
- **Web/wallet users**: crypto-literate, connect RainbowKit/injected, on mobile more than desktop.

## Brand personality

Sober-technical. Shares one studio's visual language with CoinFlip (dark canvas, cyan
identity, Chakra Petch chrome; rounded where CoinFlip chamfers) but calmer: this app moves other people's money, so no glitches,
no shakes, no arcade vocabulary. Confidence comes from precision — mono tabular numbers, exact
percentages, verifiable addresses — not from hype.

## Anti-references

- DeFi-degen aesthetics (neon everything, APY shouting, rocket emojis).
- Fintech-startup cream/beige minimalism — this brand is already committed to its dark canvas.
- Card-grid landing template with icon+heading+text repeated.

## Design system

`DESIGN.md` at this root is the authority (ported from CoinFlip's CSS). Tokens live in
`apps/web/app/globals.css`. Key rules: brand cyan `#12AAFF` is identity and never a button fill;
action blue `#0160E4` is buttons only; `--yield` green is money going up; rounded 12px, never chamfer;
glow not diffuse shadow; one kicker per screen region.
