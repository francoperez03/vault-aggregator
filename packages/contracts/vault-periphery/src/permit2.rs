//! Permit2 `SignatureTransfer` binding (D-18/D-19, Lemon USDC token-entry path).
//!
//! Only the `SignatureTransfer` half of Permit2's canonical surface is bound here. The
//! `AllowanceTransfer` half (`PermitSingle`, `PermitDetails`, `permit`, `transferFrom`,
//! `register_permit`, `pull_tokens_allowance`, `to_u160`, `to_u48`) is CoinFlip's standalone
//! weekly-permit path — the vault never asked for it, and porting it would be ~90 lines of dead
//! bytes against a gate this crate has to clear on its own.
//!
//! **Why a bare `sol!` and not the primitive-param interface macro (ADR-001):** `stylus-proc`'s
//! `build_selector` computes the function selector by `to_string()`-ing each parameter's Solidity
//! type name literally (e.g. `"PermitTransferFrom"`), instead of canonicalizing custom struct
//! types into their flattened tuple ABI form (`"((address,uint256),uint256,uint256)"`) the way
//! `alloy_sol_types`'s own `sol!` macro and every real ABI encoder do. For this exact signature
//! that produces `0x71b31a6f`, which never matches the real Permit2 contract's dispatcher
//! (`cast sig "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"`
//! = `0x30f28b7a`). This bug was reproduced for real in CoinFlip (T-03-14) before the bare-`sol!`
//! fallback was adopted there; `selector_matches_real_permit2_signature` below pins the correct
//! selector so this crate can't regress into the same class of bug.

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

