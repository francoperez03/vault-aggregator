# Bundle: periphery (Permit2 token-entry, new trust boundary)

## What this is

`VaultPeriphery` is a small, separately-deployed Stylus contract that sits IN FRONT of
`VaultCore` (the vault aggregator, not fully included in this bundle — only its `deposit_for`
entrypoint is pasted below as context). It exists purely to let a browser-based frontend take a
user's USDC via a single EIP-712 signature (Uniswap's canonical Permit2 `SignatureTransfer`
flow) instead of requiring a separate on-chain `approve` transaction before the deposit.

It is stateless with respect to privilege: it holds three immutable addresses set once at
construction (the core, the canonical Permit2 contract, and USDC), has no owner, and no setter.
Nothing about its own state can be changed after deployment. If this contract were fully
compromised (arbitrary code execution somehow), the worst it could do is: (a) misroute its OWN
transient per-call USDC balance, or (b) call `VaultCore.depositFor` with the wrong `user` inside
one specific call it itself triggers — it cannot mint an unbacked claim against other users'
already-custodied funds, because the core independently pulls (never trusts a declared amount).

This is a genuinely NEW trust boundary introduced into the system: money now flows
`user's EIP-712 signature -> Permit2 (external, canonical, already-audited) -> this periphery
contract (transient custody, single transaction) -> VaultCore (permissionless deposit_for)`.

## Public surface

- `constructor(core, permit2, usdc)` — one-time, rejects any zero address.
- `core()`, `permit2()`, `usdc()` — read-only accessors for the three immutable addresses.
- `deposit_with_permit2(amount, nonce, deadline, signature)` — the ENTIRE point of this contract.
  Validates the raw signature shape locally (length, `v` byte), then:
  1. Calls Permit2's `permitTransferFrom` to pull `amount` USDC from `msg.sender` into THIS
     contract (Permit2 itself verifies the EIP-712 signature, nonce, and deadline — this contract
     trusts Permit2's canonical, already-deployed, already-audited verification entirely and does
     none of its own signature/nonce/deadline validation beyond the raw shape check above).
  2. Approves `VaultCore` for exactly `amount` (never infinite).
  3. Calls `VaultCore.deposit_for(msg.sender, amount)` — the core PULLS via its own
     `transferFrom`, it never trusts a number this periphery merely asserts.
  4. Re-zeroes the allowance to `VaultCore` defensively (idempotent on the happy path, a guard
     against a core that pulled less than approved).

## What this code is supposed to guarantee

- The deposit is always credited to `msg.sender` (the signer), never to some other address —
  every step (the Permit2 pull's destination, the core's credited user) must consistently use the
  SAME address, and that address must be the actual caller of `deposit_with_permit2`, not a
  parameter anyone could pass.
- The signature the EIP-712 struct commits to is bound to THIS contract's address as the
  `spender`/`to` in the Permit2 struct — so a signature authorizing a pull into this specific
  periphery cannot be replayed against a different contract to redirect funds elsewhere. If this
  periphery is ever redeployed at a new address, every previously-signed-but-unused permit becomes
  worthless (dead, not dangerous) at the old address.
- No allowance to `VaultCore` is ever left standing after this function returns, on either the
  happy path or a reverted path (a revert rolls back all state including any approve that
  happened before it, since these are EVM/Stylus semantics — the explicit re-zero at step 4 only
  covers the case where the core deliberately pulled less than what was approved).
- The 65-byte-signature / valid-`v` check happens BEFORE any external call — a malformed
  signature must never even reach Permit2.

## Source: `vault-periphery/src/lib.rs`

```rust
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

mod permit2;
mod router;
mod usdc;

use stylus_sdk::prelude::*;

#[cfg(feature = "export-abi")]
pub use router::print_from_args;

sol_storage! {
    #[entrypoint]
    pub struct VaultPeriphery {
        address core;
        address permit2;
        address usdc;
    }
}
```

## Source: `vault-periphery/src/main.rs`

```rust
// Required by `cargo stylus deploy`'s constructor check, which runs the crate as a `cargo run`
// bin target (`export-abi` feature) to introspect the contract ABI before deploying.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]

#[cfg(not(any(test, feature = "export-abi")))]
#[no_mangle]
pub extern "C" fn main() {}

#[cfg(feature = "export-abi")]
fn main() {
    vault_periphery::print_from_args();
}
```

## Source: `vault-periphery/src/router.rs` (production code, test module omitted)

