//! Placeholder `#[public]` impl so the crate compiles and exports an ABI from commit 1.
//! Plan 03 fills this in: `init(vault, core)` as a guarded one-shot method (not `#[constructor]`,
//! per CONTEXT.md D-03/D-04), plus `deposit`/`withdraw`/`total_assets`/`max_withdraw`.

use stylus_sdk::prelude::*;

use crate::VaultAdapter;

#[public]
impl VaultAdapter {}
