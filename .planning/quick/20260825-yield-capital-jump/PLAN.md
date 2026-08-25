---
slug: yield-capital-jump
created: 2026-08-25
type: quick
status: in-progress
---

# Fix: el contador de yield lee saltos de capital como rendimiento

## Bug (reproducido en producción, usuario 0x09f18f…3Ec4, 2026-08-25)

`useVaultYield` deriva la tasa por segundo de dos muestras de valor de posición. El home nunca
pasa `txNonce` (el comentario de `page.tsx` dice que los writes completan en otras rutas; quedó
viejo: hoy todo vive en el rail de `/`). Un depósito de 0.5 USDC entre muestras (dt 105.7s) se
leyó como yield → rate $0.00473/s → APY 10.17M% y posición mostrada $1.4667 contra $0.9999
on-chain. Además, en el WebView de Lemon no hay refetch pasivo (sin window-focus), así que la
tasa envenenada queda congelada en el cap de 120s indefinidamente.

## Fix (root cause, en la función compartida)

1. `lib/vault/yieldSnapshot.ts` — gate de plausibilidad dentro de `deriveRate`: si la tasa
   implica un APR > MAX_PLAUSIBLE_APR (1000%), es movimiento de capital, no yield → rate 0
   (la muestra nueva igual se escribe, que es el rebase). Cubre deposit/withdraw/rebalance de
   cualquier ruta, otra pestaña o tx externa, sin threadear txNonce por tres pantallas.
2. `hooks/useVaultPosition.ts` — `refetchInterval: 60_000`: sin polling el contador no recibe
   muestras nuevas dentro del WebView y nunca re-deriva la tasa.
3. `app/page.tsx` — corregir el comentario stale sobre txNonce.
4. Tests: casos de gate en `yieldSnapshot.test.ts` (salto de depósito → 0, yield plausible pasa,
   retiro → 0, prev 0 → 0); ajustar los casos viejos que usaban deltas implausibles.

## Verificación

`vitest run` completo + `tsc`/build + lint sobre los archivos tocados.
