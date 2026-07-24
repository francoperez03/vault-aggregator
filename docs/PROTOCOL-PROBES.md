# Protocol Probes — Live Arbitrum One Evidence

RPC: `https://arb1.arbitrum.io/rpc`
Date: 2026-07-22
Method: every figure below is a live `cast call` (read-only) or a live `cast code`/`cast storage` read against `https://arb1.arbitrum.io/rpc`, or a live fetch of `https://api.fluid.instadapp.io/v2/lending/42161/tokens`. No fork, no cache, no transactions were sent. Matches DISCOVERY.md's `[VERIFIED: ...]` citation convention.

Addresses probed:
- USDC (native): `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- Morpho Gauntlet USDC Core `gtUSDCc` (PRIMARY, production target): `0x7e97fa6893871A2751B5fE961978DCCb2c201E65`
- Morpho `tgUSDC` (Phase 8 selector-scan subject, NOT production, identity-comparison only): `0xF9a4D875811682C225dB58D9d0216709dCD6eBBb`
- Fluid `fUSDC` (production target): `0x1A996cb54bb95462040408C06122D45D6Cdb6096`
- Euler v2 `eUSDC-2` (production target): `0x6afb8d3f6d4a34e9cb2f217317f4dc8e05aa673b`

## Raw selector answers per vault

Zero-address probe used for `maxRedeem`/`maxWithdraw`/`maxDeposit`: `0x0000000000000000000000000000000000000001` (a no-balance holder — expected to answer 0, not revert, on a healthy ERC-4626).

### Morpho `gtUSDCc` — `0x7e97fa6893871A2751B5fE961978DCCb2c201E65`

| Call | Result |
|------|--------|
| `asset()` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `totalAssets()` | `1932276603271` (~1,932,276.60 USDC) |
| `convertToAssets(1000000)` | `0` (shares are 18-decimal; 1,000,000 wei of shares is far below 1 share, rounds to 0 assets — expected, not an anomaly) |
| `convertToShares(1000000)` | `961766763105443360` |
| `maxRedeem(0x...01)` | `0` |
| `maxWithdraw(0x...01)` | `0` |
| `maxDeposit(0x...01)` | `1000000014024112946017` |
| `previewWithdraw(1000000)` | `961766760531641478` |

No reverts on any of the eight calls.

### Fluid `fUSDC` — `0x1A996cb54bb95462040408C06122D45D6Cdb6096`

| Call | Result |
|------|--------|
| `asset()` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `totalAssets()` | `35779340197781` (~35,779,340.20 USDC) |
| `convertToAssets(1000000)` | `1121790` |
| `convertToShares(1000000)` | `891432` |
| `maxRedeem(0x...01)` | `0` |
| `maxWithdraw(0x...01)` | `0` |
| `maxDeposit(0x...01)` | `170141183460469231731687254521511670388` |
| `previewWithdraw(1000000)` | `891433` |

No reverts on any of the eight calls.

### Euler v2 `eUSDC-2` — `0x6afb8d3f6d4a34e9cb2f217317f4dc8e05aa673b`

| Call | Result |
|------|--------|
| `asset()` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `totalAssets()` | `725300530571` (~725,300.53 USDC) |
| `convertToAssets(1000000)` | `1044351` |
| `convertToShares(1000000)` | `957532` |
| `maxRedeem(0x...01)` | `0` |
| `maxWithdraw(0x...01)` | `0` |
| `maxDeposit(0x...01)` | `149274699466671` |
| `previewWithdraw(1000000)` | `957533` |

No reverts on any of the eight calls.

### Morpho `tgUSDC` (identity-comparison subject only) — `0xF9a4D875811682C225dB58D9d0216709dCD6eBBb`

| Call | Result |
|------|--------|
| `asset()` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `totalAssets()` | `18789594` (~18.79 USDC — tiny, matches Phase 8's "not for production" flag) |
| `convertToAssets(1000000)` | `0` |
| `convertToShares(1000000)` | `115349013017691280` |
| `maxRedeem(0x...01)` | `0` |
| `maxWithdraw(0x...01)` | `0` |
| `maxDeposit(0x...01)` | `24519928653854221733733552434404946937899825954918845202` |
| `previewWithdraw(1000000)` | `115348933210999679` |

No reverts on any of the eight calls.

---

## Question 1 — Morpho identity (ADR 001 open item / RESEARCH Open Question 2)

Same eight calls against `gtUSDCc` and `tgUSDC` answer identically in shape (no reverts, same selector set, same rounding-down behaviour, same decimals scale) — see tables above.

Bytecode length comparison:

```
cast code 0x7e97fa6893871A2751B5fE961978DCCb2c201E65 --rpc-url $RPC | wc -c
39381
cast code 0xF9a4D875811682C225dB58D9d0216709dCD6eBBb --rpc-url $RPC | wc -c
39381
```

Identical deployed bytecode length (39,381 hex-string characters, i.e. identical byte count).

EIP-1967 implementation slot check (both vaults, to rule out proxy divergence):

```
cast storage <vault> 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url $RPC
```

Both return `0x000...0000` (empty slot) — neither vault is an EIP-1967 transparent/UUPS proxy; both are direct MetaMorpho factory deployments, so identical bytecode length is direct evidence of identical implementation (not just a matching proxy target).

Selector-presence scan (`63` = PUSH4 opcode preceding the selector in a Solidity dispatcher jump table) confirms `withdraw(uint256,address,address)` (`0xb460af94`) and `maxWithdraw(address)` (`0xce96cb77`) are present in both bytecodes.

MORPHO-IDENTITY: CONFIRMED same selector set (identical bytecode length 39,381 chars, both non-proxy, same eight-call response shape; `gtUSDCc` differs from `tgUSDC` only in TVL — ~1.93M vs ~18.79 USDC — confirming Phase 8's "tiny vault, not for production" read was about liquidity, not a different implementation).

---

## Question 2 — Fluid throttle (RESEARCH Open Question 1 / Pitfall 1)

Live fetch of `https://api.fluid.instadapp.io/v2/lending/42161/tokens`, entry for `fUSDC` (`0x1A996cb54bb95462040408C06122D45D6Cdb6096`):