```rust
use alloc::vec::Vec;

use alloy_primitives::{Address, Bytes, U256};
use stylus_sdk::prelude::*;

use crate::permit2::{self, PermitTransferFrom, SignatureTransferDetails, TokenPermissions};
use crate::usdc;
use crate::VaultPeriphery;

sol_interface! {
    /// Primitive-typed params only -- safe with `sol_interface!`. The nested-struct Permit2 case
    /// uses the manual bare `sol!` in permit2.rs (see that file's ADR note).
    interface IVaultCore {
        function depositFor(address user, uint256 amount) external returns (uint256);
    }
}

#[public]
impl VaultPeriphery {
    /// Stateless and privilege-free. Three immutable addresses, no owner, no setter.
    /// Replacing the periphery means deploying a new one -- which also invalidates every
    /// outstanding Permit2 signature bound to the old address, and that is correct behaviour
    /// worth stating out loud.
    #[constructor]
    pub fn constructor(&mut self, core: Address, permit2: Address, usdc: Address) -> Result<(), Vec<u8>> {
        if core.is_zero() {
            return Err(b"ZeroCore".to_vec());
        }
        if permit2.is_zero() {
            return Err(b"ZeroPermit2".to_vec());
        }
        if usdc.is_zero() {
            return Err(b"ZeroUsdc".to_vec());
        }
        self.core.set(core);
        self.permit2.set(permit2);
        self.usdc.set(usdc);
        Ok(())
    }

    pub fn core(&self) -> Address {
        self.core.get()
    }

    pub fn permit2(&self) -> Address {
        self.permit2.get()
    }

    pub fn usdc(&self) -> Address {
        self.usdc.get()
    }

    /// Browser token-entry path. Pulls `amount` through canonical Permit2 with a
    /// single-use `SignatureTransfer` signature, then hands it to the core's PERMISSIONLESS
    /// `depositFor` -- the same entrypoint any EOA can call. This contract holds no privilege the
    /// core recognises: if it were compromised it could at most donate its own transient balance,
    /// never mint an unbacked claim against other users' custodied USDC.
    ///
    /// The position is credited to `msg.sender`, split by THAT address's own stored weights. A
    /// user with no weights set gets `NoWeightsSet` from the core and the whole tx reverts,
    /// leaving nothing behind here.
    ///
    /// The signature is bound to this contract's address by Permit2 itself (the EIP-712 struct
    /// commits to the `spender` = whoever calls `permitTransferFrom`), so it is not replayable
    /// through another contract. Redeploying this periphery invalidates outstanding signatures --
    /// correct, and stated here on purpose.
    pub fn deposit_with_permit2(
        &mut self,
        amount: U256,
        nonce: U256,
        deadline: U256,
        signature: Bytes,
    ) -> Result<U256, Vec<u8>> {
        // Defensive validation BEFORE any external call: exactly 65 bytes, byte 64 (`v`) in
        // {27, 28}.
        if signature.len() != 65 {
            return Err(b"InvalidSignatureLength".to_vec());
        }
        let v = signature[64];
        if v != 27 && v != 28 {
            return Err(b"InvalidSignatureV".to_vec());
        }
        if amount.is_zero() {
            return Err(b"ZeroAmount".to_vec());
        }

        let user = self.vm().msg_sender();
        let core_addr = self.core.get();
        let usdc_addr = self.usdc.get();
        let self_addr = self.vm().contract_address();

        // 1. Permit2 -> THIS contract. Transient hold inside this tx only.
        let permit = PermitTransferFrom {
            permitted: TokenPermissions {
                token: usdc_addr,
                amount,
            },
            nonce,
            deadline,
        };
        let details = SignatureTransferDetails {
            to: self_addr,
            requestedAmount: amount,
        };
        let permit2_addr = self.permit2.get();
        let pull_ctx = Call::new_mutating(self);
        permit2::pull_tokens(
            self.vm(),
            pull_ctx,
            permit2_addr,
            permit,
            details,
            user,
            signature.to_vec(),
        )?;

        // 2. Exact allowance, never infinite -- this is the residual-allowance guard: any
        //    lingering allowance on a compromised adapter/spender is a live exploitable surface,
        //    so this contract must not contradict that by granting an unbounded approval.
        let approve_ctx = Call::new_mutating(self);
        usdc::approve(self.vm(), approve_ctx, usdc_addr, core_addr, amount)?;

        // 3. The core PULLS. It never believes a declared amount.
        let deposit_ctx = Call::new_mutating(self);
        let minted = IVaultCore::from(core_addr).deposit_for(self.vm(), deposit_ctx, user, amount)?;

        // 4. Defensive zeroing: step 3 consumed the whole allowance, so this is a no-op on the
        //    happy path and a guard against a core that pulled less than it was approved for.
        let zero_ctx = Call::new_mutating(self);
        usdc::approve(self.vm(), zero_ctx, usdc_addr, core_addr, U256::ZERO)?;

        Ok(minted)
    }
}
```

