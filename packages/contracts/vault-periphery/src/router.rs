use alloc::vec::Vec;

use alloy_primitives::{Address, Bytes, U256};
use stylus_sdk::prelude::*;

use crate::permit2::{self, PermitTransferFrom, SignatureTransferDetails, TokenPermissions};
use crate::usdc;
use crate::VaultPeriphery;

sol_interface! {
    /// Primitive-typed params only -- safe with `sol_interface!`. The nested-struct Permit2 case
    /// uses the manual bare `sol!` in permit2.rs (ADR-001).
    interface IVaultCore {
        function depositFor(address user, uint256 amount) external returns (uint256);
    }
}

#[public]
impl VaultPeriphery {
    /// D-19: stateless and privilege-free. Three immutable addresses, no owner, no setter.
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

    /// Lemon/browser token-entry path. Pulls `amount` through canonical Permit2 with a
    /// single-use `SignatureTransfer` signature, then hands it to the core's PERMISSIONLESS
    /// `depositFor` -- the same entrypoint any EOA can call. This contract holds no privilege the
    /// core recognises: if it were compromised it could at most donate its own transient balance,
    /// never mint an unbacked claim against other users' custodied USDC (D-19).
    ///
    /// The position is credited to `msg.sender`, split by THAT address's own stored weights. A
    /// user with no weights set gets `NoWeightsSet` from the core and the whole tx reverts,
    /// leaving nothing behind here (D-19 residual risk #2).
    ///
    /// The signature is bound to this contract's address by Permit2 itself (the EIP-712 struct
    /// commits to the `spender` = whoever calls `permitTransferFrom`), so it is not replayable
    /// through another contract. Redeploying this periphery invalidates outstanding signatures --
    /// correct, and stated here on purpose.
    ///
    /// No fixed signature-length guard: Permit2 accepts both 65/64-byte ECDSA (EOA owners) and
    /// arbitrary-length ERC-1271 `isValidSignature` (smart-account owners, e.g. Lemon's Safe-style
    /// wallet). A length check here would reject legitimate Lemon signatures before Permit2 ever
    /// sees them -- see the doc comment inside the method body.
    pub fn deposit_with_permit(
        &mut self,
        amount: U256,
        nonce: U256,
        deadline: U256,
        signature: Bytes,
    ) -> Result<U256, Vec<u8>> {
        // No signature-shape validation here: Permit2 verifies the signature itself, and its
        // check is length-aware — 65/64-byte ECDSA for EOA owners, ERC-1271 `isValidSignature`
        // (any length) for smart-account owners. Smart-account wallets (e.g. Lemon's Gnosis
        // Safe) sign 162-byte ERC-1271 contract signatures; a fixed-65-byte guard rejects
        // those with InvalidSignatureLength before Permit2 ever sees them. Pass the signature
        // straight through and let Permit2 be the single validator.
        if amount.is_zero() {
            return Err(b"ZeroAmount".to_vec());
        }

        let user = self.vm().msg_sender();
        let core_addr = self.core.get();
        let usdc_addr = self.usdc.get();
        let self_addr = self.vm().contract_address();

        // 1. Permit2 -> THIS contract (Variante A, D-19). Transient hold inside this tx only.
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

        // 2. Exact allowance, never infinite -- WR-03 is literally the residual-allowance
        //    finding and this contract must not contradict the fix.
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

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_sol_types::{sol, SolCall, SolValue};
    use stylus_sdk::testing::TestVM;

    // Mirrors the `IVaultCore` interface's `depositFor` selector/param encoding as a bare `sol!`
    // call type, so this test module can build the exact calldata `sol_interface!`'s generated
    // dispatch produces without a public `*Call` type of its own (the macro only emits methods).
    sol! {
        function depositFor(address user, uint256 amount) external returns (uint256);
    }

    fn core_addr() -> Address {
        Address::from([0x0B; 20])
    }

    fn permit2_addr() -> Address {
        crate::permit2::CANONICAL_PERMIT2
    }

    fn usdc_addr() -> Address {
        Address::from([0x0C; 20])
    }

    fn user_addr() -> Address {
        Address::from([0x0F; 20])
    }

    fn valid_signature() -> Bytes {
        let mut sig = alloc::vec![0xABu8; 65];
        sig[64] = 27;
        sig.into()
    }

    fn deploy(vm: &TestVM) -> VaultPeriphery {
        let mut contract = VaultPeriphery::from(vm);
        contract
            .constructor(core_addr(), permit2_addr(), usdc_addr())
            .unwrap();
        contract
    }

    #[test]
    fn constructor_rejects_zero_addresses() {
        let vm = TestVM::default();
        let mut contract = VaultPeriphery::from(&vm);

        assert_eq!(
            contract
                .constructor(Address::ZERO, permit2_addr(), usdc_addr())
                .unwrap_err(),
            b"ZeroCore".to_vec()
        );
        assert_eq!(
            contract
                .constructor(core_addr(), Address::ZERO, usdc_addr())
                .unwrap_err(),
            b"ZeroPermit2".to_vec()
        );
        assert_eq!(
            contract
                .constructor(core_addr(), permit2_addr(), Address::ZERO)
                .unwrap_err(),
            b"ZeroUsdc".to_vec()
        );
    }

    #[test]
    fn deposit_with_permit_rejects_zero_amount() {
        let vm = TestVM::default();
        vm.set_sender(user_addr());
        let mut contract = deploy(&vm);

        let result = contract.deposit_with_permit(
            U256::ZERO,
            U256::from(1u64),
            U256::from(9_999_999_999u64),
            valid_signature(),
        );
        assert_eq!(result.unwrap_err(), b"ZeroAmount".to_vec());
    }

    /// Proves `deposit_with_permit` credits `msg.sender`, not some other address: every mock
    /// below is registered keyed on the exact calldata containing `user_addr()`, so a code path
    /// that passed a different address to Permit2/`depositFor` would hit an unmocked call and
    /// panic instead of returning the expected `minted` value.
    ///
    /// Per T-12.1-21 (`stylus-test` 0.10.7's shared return-data buffer): this test proves the
    /// ROUTING (the right `user` reaches `depositFor`), not the full multi-step return-value
    /// bookkeeping across all four external calls in sequence -- the live verification of the
    /// complete flow (pull -> approve -> depositFor -> zero) lives in Plan 09's
    /// `sepolia_periphery.rs`.
    #[test]
    fn deposit_with_permit_credits_msg_sender() {
        let vm = TestVM::default();
        let contract_addr = Address::from([0x99; 20]);
        vm.set_contract_address(contract_addr);
        vm.set_sender(user_addr());
        let mut contract = deploy(&vm);

        let amount = U256::from(1_000u64);
        let nonce = U256::from(1u64);
        let deadline = U256::from(9_999_999_999u64);
        let signature = valid_signature();

        let permit_calldata = crate::permit2::permitTransferFromCall {
            permit: crate::permit2::PermitTransferFrom {
                permitted: crate::permit2::TokenPermissions {
                    token: usdc_addr(),
                    amount,
                },
                nonce,
                deadline,
            },
            transferDetails: crate::permit2::SignatureTransferDetails {
                to: contract_addr,
                requestedAmount: amount,
            },
            owner: user_addr(),
            signature: signature.to_vec().into(),
        }
        .abi_encode();
        vm.mock_call(permit2_addr(), permit_calldata, U256::ZERO, Ok(alloc::vec![]));

        let deposit_for_calldata = depositForCall {
            user: user_addr(),
            amount,
        }
        .abi_encode();
        vm.mock_call(
            core_addr(),
            deposit_for_calldata,
            U256::ZERO,
            Ok(amount.abi_encode()),
        );

        let result = contract.deposit_with_permit(amount, nonce, deadline, signature);
        assert_eq!(result.unwrap(), amount);
    }
}