/// Canonical Permit2 address -- identical on Arbitrum One and Arbitrum Sepolia.
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

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::U256;
    use stylus_sdk::prelude::*;
    use stylus_sdk::testing::TestVM;

    use crate::VaultPeriphery;

    fn permit2_addr() -> Address {
        CANONICAL_PERMIT2
    }

    fn core_addr() -> Address {
        Address::from([0x0B; 20])
    }

    fn usdc_addr() -> Address {
        Address::from([0x0C; 20])
    }

    fn user_addr() -> Address {
        Address::from([0x0F; 20])
    }

    fn contract_addr() -> Address {
        Address::from([0x99; 20])
    }

    /// Deploys a `VaultPeriphery` instance purely so this test has a real `TopLevelStorage`
    /// implementor to drive `Call::new_mutating` through -- this proves the ABI encoding/dispatch
    /// shape, not `depositWithPermit2`'s business logic (that lives in `router.rs`'s tests).
    fn deploy(vm: &TestVM) -> VaultPeriphery {
        let mut contract = VaultPeriphery::from(vm);
        contract
            .constructor(core_addr(), permit2_addr(), usdc_addr())
            .unwrap();
        contract
    }

    /// Mirrors `pull_tokens`'s exact calldata construction, so tests can compute the expected key
    /// for `TestVM::mock_call`. Selector cross-checked against `cast sig
    /// "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"`
    /// = `0x30f28b7a`.
    fn expected_calldata(
        token: Address,
        amount: U256,
        nonce: U256,
        deadline: U256,
        to: Address,
        owner: Address,
        signature: Vec<u8>,
    ) -> Vec<u8> {
        permitTransferFromCall {
            permit: PermitTransferFrom {
                permitted: TokenPermissions { token, amount },
                nonce,
                deadline,
            },
            transferDetails: SignatureTransferDetails {
                to,
                requestedAmount: amount,
            },
            owner,
            signature: signature.into(),
        }
        .abi_encode()
    }

    #[test]
    fn selector_matches_real_permit2_signature() {
        // cast sig "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"
        // = 0x30f28b7a  (the primitive-param interface macro would generate 0x71b31a6f -- ADR-001)
        let calldata = expected_calldata(
            usdc_addr(),
            U256::from(1u64),
            U256::from(1u64),
            U256::from(1u64),
            contract_addr(),
            user_addr(),
            alloc::vec![],
        );
        assert_eq!(&calldata[0..4], &[0x30, 0xf2, 0x8b, 0x7a]);
    }

    /// Fixes the flattened-tuple parameter layout (not just the selector) against
    /// `alloy_sol_types`'s own encoder, so a future refactor of the struct fields can't silently
    /// reorder the ABI-encoded params while the selector test above still passes.
    #[test]
    fn params_match_flattened_tuple_encoding() {
        let permit = PermitTransferFrom {
            permitted: TokenPermissions {
                token: usdc_addr(),
                amount: U256::from(1_000u64),
            },
            nonce: U256::from(7u64),
            deadline: U256::from(9_999_999_999u64),
        };
        let details = SignatureTransferDetails {
            to: contract_addr(),
            requestedAmount: U256::from(1_000u64),
        };
        let signature: Vec<u8> = alloc::vec![0xABu8; 65];

        let via_call = permitTransferFromCall {
            permit: permit.clone(),
            transferDetails: details.clone(),
            owner: user_addr(),
            signature: signature.clone().into(),
        }
        .abi_encode();

        // Same params, encoded directly as a tuple of the sol! struct types (no selector prefix)
        // -- fixes the flattened-tuple layout independently of `permitTransferFromCall`'s own
        // encoding path, so a future field-order refactor can't silently drift undetected.
        let params_only = alloy_sol_types::SolValue::abi_encode_params(&(
            permit,
            details,
            user_addr(),
            signature.clone(),
        ));

        assert_eq!(&via_call[4..], &params_only[..]);
    }

    #[test]
    fn pull_tokens_dispatches_matching_calldata_and_succeeds() {
        let vm = TestVM::default();
        vm.set_contract_address(contract_addr());
        let mut contract = deploy(&vm);

        let amount = U256::from(1_000u64);
        let nonce = U256::from(1u64);
        let deadline = U256::from(9_999_999_999u64);
        let signature: Vec<u8> = alloc::vec![0xABu8; 65];

        let calldata = expected_calldata(
            usdc_addr(),
            amount,
            nonce,
            deadline,
            contract_addr(),
            user_addr(),
            signature.clone(),
        );
        vm.mock_call(permit2_addr(), calldata, U256::ZERO, Ok(alloc::vec![]));

        let permit = PermitTransferFrom {
            permitted: TokenPermissions {
                token: usdc_addr(),
                amount,
            },
            nonce,
            deadline,
        };
        let details = SignatureTransferDetails {
            to: contract_addr(),
            requestedAmount: amount,
        };

        let call_ctx = Call::new_mutating(&mut contract);
        let result = pull_tokens(
            &vm,
            call_ctx,
            permit2_addr(),
            permit,
            details,
            user_addr(),
            signature,
        );

        assert!(result.is_ok());
    }

    #[test]
    fn pull_tokens_propagates_permit2_revert() {
        let vm = TestVM::default();
        vm.set_contract_address(contract_addr());
        let mut contract = deploy(&vm);

        let amount = U256::from(1_000u64);
        let nonce = U256::from(2u64);
        let deadline = U256::from(9_999_999_999u64);
        let signature: Vec<u8> = alloc::vec![0xCDu8; 65];

        let calldata = expected_calldata(
            usdc_addr(),
            amount,
            nonce,
            deadline,
            contract_addr(),
            user_addr(),
            signature.clone(),
        );
        vm.mock_call(
            permit2_addr(),
            calldata,
            U256::ZERO,
            Err(b"InvalidSignature".to_vec()),
        );

        let permit = PermitTransferFrom {
            permitted: TokenPermissions {
                token: usdc_addr(),
                amount,
            },
            nonce,
            deadline,
        };
        let details = SignatureTransferDetails {
            to: contract_addr(),
            requestedAmount: amount,
        };

        let call_ctx = Call::new_mutating(&mut contract);
        let result = pull_tokens(
            &vm,
            call_ctx,
            permit2_addr(),
            permit,
            details,
            user_addr(),
            signature,
        );

        assert!(result.is_err());
    }
}