## Source: `vault-periphery/src/permit2.rs` (production code, test module omitted)

```rust
//! Permit2 `SignatureTransfer` binding (browser/frontend USDC token-entry path).
//!
//! Only the `SignatureTransfer` half of Permit2's canonical surface is bound here. The
//! `AllowanceTransfer` half (`PermitSingle`, `PermitDetails`, `permit`, `transferFrom`,
//! `register_permit`, `pull_tokens_allowance`, `to_u160`, `to_u48`) belongs to a different,
//! standalone weekly-permit path elsewhere in this program — this vault never asked for it, and
//! porting it would be ~90 lines of dead bytes against a byte-size gate this crate has to clear
//! on its own.
//!
//! **Why a bare `sol!` and not the primitive-param interface macro:** `stylus-proc`'s
//! `build_selector` computes the function selector by `to_string()`-ing each parameter's Solidity
//! type name literally (e.g. `"PermitTransferFrom"`), instead of canonicalizing custom struct
//! types into their flattened tuple ABI form (`"((address,uint256),uint256,uint256)"`) the way
//! `alloy_sol_types`'s own `sol!` macro and every real ABI encoder do. For this exact signature
//! that produces `0x71b31a6f`, which never matches the real Permit2 contract's dispatcher
//! (`cast sig "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"`
//! = `0x30f28b7a`). This class of wrong-selector bug was reproduced for real elsewhere in this
//! program before the bare-`sol!` fallback was adopted here; `selector_matches_real_permit2_signature`
//! below pins the correct selector so this crate can't regress into the same class of bug.

use alloc::vec::Vec;

use alloy_primitives::Address;
use alloy_sol_types::{sol, SolCall};
use stylus_sdk::stylus_core::calls::MutatingCallContext;
use stylus_sdk::stylus_core::host::Host;

sol! {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    /// Canonical Permit2 `SignatureTransfer` surface (Uniswap reference). This periphery never
    /// verifies the signature/nonce/deadline itself -- Permit2 does, at its own canonical,
    /// already-audited deployment. Declared as a bare `sol!` function (not the primitive-param
    /// interface macro) so the selector is computed correctly for nested-struct params -- see the
    /// module doc comment.
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

/// Canonical Permit2 address -- identical on Arbitrum One and Arbitrum Sepolia. The constructor
/// takes `permit2` as an explicit argument (not this constant) so deploy tooling stays in
/// control; referenced here by tests and deploy scripts as the known-correct value to pass in.
#[allow(dead_code)]
pub const CANONICAL_PERMIT2: Address = Address::new([
    0x00, 0x00, 0x00, 0x00, 0x00, 0x22, 0xD4, 0x73, 0x03, 0x0F, 0x11, 0x6d, 0xDE, 0xE9, 0xF6, 0xB4,
    0x3a, 0xC7, 0x8B, 0xA3,
]);

/// Dispatches `permitTransferFrom` against the canonical Permit2 contract: builds calldata with
/// the correct (manually-verified) selector via `alloy_sol_types::SolCall::abi_encode`, then
/// calls through `stylus_sdk::call::call`. Permit2 validates `signature`/`nonce`/`deadline`
/// itself; this function only dispatches the call.
pub fn pull_tokens(
    vm: &impl Host,
    call_ctx: impl MutatingCallContext,
    permit2: Address,
    permit: PermitTransferFrom,
    details: SignatureTransferDetails,
    owner: Address,
    signature: Vec<u8>,
) -> Result<(), Vec<u8>> {
    let calldata = permitTransferFromCall {
        permit,
        transferDetails: details,
        owner,
        signature: signature.into(),
    }
    .abi_encode();
    stylus_sdk::call::call(vm, call_ctx, permit2, &calldata)?;
    Ok(())
}
```

## Source: `vault-periphery/src/usdc.rs` (production code, test module omitted)