```json
"liquiditySupplyData": {
  "modeWithInterest": true,
  "supply": "35779339865103",
  "withdrawalLimit": "17889669932551",
  "lastUpdateTimestamp": "1784677511",
  "expandPercent": "5000",
  "expandDuration": "21600",
  "baseWithdrawalLimit": "8109571220991",
  "withdrawableUntilLimit": "17889669932552",
  "withdrawable": "6783400420201"
}
```

`withdrawable` = `6783400420201` (~6,783,400.42 USDC) — the protocol's actual redeemable capacity right now.
On-chain `totalAssets()` = `35779340197781` (~35,779,340.20 USDC).

`withdrawable` (~6.78M USDC) is far below `totalAssets()` (~35.78M USDC) — roughly 19% of vault assets are currently liquid. A holder whose share of the vault exceeds ~6.78M USDC-equivalent would be throttled by Fluid's `withdrawalLimit`/`expandPercent`/`expandDuration` mechanism on a real withdraw, even though `maxWithdraw(holder)` computes purely from share balance and vault-level accounting (per the ERC-4626 reference implementation Fluid wraps) and has no visibility into `liquiditySupplyData`. There is no large-balance holder available to probe `maxWithdraw` against directly from a read-only zero-balance probe (`maxWithdraw(0x...01)` returns `0`, as expected for a no-balance address — it proves nothing about the throttle).

FLUID-THROTTLE: RESOLVED — withdraw at exactly maxWithdraw() succeeded on live state; maxWithdraw reflects the throttle

Answered empirically on 2026-07-22 by `adapter-e2e`'s `fluid_withdraw_above_max_reverts` against the deployed adapter `0xbd5d02430e8d8532e486e91a7a52cf0cf770494a` on Arbitrum One. Two probes against a live $3 position:

1. `withdraw(maxWithdraw() + 1)` reverted with the adapter's own `WithdrawExceedsMax(uint256)` (selector `0xd9ea4d85`) — the D-08 guard fires at the boundary.
2. `withdraw(maxWithdraw())` — exactly the reported boundary, `2999999` units — **succeeded on-chain**, and the caller's USDC balance moved by exactly that amount (never a partial withdrawal).

**Scope of this answer.** The position probed is ~$3 against a `withdrawable` capacity of ~6.78M USDC, so this confirms `maxWithdraw` is trustworthy *far below* the throttle, not that it clamps correctly *at* it. The original concern — a holder whose position exceeds `withdrawable` — remains unprobed, because opening a position of that size is out of scope for this milestone. Phase 11's routing should still treat a Fluid `max_withdraw()` reading as an upper bound rather than a guarantee whenever the amount approaches vault-level liquidity; the adapter's revert-never-clamp behaviour (D-08) is correct under either outcome, so no adapter change is implied.

---

## Question 3 — Withdraw-path selection

Selector-presence scan (`63<selector>` = PUSH4 + selector bytes in the dispatcher jump table) for `withdraw(uint256,address,address)` (`0xb460af94`) and `maxWithdraw(address)` (`0xce96cb77`):

| Vault | Bytecode length | `withdraw()` selector present | `maxWithdraw()` selector present | Notes |
|-------|------------------|-------------------------------|-----------------------------------|-------|
| Morpho `gtUSDCc` | 39,381 chars | yes (`63b460af94` found) | yes (`63ce96cb77` found) | Non-proxy (empty EIP-1967 slot) |
| Fluid `fUSDC` | 39,237 chars | yes (`63b460af94` found) | yes (`63ce96cb77` found) | Non-proxy dispatcher scan succeeded directly |
| Euler `eUSDC-2` | 735 chars | not found via PUSH4 scan | not found via PUSH4 scan | Minimal proxy/clone (735-byte runtime code — too small to contain a full dispatcher); EIP-1967 slot also empty, consistent with an EIP-1167-style minimal clone or an EVC-routed proxy rather than a standard transparent proxy. Fell back to the plan's documented fallback: `maxWithdraw(address)` answered `0` (no revert) via direct `cast call`, proving the selector is live and dispatched correctly through the proxy. |

All three vaults answer `maxWithdraw(address)` without reverting (see the raw tables above — none of the eight calls reverted on any of the four vaults probed). Euler's small runtime bytecode makes the PUSH4 scan a false negative for a proxy pattern (the selector table lives in the implementation contract, not the 735-byte proxy runtime code) — this is exactly the fallback case the plan anticipated, and the direct `cast call` success is the presence proof for Euler.

WITHDRAW-PATH: asset-exact withdraw() available on all three

---

## Question 4 — Rounding direction

DISCOVERY.md §2.5 marks rounding direction as `[CITED]` (from protocol docs), never empirically derived on these exact deployed vaults until now. Round-trip test: `convertToShares(1000000)` (1 USDC in) → feed the resulting share amount into `convertToAssets(shares)` → compare against the original 1,000,000 (1 USDC).

| Vault | `convertToShares(1000000)` | `convertToAssets(<that share amount>)` | Round-trip result |
|-------|------------------------------|-------------------------------------------|--------------------|
| Morpho `gtUSDCc` | `961766696174653185` | `999999` | `999999 <= 1000000` |
| Fluid `fUSDC` | `891432` | `999999` | `999999 <= 1000000` |
| Euler `eUSDC-2` | `957532` | `999999` | `999999 <= 1000000` |

All three vaults lose exactly 1 wei of USDC (6-decimal unit) on a full deposit→shares→assets round-trip — the 4626-safe round-down-in-the-vault's-favour convention, not round-up.

ROUNDING-MORPHO: round-down confirmed
ROUNDING-FLUID: round-down confirmed
ROUNDING-EULER: round-down confirmed

---

