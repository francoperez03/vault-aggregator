# vault-periphery

The stateless Permit2 front door for the Vault Aggregator (D-A1/D-19). Optional: any EOA can call
`vault-core::depositFor` directly and skip this contract entirely. It exists for wallets that
cannot do a plain `approve` + `deposit` two-transaction flow — the same constraint CoinFlip's own
`betWithPermit2` already works around, and the reason Lemon's smart-account wallet needs it here
too.

## What it is

Three immutable constructor arguments (`core`, `permit2`, `usdc`), no owner, no setter, no
privileged role recognized by the core. `depositWithPermit` pulls USDC through a single-use
Permit2 `SignatureTransfer` signature (the `PermitTransferFrom` / `SignatureTransferDetails`
struct, matching the canonical Permit2 deployment at the same address on every EVM chain) and
forwards the pulled amount straight to `vault-core::depositFor(user, amount)`.

The position is credited to whoever signed the permit (`msg.sender`'s signature, not the caller
submitting the transaction), split by that signer's own stored weights on the core. Because
`depositFor` always credits the address the signature proves ownership for, never the caller, a
compromised or malicious periphery could at most donate its own transient balance — it cannot
redirect or inflate anyone's credited position on the core. This is why the core's `depositFor`
stays permissionless: the safety property lives in the core pulling exactly the amount it measures
via its own `transferFrom`, not in trusting the periphery.

Only the `SignatureTransfer` half of Permit2 is ported (matching CoinFlip's own periphery);
`AllowanceTransfer` is out of scope, not requested by either milestone.

## Why a separate contract

Kept out of the frozen `vault-core` on purpose: this is the client-facing, volatile surface — the
piece most likely to change as wallet integrations evolve (Lemon's `callSmartContract` support,
future wallets, signature format tweaks) — while the core's ledger and share math stay untouched
and auditable. Replacing this contract is cheap: deploy a new one, no core migration, though every
outstanding Permit2 signature bound to the old periphery address stops working (expected — Permit2
signatures are scoped to the spender contract that will spend them).

## Deployed addresses

Not duplicated here — see `../../../docs/TESTNET.md` (Arbitrum Sepolia) and
`../../../docs/RUNBOOK-M2.md` (Arbitrum One).