```rust
//! USDC (external ERC-20) `approve` dispatch: vendorized from `vault-core/src/usdc.rs`, same bare
//! `sol!` + manual dispatch shape and the same tri-state return-value rule. The periphery never
//! needs `transfer_from`/`transfer`/`balance_of` -- it only ever grants the core an exact
//! allowance (and zeroes it again), so only `approve` is ported here.

use alloc::vec::Vec;

use alloy_primitives::{Address, U256};
use alloy_sol_types::{sol, SolCall};
use stylus_sdk::call::call;
use stylus_sdk::stylus_core::calls::MutatingCallContext;
use stylus_sdk::stylus_core::host::Host;

sol! {
    // cast sig "approve(address,uint256)" = 0x095ea7b3
    function approve(address spender, uint256 amount) external returns (bool);
}

/// Tri-state return decoding:
/// - empty buffer -> success (non-standard tokens that return nothing)
/// - decodes to `true` -> success
/// - decodes to `false` -> `Err(TransferFailed)` (the classic non-reverting-failure trap)
/// - any other shape -> `Err(TransferFailed)` (never silently treated as success)
fn decode_bool_result(result: &[u8]) -> Result<(), Vec<u8>> {
    if result.is_empty() {
        return Ok(());
    }
    match <bool as alloy_sol_types::SolValue>::abi_decode(result) {
        Ok(true) => Ok(()),
        Ok(false) => Err(b"TransferFailed".to_vec()),
        Err(_) => Err(b"TransferFailed".to_vec()),
    }
}

/// Approves `spender` to move `amount` of `token` on this periphery's behalf.
pub fn approve(
    vm: &impl Host,
    call_ctx: impl MutatingCallContext,
    token: Address,
    spender: Address,
    amount: U256,
) -> Result<(), Vec<u8>> {
    let calldata = approveCall { spender, amount }.abi_encode();
    let result = call(vm, call_ctx, token, &calldata)?;
    decode_bool_result(&result)
}
```

## Context: the core-side counterparty this periphery calls (`VaultCore::deposit_for`)

Pasted here so the auditor doesn't have to guess what happens on the other side of the
`IVaultCore::from(core_addr).deposit_for(...)` call above. This is the FULL body of that one
function, from `vault-core/src/core.rs`:

```rust
/// Permissionless by design. The core PULLS the USDC from `msg.sender` and credits
/// `user`, so crediting a third party is a gift, never a theft: an unbacked call reverts at
/// the `transferFrom`. There is no gate and no `setPeriphery`: the Permit2 periphery is
/// replaceable without touching the core.
pub fn deposit_for(&mut self, user: Address, amount: U256) -> Result<U256, Vec<u8>> {
    self.ensure_initialized()?;
    if amount.is_zero() {
        return Err(errors::zero_amount());
    }
    if user.is_zero() {
        return Err(errors::zero_address());
    }

    // No implicit fallback allocation exists. `user` bootstraps by calling
    // `rebalance(adapters, bps)` with a zero position first, which just writes their weights.
    // `user`'s OWN stored weights decide the split — never the caller's.
    let (targets, weights) = self.read_weights(user);
    if targets.is_empty() {
        return Err(errors::no_weights_set());
    }

    // Guard + snapshot BEFORE any mutating call: weights pointing at a disabled adapter must
    // revert with nothing having moved, so no funds can strand in a periphery mid-flow. Also
    // protects against minting against a post-deposit total_assets, which would dilute the
    // depositor against their own funds.
    let mut ta_before: Vec<U256> = Vec::with_capacity(targets.len());
    for adapter in targets.iter() {
        if !self.adapter_enabled.get(*adapter) {
            return Err(errors::adapter_not_enabled());
        }
        ta_before.push(adapter_dispatch::total_assets(self.vm(), *adapter)?);
    }

    let self_addr = self.vm().contract_address();
    let payer = self.vm().msg_sender(); // the only line whose semantics change vs a caller-only deposit.
    let pull_ctx = Call::new_mutating(self);
    usdc::transfer_from(self.vm(), pull_ctx, USDC, payer, self_addr, amount)?;

    let slices = share_math::split_by_bps(amount, &weights)?;
    let mut minted_total = U256::ZERO;
    for i in 0..targets.len() {
        // Skip 0-value legs: a dust-sized slice would hit the adapter's ZeroAmount guard and
        // revert an otherwise valid deposit.
        if slices[i].is_zero() {
            continue;
        }
        minted_total += self.deposit_leg(user, targets[i], slices[i], ta_before[i])?;
    }
    if minted_total.is_zero() {
        return Err(errors::zero_shares());
    }

    self.vm().log(Deposit { user, assets: amount, shares: minted_total });
    Ok(minted_total)
}
```

Note for this bundle: when `deposit_for` is called via the periphery, `self.vm().msg_sender()`
inside `deposit_for` is the PERIPHERY contract's address (the periphery is the direct caller of
the core), NOT the end user's EOA — `payer` above resolves to the periphery. `user` (the address
actually credited) is passed explicitly by the periphery as `self.vm().msg_sender()` AT THE
PERIPHERY LAYER, i.e. the end user's EOA, one hop earlier. Trace this distinction carefully: two
different "who is msg.sender" answers exist at two different call depths in the same logical flow.