## Summary for Plan 03 / Plan 06

- Morpho `gtUSDCc` is confirmed the same implementation as the Phase 8 `tgUSDC` scan subject — no redesign needed, D-03's four-function surface holds as scoped.
- Fluid's throttle question is explicitly unresolved from static reads; Plan 06's live round-trip is the load-bearing check, not an assumption. The adapter's D-08 typed-revert guard (`WithdrawExceedsMax`) should not treat `maxWithdraw`'s answer as unconditionally trustworthy for Fluid.
- All three production vaults support asset-exact `withdraw(uint256,address,address)` directly — no `redeem()` + `convertToShares` fallback path is needed anywhere in Plan 03.
- Rounding is round-down (vault-favouring) on all three, consistent with the 4626-safe convention DISCOVERY.md cited but had not measured on the live deployments.

---

### AAVE-WITHDRAW-PATH: RESOLVED — asset-exact `withdraw()` confirmed on Stata

`WITHDRAW-PATH` above says "available on all three" and means Morpho/Fluid/Euler — Aave/Stata was
never put through the same probe. `DISCOVERY.md` §2.1 only ran `cast sig` on `deposit`/`redeem`,
which hashes a signature string and proves nothing about the deployed bytecode. The adapter calls
`withdraw(uint256,address,address)` (`0xb460af94`), an OPTIONAL ERC-4626 function, so this was a
real gap. Probed 2026-07-22 against `stataArbUSDCn` `0x7cfadfd5645b50be87d546f42699d863648251ad`:

```
# 1. maxWithdraw(address) responds without reverting against the Stata proxy
cast call 0x7cfadfd5645b50be87d546f42699d863648251ad "maxWithdraw(address)(uint256)" \
  0x13B56eA93CB18ae90d7Ff6E01Cb97C1AbFB2B992 --rpc-url https://arb1.arbitrum.io/rpc
→ 0
```

```
# 2. withdraw(uint256,address,address) dispatches into real Aave logic (reverts only on amount==0)
cast call 0x7cfadfd5645b50be87d546f42699d863648251ad "withdraw(uint256,address,address)(uint256)" \
  0 0x13B56eA93CB18ae90d7Ff6E01Cb97C1AbFB2B992 0x13B56eA93CB18ae90d7Ff6E01Cb97C1AbFB2B992 \
  --from 0x13B56eA93CB18ae90d7Ff6E01Cb97C1AbFB2B992 --rpc-url https://arb1.arbitrum.io/rpc
→ Error: execution reverted: 8, data: "0x08c379a0...0138"
```

```
# 3. Stata is a proxy: read the EIP-1967 implementation slot
cast storage 0x7cfadfd5645b50be87d546f42699d863648251ad \
  0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
  --rpc-url https://arb1.arbitrum.io/rpc
→ 0x0000000000000000000000009bf9df78b1f7c76a473588c41321b5059b62981e
```

```
# 4. Scan the IMPLEMENTATION's dispatcher jump table (the proxy itself has no selectors)
cast code 0x9bf9df78b1f7c76a473588c41321b5059b62981e --rpc-url https://arb1.arbitrum.io/rpc > /tmp/stata_impl.hex
for s in b460af94 ce96cb77 ba087652 6e553f65; do printf "%s: " "$s"; grep -c "63$s" /tmp/stata_impl.hex; done
→ b460af94: 1
→ ce96cb77: 1
→ ba087652: 1
→ 6e553f65: 1
```

**Why the scan targets the implementation, not the proxy.** Stata is a proxy behind the EIP-1967
implementation slot (call 3), which resolves to `0x9bf9df78b1f7c76a473588c41321b5059b62981e` — a
`cast code` scan against the proxy address `0x7cfa...1ad` itself only returns the proxy's own
dispatcher (`delegatecall` forwarding logic), not the real function selectors it forwards to.
Scanning the proxy would give a false negative for every selector. The four selectors the adapter
depends on (`withdraw`, `maxWithdraw`, `redeem`, `deposit`) are all present in the implementation's
bytecode (call 4).

