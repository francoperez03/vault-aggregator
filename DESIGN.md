# Vault Aggregator — Design System

The two mini-apps in this program (CoinFlip and Vault Aggregator) ship to the same client and must
read as one studio's work. This app's visual language is **ported from CoinFlip**, whose system
lives in `coinflip/apps/web/app/globals.css`.

> That repo also contains a `DESIGN_SYSTEM.md` which is **stale** (it still documents
> `--accent: #0052ff` and "no semantic tokens"). Port from the CSS, never from that file.

Everything here is declared in `apps/web/app/globals.css`.

## Canvas

| Token | Value | Role |
|---|---|---|
| `--bg-void` | `#05070A` | Deepest field: tank wells, insets |
| `--bg-base` | `#0A0C0F` | Page |
| `--bg-surface` | `#111418` | Cards, panels, inputs |
| `--bg-elevated` | `#181D24` | Raised controls |
| `--bg-overlay` | `#1E242E` | Hover surfaces (shadcn's `--accent`) |

Two fixed viewport layers sit behind everything: three drifting cyan/blue radials (`bgDrift`, 26s)
and a film grain at 3.5% (`grainDrift`). They are attached to the **viewport**, not the body — the
body is capped at a 430px column, and painting them there would trap the ambience inside it.

## Color roles

| Token | Value | Rule |
|---|---|---|
| `--brand` (+ `-light` `-dim` `-ghost` `-glow`) | `#12AAFF` | Identity, focus rings, glow. **Never a button fill.** |
| `--action` (+ `-light` `-ghost` `-glow`) | `#0160E4` | Buttons, and only buttons. Hue held at OKLCH ~260° so actions read blue, not violet. |
| `--yield` | `#26D48A` | Money and growth: position total, live counter, success. |
| `--warning` | `#FFB020` | Throttle, partial settlement, a counter ticking down. |
| `--danger` (+ `-ghost`) | `#FF4D5E` | Reverts, failures, destructive confirmations. |
| `--morpho` `--fluid` `--euler` `--aave` | — | Protocol identity dots only. |

The brand/action split is the one that carries the hierarchy: if it is cyan it tells you *whose*
product this is, if it is electric blue it is something you can press.

## Type

Three families, same roles as CoinFlip:

- **Chakra Petch** (`--font-display`) — uppercase chrome: buttons, kickers. Positive tracking
  (`--tracking-label` `0.08em`, `--tracking-eyebrow` `0.12em`).
- **Inter** (`--font-sans`) — body, hints, descriptions.
- **JetBrains Mono** (`--font-mono`) — every number, always with `tabular-nums`. Money at 28px/600
  is the Display role.

### The kicker rule

`.kicker` (11px, display, uppercase, `--tracking-eyebrow`) is a **brand device, one per screen
region** — not a label style to hang off every element. In CoinFlip it appears once per screen
(`SYS // ON-CHAIN COIN FLIP`). Here it survives on "Paso 1 · Tu cuenta Lemon", "Paso 2 · Poner a
rendir", "Tu posición" and "Por protocolo". The two tank labels use sentence case on purpose: an
uppercase micro-label on every element is AI grammar, not voice.

## Shape and depth

- **Chamfer, not radius.** `.chamfer` (10px, two opposite corners) on buttons, panels and inputs;
  `.chamfer-sm` (4px) on compact controls where a 10px cut would eat the corner. `--radius: 0`
  globally so shadcn primitives stop fighting it.
- **Borders are 1.5px.** `--border-subtle` for panels, `--border-default` for inputs,
  `--action` for buttons.
- **Glow, never a diffuse shadow.** `0 0 16px var(--action-glow)` on button hover, `0 0 12px` on
  input focus, `0 0 24px` on the position total — the app's single value glow. A 1px border plus a
  wide soft shadow on the same element is banned; pick one.

## Motion

`--ease-snap cubic-bezier(0.16, 1, 0.3, 1)` everywhere, with `--dur-fast/base/slow` = 150/250/400ms.
A global `prefers-reduced-motion` block freezes every animation to a still frame.

Deliberately **not** ported from CoinFlip: the loss glitch, thunder flash, micro-shake, emoji shower
and corner brackets. That is a game's vocabulary; this app moves other people's money.

## Divergences from CoinFlip, and why

1. **Money is green, not cyan.** CoinFlip's `--success` is an alias of `--brand`. Here `--yield`
   does semantic work: the counter ticks up in green and down in amber (VFE-02). Green stays.
2. **The action color is `--action`, not `--accent`.** shadcn already owns `--accent` as its
   hover-surface token; redefining it would repaint every primitive.
3. **No `--hot` magenta.** It is CoinFlip's "you lost" color and has no counterpart here.

## Supersedes

The Color and Typography sections of `.planning/phases/14-frontend-on-chain-lemon-mock/14-UI-SPEC.md`,
which declared DM Sans and `--brand` as the single accent.