---

## Reasoning tools

# Senior Auditor's Mindset

This is how a senior auditor thinks. Pattern-matching catches the obvious bugs — your specialty file teaches that. The high-value bugs, the ones everyone else misses, come from HOW you reason about code, not from WHAT bugs you know.

The senior auditor's edge is not "knowing more bug patterns" — it is having internalized mental tools they reach for instinctively when something feels off, when a path seems clean, or when a conclusion comes too quickly.

This file gives you three tools. They are not steps. You reach for the right one the moment the trigger fires. Use them. Trust your discomfort.

A finding is not real until you've traced the attack with concrete values. You are an attacker, not a defender — when you find a bug, deepen the attack; never argue yourself out of one.

---

## 1. The Feynman test (FIRST — use it before anything else)

**This is the first tool. Apply it the moment you open any new function or contract — before you reason about anything else.** Code you have not Feynman'd is code you have not actually understood.

When you read code, STOP and ask: "Can I explain what this function does to someone who doesn't know Solidity?"

Try it. In plain words. The places where your explanation gets fuzzy — where you reach for jargon instead of plain meaning — are where you're papering over an assumption. That's where bugs hide.

A senior auditor doesn't trust their understanding until they can explain it without the safety net of technical vocabulary.

---

## 2. Socratic questioning

For every line of code, ask: why is this here? What does it assume? What happens if the assumption breaks?

Don't accept "because that's how it's written" as an answer. Don't accept "the function name says so" as an answer. Drill until you reach the implicit belief the code rests on. The first answer is usually a restatement. The actual assumption is two or three "whys" deeper.

A senior auditor accepts no "because" without examining it.

---

## 3. Inversion

Every clean path gets a backward pass. After you understand what the code IS supposed to do, ask: how would I make it NOT do that?

Same code, attacker's eye instead of developer's eye. The developer asks "does this work?" The attacker asks "how do I break this?" Read every check and ask "what value slips past it?" Read every state update and ask "what state am I in just before this?"

A senior auditor never reads code only forward.

---

## When to reach for which tool

You don't apply these in order — except Feynman, which is always first. You reach for what the moment calls for:

- Opening any new function or contract → **Feynman** (always — before anything else)
- Trying to understand a line you don't yet → **Socratic**
- Something looks too clean → **Inversion**
- You reached a "bug" conclusion → amplify the attack (chain it, find more victims, lower the precondition cost — do NOT refute it)

Trust your discomfort. Reach for the tool. Don't stop until the discomfort has a name.

### Mental tool protocol — MANDATORY

The three tools above are NOT optional. Each has a trigger. When the trigger fires, emit the marker `[Tool: ...]` in your working text BEFORE continuing (not inside FINDING/LEAD blocks):

| Trigger | Marker | Content |
|---|---|---|
| You open a new function or contract to read | `[Feynman: <name>]` | Explain what it does in plain English — no jargon. |
| You stop on a line whose purpose isn't immediately clear | `[Socratic: <file:line> — why?]` | A one-line question that drills past "because that's how it's written." |
| A code path reads as clean / a check looks sufficient | `[Inversion: <function>]` | Three concrete attacker moves that attempt to defeat the path, with specific values. |

## Assigned agents for this bundle

Attack this bundle from these four lenses (specialty definitions live at
`.claude/skills/solidity-auditor/references/hacking-agents/<name>-agent.md` — adapt Solidity
vocabulary to Rust/Stylus mechanically):

1. **trust-gap-agent** — exactly where this contract starts trusting something it did not itself
   verify (Permit2's signature verification, the core's acceptance of `deposit_for`'s `user`
   parameter, the frontend's off-chain construction of `nonce`/`deadline`).
2. **periphery-agent** — this file's entire reason for existing: a periphery contract that holds
   no state-level privilege but IS a call-graph hop between a signed user intent and a
   permissionless core entrypoint. What can go wrong specifically because this hop exists that
   could not go wrong if the user called the core directly.
3. **first-principles-agent** — read `deposit_with_permit2` as if you have never seen a Permit2
   integration before. Does each of the four numbered steps actually need to happen in that
   order? What breaks if two of them race, or if one silently no-ops?
4. **economic-security-agent** — is there any way for the value pulled from `msg.sender` via
   Permit2 to diverge from the value the core ends up crediting, in either direction, across the
   full `pull -> approve -> deposit_for -> re-zero` sequence.
