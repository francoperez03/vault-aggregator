//! Owner-controlled adapter registry helpers (D-07/D-08). Pure storage-mutation/query helpers
//! operating on `&VaultCore`/`&mut VaultCore`, called from `core.rs`'s `#[public]` methods after
//! the `ensure_initialized()?`/`only_owner()?` guards have already run (guard-before-mutate).
//!
//! ## Removal semantics (resolves RESEARCH.md Open Question 2)
//!
//! `remove_adapter` uses **swap-remove**: the last element of `adapters` is moved into the removed
//! slot and the array is popped. This is cheaper in Stylus storage than a shift-remove (no O(n)
//! slot rewrites), at the cost of reordering the array on every removal.
//!
//! Consequence for D-10 ("rounding remainder goes to the first active adapter"): "first active
//! adapter" means index 0 of the CURRENT `adapters` array (skipping disabled entries) evaluated
//! AT DEPOSIT TIME (Plan 03), never a frozen insertion order. An auditor should read this single
//! rule and not need to reason about historical registry mutations.

use alloy_primitives::Address;

use crate::VaultCore;

/// True if `adapter` is present in the registry (regardless of enabled/disabled state).
pub fn is_registered(core: &VaultCore, adapter: Address) -> bool {
    index_of(core, adapter).is_some()
}

/// Index of `adapter` in the `adapters` array, if registered.
pub fn index_of(core: &VaultCore, adapter: Address) -> Option<usize> {
    for i in 0..core.adapters.len() {
        if core.adapters.get(i) == Some(adapter) {
            return Some(i);
        }
    }
    None
}

/// Swap-remove `adapters[idx]`: move the last element into `idx`, then pop. See the module-level
/// doc-comment for why this is the locked removal semantics.
pub fn swap_remove(core: &mut VaultCore, idx: usize) {
    let last = core.adapters.len() - 1;
    if idx != last {
        if let Some(last_adapter) = core.adapters.get(last) {
            core.adapters.setter(idx).unwrap().set(last_adapter);
        }
    }
    core.adapters.pop();
}
