// Required by `cargo stylus deploy`'s constructor check, which runs the crate as a `cargo run`
// bin target (`export-abi` feature) to introspect the contract ABI before deploying.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]

#[cfg(not(any(test, feature = "export-abi")))]
#[no_mangle]
pub extern "C" fn main() {}

#[cfg(feature = "export-abi")]
fn main() {
    vault_core::print_from_args();
}
