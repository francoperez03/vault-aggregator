//! `MockVault`'s single public-methods impl block (one `#[public]` impl per contract type, M1
//! carryover). Standard proportional share math with ERC-4626 rounding directions (deposit/redeem
//! floor, withdraw share-cost ceil). `totalAssets` is the vault's real asset balance — donations
//! inflate the share price exactly like a production 4626, which is what lets the Sepolia e2e
//! replay the inflation-attack scenario on-chain.

use alloc::vec::Vec;

use alloy_primitives::{Address, U256};
use stylus_sdk::prelude::*;

use crate::erc20;
use crate::MockVault;

/// Shares minted for a deposit (round down; 1:1 on an empty vault).
fn shares_for_deposit(assets: U256, total_shares: U256, total_assets: U256) -> Option<U256> {
    if total_shares.is_zero() || total_assets.is_zero() {
        return Some(assets);
    }
    assets
        .checked_mul(total_shares)
        .map(|p| p / total_assets)
}

/// Assets returned for redeeming shares (round down; 1:1 when supply is zero).
fn assets_for_shares(shares: U256, total_shares: U256, total_assets: U256) -> Option<U256> {
    if total_shares.is_zero() {
        return Some(shares);
    }
    shares
        .checked_mul(total_assets)
        .map(|p| p / total_shares)
}

/// Shares burned for an asset-exact withdrawal (round up, per ERC-4626).
fn shares_for_withdraw(assets: U256, total_shares: U256, total_assets: U256) -> Option<U256> {
    if total_shares.is_zero() || total_assets.is_zero() {
        return Some(assets);
    }
    let product = assets.checked_mul(total_shares)?;
    let ceil_bump = total_assets.checked_sub(U256::from(1))?;
    product.checked_add(ceil_bump).map(|p| p / total_assets)
}

#[public]
impl MockVault {
    /// Sets `asset`/`owner` once; `withdraw_cap` starts at U256::MAX (no throttle).
    pub fn init(&mut self, asset: Address, owner: Address) -> Result<(), Vec<u8>> {
        if self.initialized.get() {
            return Err(b"AlreadyInitialized".to_vec());
        }
        if asset.is_zero() || owner.is_zero() {
            return Err(b"ZeroAddress".to_vec());
        }
        self.asset.set(asset);
        self.owner.set(owner);
        self.withdraw_cap.set(U256::MAX);
        self.initialized.set(true);
        Ok(())
    }

    /// Underlying asset address.
    pub fn asset(&self) -> Address {
        self.asset.get()
    }

