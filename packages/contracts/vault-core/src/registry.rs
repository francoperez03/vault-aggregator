//! Owner-controlled adapter registry helpers (D-07/D-08). Pure storage-mutation/query helpers
//! operating on `&VaultCore`/`&mut VaultCore`, called from `core.rs`'s `#[public]` methods after
//! the `ensure_initialized()?`/`only_owner()?` guards have already run (guard-before-mutate).
//!
//! There is no removal helper here: `remove_adapter` was deleted from `core.rs` (Phase 13 Tier 2
//! trim) — `set_enabled(false)` is the only way to take an adapter out of new-deposit rotation,
//! and the registry array itself never shrinks. See `core.rs`'s `set_enabled` doc-comment for why
//! deleting the removal path retires the WR-01 finding instead of mitigating it.

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
