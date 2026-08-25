---
slug: yield-capital-jump
status: complete
completed: 2026-08-25
---

# Summary

Root cause confirmed against production data (user 0x09f18f…3Ec4): a 0.5 USDC deposit landing
105.7s after the previous localStorage sample derived a 4730 atomic/s "yield" rate (~10M% APY),
and the Lemon WebView never resamples (no focus events, no polling), so the poisoned rate froze
at the 120s extrapolation cap showing $1.4667 for a $0.9999 position.

## Changes

- `lib/vault/yieldSnapshot.ts` — `MAX_PLAUSIBLE_APR` (1000%) gate inside `deriveRate`: any delta
  implying more is capital movement, rate 0 (sample still written = rebase). Single choke point,
  covers every write source without threading txNonce.
- `hooks/useVaultPosition.ts` — `refetchInterval: 60_000` so samples keep flowing inside the
  WebView.
- `app/page.tsx` — stale comment corrected (writes DO complete on the `/` rail now).
- Tests: 5 new gate cases (incl. exact production numbers) + fixtures rescaled to plausible
  deltas; hook-level regression test for the no-txNonce path.

## Verification

- `vitest run`: 244/244 across 32 files.
- `next build`: clean.
- `eslint`: broken pre-existing repo-wide (v9 flat-config migration pending) — unrelated, not
  introduced here.