    /// The vault's real asset balance — donations count, exactly like a production 4626.
    pub fn total_assets(&self) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        self.vault_balance()
    }

    /// Total share supply.
    pub fn total_supply(&self) -> U256 {
        self.total_shares.get()
    }

    /// `account`'s share balance.
    pub fn balance_of(&self, account: Address) -> U256 {
        self.shares.get(account)
    }

    /// Shares a deposit of `assets` would mint right now (round down).
    pub fn convert_to_shares(&self, assets: U256) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        let total_assets = self.vault_balance()?;
        shares_for_deposit(assets, self.total_shares.get(), total_assets)
            .ok_or_else(|| b"Overflow".to_vec())
    }

    /// Assets redeeming `shares` would return right now (round down).
    pub fn convert_to_assets(&self, shares: U256) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        let total_assets = self.vault_balance()?;
        assets_for_shares(shares, self.total_shares.get(), total_assets)
            .ok_or_else(|| b"Overflow".to_vec())
    }

    /// `min(convertToAssets(balanceOf(owner)), withdrawCap)` — the cap is the Fluid-style
    /// throttle knob.
    pub fn max_withdraw(&self, owner: Address) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        let total_assets = self.vault_balance()?;
        let position = assets_for_shares(self.shares.get(owner), self.total_shares.get(), total_assets)
            .ok_or_else(|| b"Overflow".to_vec())?;
        Ok(position.min(self.withdraw_cap.get()))
    }

    /// `owner`'s full share balance (the cap only throttles asset-exact withdrawals).
    pub fn max_redeem(&self, owner: Address) -> U256 {
        self.shares.get(owner)
    }

    /// Owner-only fault-injection knob: bounds `maxWithdraw` (and the `withdraw` guard) to `cap`.
    /// Set U256::MAX to clear.
    pub fn set_withdraw_cap(&mut self, cap: U256) -> Result<(), Vec<u8>> {
        self.ensure_initialized()?;
        if self.vm().msg_sender() != self.owner.get() {
            return Err(b"OnlyOwner".to_vec());
        }
        self.withdraw_cap.set(cap);
        Ok(())
    }

    /// Pulls `assets` from the caller (pre-approved) and mints shares to `receiver`, priced
    /// against the balance BEFORE the pull. May mint zero shares after a donation has inflated
    /// the share price — that is deliberate (the adapter's ZeroShares guard is under test).
    pub fn deposit(&mut self, assets: U256, receiver: Address) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        let asset = self.asset.get();
        let caller = self.vm().msg_sender();
        let self_addr = self.vm().contract_address();

        let pre_balance = self.vault_balance()?;
        let minted = shares_for_deposit(assets, self.total_shares.get(), pre_balance)
            .ok_or_else(|| b"Overflow".to_vec())?;

        let pull_ctx = Call::new_mutating(self);
        erc20::transfer_from(self.vm(), pull_ctx, asset, caller, self_addr, assets)?;

        let new_shares = self
            .shares
            .get(receiver)
            .checked_add(minted)
            .ok_or_else(|| b"Overflow".to_vec())?;
        self.shares.setter(receiver).set(new_shares);
        let new_total = self
            .total_shares
            .get()
            .checked_add(minted)
            .ok_or_else(|| b"Overflow".to_vec())?;
        self.total_shares.set(new_total);

        Ok(minted)
    }

    /// Asset-exact withdrawal: burns the (rounded-up) share cost from `owner` and sends `assets`
    /// to `receiver`. Caller must BE `owner` — the adapter always withdraws its own position, so
    /// the ERC-4626 allowance flow is deliberately not implemented (testnet fixture).
    pub fn withdraw(
        &mut self,
        assets: U256,
        receiver: Address,
        owner: Address,
    ) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        if self.vm().msg_sender() != owner {
            return Err(b"NotShareOwner".to_vec());
        }

        let asset = self.asset.get();
        let total_assets = self.vault_balance()?;
        let total_shares = self.total_shares.get();
        let owner_shares = self.shares.get(owner);

        let position = assets_for_shares(owner_shares, total_shares, total_assets)
            .ok_or_else(|| b"Overflow".to_vec())?;
        if assets > position.min(self.withdraw_cap.get()) {
            return Err(b"ExceedsMaxWithdraw".to_vec());
        }

        let burned = shares_for_withdraw(assets, total_shares, total_assets)
            .ok_or_else(|| b"Overflow".to_vec())?;
        if burned > owner_shares {
            return Err(b"InsufficientShares".to_vec());
        }

        // Burn before the external transfer (CEI).
        self.shares
            .setter(owner)
            .set(owner_shares.checked_sub(burned).ok_or_else(|| b"Overflow".to_vec())?);
        self.total_shares
            .set(total_shares.checked_sub(burned).ok_or_else(|| b"Overflow".to_vec())?);

        let pay_ctx = Call::new_mutating(self);
        erc20::transfer(self.vm(), pay_ctx, asset, receiver, assets)?;

        Ok(burned)
    }

    /// Share-exact redemption: burns `shares` from `owner` and sends the (rounded-down) asset
    /// value to `receiver`. Same caller-is-owner simplification as `withdraw`.
    pub fn redeem(
        &mut self,
        shares: U256,
        receiver: Address,
        owner: Address,
    ) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        if self.vm().msg_sender() != owner {
            return Err(b"NotShareOwner".to_vec());
        }
        let owner_shares = self.shares.get(owner);
        if shares > owner_shares {
            return Err(b"InsufficientShares".to_vec());
        }

        let asset = self.asset.get();
        let total_assets = self.vault_balance()?;
        let total_shares = self.total_shares.get();
        let assets = assets_for_shares(shares, total_shares, total_assets)
            .ok_or_else(|| b"Overflow".to_vec())?;

        // Burn before the external transfer (CEI).
        self.shares
            .setter(owner)
            .set(owner_shares.checked_sub(shares).ok_or_else(|| b"Overflow".to_vec())?);
        self.total_shares
            .set(total_shares.checked_sub(shares).ok_or_else(|| b"Overflow".to_vec())?);

        let pay_ctx = Call::new_mutating(self);
        erc20::transfer(self.vm(), pay_ctx, asset, receiver, assets)?;

        Ok(assets)
    }

    /// Reverts unless `init` has been called.
    fn ensure_initialized(&self) -> Result<(), Vec<u8>> {
        if !self.initialized.get() {
            return Err(b"NotInitialized".to_vec());
        }
        Ok(())
    }

    /// The vault's own asset balance — single source of truth for `totalAssets`.
    fn vault_balance(&self) -> Result<U256, Vec<u8>> {
        let self_addr = self.vm().contract_address();
        erc20::balance_of(self.vm(), self.asset.get(), self_addr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_sol_types::{SolCall, SolValue};
    use stylus_sdk::testing::TestVM;

    // Local mirror of erc20.rs's binding for computing mock calldata (same idiom as
    // `vault-adapter/src/adapter.rs` tests).
    alloy_sol_types::sol! {
        function balanceOf(address account) external view returns (uint256);
    }

    fn asset_addr() -> Address {
        Address::from([0x11; 20])
    }

    fn owner_addr() -> Address {
        Address::from([0x22; 20])
    }

    fn vault_addr() -> Address {
        Address::from([0x99; 20])
    }

    fn deploy_and_init(vm: &TestVM) -> MockVault {
        vm.set_contract_address(vault_addr());
        let mut vault = MockVault::from(vm);
        vault.init(asset_addr(), owner_addr()).unwrap();
        vault
    }

    fn mock_vault_balance(vm: &TestVM, balance: U256) {
        let calldata = balanceOfCall {
            account: vault_addr(),
        }
        .abi_encode();
        vm.mock_static_call(asset_addr(), calldata, Ok(balance.abi_encode()));
    }

    // --- pure share math ---

    #[test]
    fn first_deposit_is_one_to_one() {
        assert_eq!(
            shares_for_deposit(U256::from(1_000_000u64), U256::ZERO, U256::ZERO),
            Some(U256::from(1_000_000u64))
        );
    }

    #[test]
    fn second_deposit_is_proportional_rounded_down() {
        // 1_000 shares over 3_000 assets: depositing 1_000 assets mints 333 shares (floor).
        assert_eq!(
            shares_for_deposit(U256::from(1_000u64), U256::from(1_000u64), U256::from(3_000u64)),
            Some(U256::from(333u64))
        );
    }

    #[test]
    fn donation_inflates_share_price_to_zero_shares() {
        // 1 share backing 1_000_001 assets (1-wei deposit + 1_000_000 donation): a 1_000-asset
        // deposit mints zero shares — the on-chain inflation scenario the Sepolia e2e replays.
        assert_eq!(
            shares_for_deposit(U256::from(1_000u64), U256::from(1u64), U256::from(1_000_001u64)),
            Some(U256::ZERO)
        );
    }

    #[test]
    fn withdraw_share_cost_rounds_up() {
        // 1_000 shares over 3_000 assets: withdrawing 100 assets costs ceil(100*1000/3000) = 34.
        assert_eq!(
            shares_for_withdraw(U256::from(100u64), U256::from(1_000u64), U256::from(3_000u64)),
            Some(U256::from(34u64))
        );
        // Redeeming the same value returns floor: 33 shares -> 99 assets.
        assert_eq!(
            assets_for_shares(U256::from(33u64), U256::from(1_000u64), U256::from(3_000u64)),
            Some(U256::from(99u64))
        );
    }

    // --- init / guards ---

    #[test]
    fn init_is_one_shot_and_rejects_zero_addresses() {
        let vm = TestVM::default();
        let mut vault = MockVault::from(&vm);

        assert_eq!(
            vault.init(Address::ZERO, owner_addr()).unwrap_err(),
            b"ZeroAddress".to_vec()
        );
        vault.init(asset_addr(), owner_addr()).unwrap();
        assert_eq!(vault.withdraw_cap.get(), U256::MAX);
        assert_eq!(
            vault.init(asset_addr(), owner_addr()).unwrap_err(),
            b"AlreadyInitialized".to_vec()
        );
    }

    #[test]
    fn set_withdraw_cap_is_owner_only_and_caps_max_withdraw() {
        let vm = TestVM::default();
        let mut vault = deploy_and_init(&vm);

        vm.set_sender(Address::from([0x33; 20]));
        assert_eq!(
            vault.set_withdraw_cap(U256::from(1u64)).unwrap_err(),
            b"OnlyOwner".to_vec()
        );

        vm.set_sender(owner_addr());
        vault.set_withdraw_cap(U256::from(500u64)).unwrap();

        // Give the owner a 1_000-share position over a 1_000-asset balance: uncapped position is
        // 1_000, the cap must clamp maxWithdraw to 500.
        vault.shares.setter(owner_addr()).set(U256::from(1_000u64));
        vault.total_shares.set(U256::from(1_000u64));
        mock_vault_balance(&vm, U256::from(1_000u64));
        assert_eq!(vault.max_withdraw(owner_addr()).unwrap(), U256::from(500u64));
    }

    #[test]
    fn withdraw_above_cap_reverts_before_any_transfer() {
        let vm = TestVM::default();
        let mut vault = deploy_and_init(&vm);
        vault.shares.setter(owner_addr()).set(U256::from(1_000u64));
        vault.total_shares.set(U256::from(1_000u64));

        vm.set_sender(owner_addr());
        vault.set_withdraw_cap(U256::from(500u64)).unwrap();

        // No mock for the asset's `transfer` — reaching it would fail distinguishably, proving
        // the cap guard reverts first.
        mock_vault_balance(&vm, U256::from(1_000u64));
        assert_eq!(
            vault
                .withdraw(U256::from(501u64), owner_addr(), owner_addr())
                .unwrap_err(),
            b"ExceedsMaxWithdraw".to_vec()
        );
    }

    #[test]
    fn withdraw_by_non_owner_reverts_not_share_owner() {
        let vm = TestVM::default();
        let mut vault = deploy_and_init(&vm);

        vm.set_sender(Address::from([0x33; 20]));
        assert_eq!(
            vault
                .withdraw(U256::from(1u64), owner_addr(), owner_addr())
                .unwrap_err(),
            b"NotShareOwner".to_vec()
        );
    }

    #[test]
    fn redeem_more_than_balance_reverts_insufficient_shares() {
        let vm = TestVM::default();
        let mut vault = deploy_and_init(&vm);
        vault.shares.setter(owner_addr()).set(U256::from(10u64));
        vault.total_shares.set(U256::from(10u64));

        vm.set_sender(owner_addr());
        assert_eq!(
            vault
                .redeem(U256::from(11u64), owner_addr(), owner_addr())
                .unwrap_err(),
            b"InsufficientShares".to_vec()
        );
    }
}