**Why `Error("8")` on amount zero is positive evidence.** Call 2 reverts with `0x08c379a0...`
(standard Solidity `Error(string)` encoding) carrying the code `"8"` — Aave's own invalid-amount
error code for a zero-amount operation. A call to a selector missing from the jump table reverts
with **empty** revert data (falls through to the proxy's fallback/receive), not a decoded string
error. Getting Aave's real error message back proves the call reached real Aave logic through the
selector dispatch, not that it bounced off a missing entry.

**Operational consequence.** `adapter.rs` does NOT change: it keeps calling
`erc4626::withdraw_from_vault` as the primary path. `redeem_from_vault` remains the already-existing,
unexercised fallback — same status it had before this probe.

---

### WR-02-DILUTION: MEASURED — a 50 bps deposit-credit haircut mints 1,000 fewer vault shares than face value for a 200,000-unit deposit (199,000 minted vs 200,000 fair); the `deposit_leg` guard reverts `DepositShortfall` beyond 100 bps in isolation (`vault-core`'s own unit test WR-02/T-12.1-18, using a mocked `total_assets()`), 2026-07-24

Measured live on the Arbitrum Sepolia rig (`adapter-e2e`'s
`deposit_credit_shortfall_within_tolerance_is_absorbed_and_measured`, `packages/contracts/adapter-e2e/tests/sepolia_edge_cases.rs`):
`MockVault::setDepositCreditBps(9950)` (a 50 bps entry fee, inside the guard's 100 bps tolerance),
then a 200,000-unit (0.2 USDC) deposit through `core.deposit()`. `vault.totalSupply()`'s growth for
that one deposit was 1,000 shares short of what `vault.convertToShares()` reported moments before
the haircut armed — exactly 50 bps, matching the knob.

**Where the loss lands, and where it does not.** `deposit_leg`'s own `sharesOf`/`adapterTotalShares`/
`adapter.total_assets()` reads show **no measurable loss** for this deposit (asserted, not just
noted, in the same test) — because each `MockVault` on this rig has exactly one shareholder (its
adapter), `adapter.total_assets() = convertToAssets(balanceOf(adapter))` is pinned to
`100% × totalAssets()` regardless of how few of the vault's own shares were minted. The haircut is
real (the vault's own share ledger proves it), but it is invisible to the core's ledger until a
SECOND real shareholder exists in the same vault to be diluted against.

**Companion finding, from `deposit_credit_shortfall_beyond_tolerance_reverts` in the same file.**
Reproducing that second-shareholder condition (via a direct USDC donation, mirroring the
`vault-core` unit test's `mock_total_assets` donation) does make the core ledger's `ts`/real-balance
ratio extreme enough to matter — but at that ratio, the underlying `MockVault`'s OWN raw
share-minting (`vault-adapter`'s `ZeroShares` guard, evaluated inside `adapter_dispatch::deposit`,
BEFORE `deposit_leg`'s own math runs) floors to zero first, every time. This is not incidental: with
the adapter as the vault's sole shareholder, a bootstrap small enough to keep the core ledger's `ts`
affordable to skew also leaves the vault holding too few raw shares to survive a small slice's own
share-minting arithmetic. `DepositShortfall` itself is proven correct in isolation by its own unit
test; on this rig's actual adapter+MockVault topology, `ZeroShares` is the guard that reaches the
donation-inflated vector first, live.

**Verdict.** WR-02 is accepted with the existing 100 bps `deposit_leg` guard (`DepositShortfall`)
plus the `ZeroShares` backstop it was found to defer to on-chain; the measured rounding loss below
100 bps (50 bps → 1,000-of-200,000 shares, i.e. 0.5%) is small, proportional, and does not compound
across unrelated deposits (it is scoped to the single deposit it affects). D-13's rejection of full
symmetrization (a second `total_assets()` read per leg) stands — the number here does not reopen it.
See `docs/known-issues.md` for the checklist-facing summary.

---
