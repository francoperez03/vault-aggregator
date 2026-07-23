//! `MockUsdc`'s single public-methods impl block (one `#[public]` impl per contract type, M1
//! carryover). Transfer/approve semantics copied from coinflip's hand-rolled `cfp-token`
//! (debit-before-credit so self-transfers net to zero); `mint` is deliberately open — this is a
//! testnet fixture, unlimited supply is the feature.

use alloc::string::String;
use alloc::vec::Vec;

use alloy_primitives::{Address, U256, U8};
use alloy_sol_types::sol;
use stylus_sdk::prelude::*;

use crate::MockUsdc;

sol! {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

#[public]
impl MockUsdc {
    /// Token name. Fixed — a mock needs no configurability.
    pub fn name(&self) -> String {
        String::from("Mock USDC")
    }

    /// Token symbol.
    pub fn symbol(&self) -> String {
        String::from("mUSDC")
    }

    /// 6, matching native USDC — the whole point of the mock is exercising the same unit math.
    pub fn decimals(&self) -> U8 {
        U8::from(6)
    }

    /// Total minted supply.
    pub fn total_supply(&self) -> U256 {
        self.total_supply.get()
    }

    /// `account`'s current balance.
    pub fn balance_of(&self, account: Address) -> U256 {
        self.balances.get(account)
    }

    /// Remaining amount `spender` may `transfer_from` out of `owner`'s balance.
    pub fn allowance(&self, owner: Address, spender: Address) -> U256 {
        self.allowances.get(owner).get(spender)
    }

    /// Mints `value` to `account`. **Unauthenticated by design** — anyone can mint on testnet,
    /// which is what lets e2e tests create arbitrarily large positions and force edge states.
    pub fn mint(&mut self, account: Address, value: U256) -> Result<(), Vec<u8>> {
        let new_balance = self
            .balances
            .get(account)
            .checked_add(value)
            .ok_or_else(|| b"Overflow".to_vec())?;
        let new_supply = self
            .total_supply
            .get()
            .checked_add(value)
            .ok_or_else(|| b"Overflow".to_vec())?;

        self.balances.setter(account).set(new_balance);
        self.total_supply.set(new_supply);

        self.vm().log(Transfer {
            from: Address::ZERO,
            to: account,
            value,
        });
        Ok(())
    }

    /// Moves `value` from the caller's own balance to `to`. Debits before crediting so a
    /// self-transfer nets to zero instead of inflating the balance.
    pub fn transfer(&mut self, to: Address, value: U256) -> Result<bool, Vec<u8>> {
        let sender = self.vm().msg_sender();
        self.move_balance(sender, to, value)?;
        Ok(true)
    }

    /// Sets `spender`'s allowance over the caller's balance to exactly `value` (overwrites).
    pub fn approve(&mut self, spender: Address, value: U256) -> Result<bool, Vec<u8>> {
        let sender = self.vm().msg_sender();
        self.allowances.setter(sender).setter(spender).set(value);
        self.vm().log(Approval {
            owner: sender,
            spender,
            value,
        });
        Ok(true)
    }

    /// Spends `value` from `from`'s balance on behalf of the caller, decrementing the caller's
    /// allowance before the balance move.
    pub fn transfer_from(
        &mut self,
        from: Address,
        to: Address,
        value: U256,
    ) -> Result<bool, Vec<u8>> {
        let sender = self.vm().msg_sender();
        let current_allowance = self.allowances.get(from).get(sender);
        if current_allowance < value {
            return Err(b"InsufficientAllowance".to_vec());
        }
        let new_allowance = current_allowance
            .checked_sub(value)
            .ok_or_else(|| b"Overflow".to_vec())?;
        self.allowances
            .setter(from)
            .setter(sender)
            .set(new_allowance);
        self.move_balance(from, to, value)?;
        Ok(true)
    }

    /// Shared balance move: insufficient-balance guard, debit-before-credit, Transfer event.
    fn move_balance(&mut self, from: Address, to: Address, value: U256) -> Result<(), Vec<u8>> {
        let from_balance = self.balances.get(from);
        if from_balance < value {
            return Err(b"InsufficientBalance".to_vec());
        }
        let new_from_balance = from_balance
            .checked_sub(value)
            .ok_or_else(|| b"Overflow".to_vec())?;
        // Debit before reading the recipient balance so a self-transfer nets to zero.
        self.balances.setter(from).set(new_from_balance);
        let new_to_balance = self
            .balances
            .get(to)
            .checked_add(value)
            .ok_or_else(|| b"Overflow".to_vec())?;
        self.balances.setter(to).set(new_to_balance);

        self.vm().log(Transfer { from, to, value });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stylus_sdk::testing::TestVM;

    fn alice() -> Address {
        Address::from([0x11; 20])
    }

    fn bob() -> Address {
        Address::from([0x22; 20])
    }

    fn deploy(vm: &TestVM) -> MockUsdc {
        MockUsdc::from(vm)
    }

    #[test]
    fn mint_is_open_and_credits_balance_and_supply() {
        let vm = TestVM::default();
        let mut token = deploy(&vm);

        // Any sender may mint — no auth guard to trip.
        vm.set_sender(bob());
        token.mint(alice(), U256::from(5_000_000u64)).unwrap();

        assert_eq!(token.balance_of(alice()), U256::from(5_000_000u64));
        assert_eq!(token.total_supply(), U256::from(5_000_000u64));
    }

    #[test]
    fn transfer_moves_balance_and_self_transfer_nets_zero() {
        let vm = TestVM::default();
        let mut token = deploy(&vm);
        token.mint(alice(), U256::from(1_000_000u64)).unwrap();

        vm.set_sender(alice());
        token.transfer(bob(), U256::from(400_000u64)).unwrap();
        assert_eq!(token.balance_of(alice()), U256::from(600_000u64));
        assert_eq!(token.balance_of(bob()), U256::from(400_000u64));

        token.transfer(alice(), U256::from(600_000u64)).unwrap();
        assert_eq!(token.balance_of(alice()), U256::from(600_000u64));
    }

    #[test]
    fn transfer_from_requires_and_decrements_allowance() {
        let vm = TestVM::default();
        let mut token = deploy(&vm);
        token.mint(alice(), U256::from(1_000_000u64)).unwrap();

        // No allowance yet.
        vm.set_sender(bob());
        let err = token.transfer_from(alice(), bob(), U256::from(1u64));
        assert_eq!(err.unwrap_err(), b"InsufficientAllowance".to_vec());

        vm.set_sender(alice());
        token.approve(bob(), U256::from(500_000u64)).unwrap();

        vm.set_sender(bob());
        token
            .transfer_from(alice(), bob(), U256::from(300_000u64))
            .unwrap();
        assert_eq!(token.allowance(alice(), bob()), U256::from(200_000u64));
        assert_eq!(token.balance_of(bob()), U256::from(300_000u64));
    }

    #[test]
    fn transfer_insufficient_balance_reverts() {
        let vm = TestVM::default();
        let mut token = deploy(&vm);
        token.mint(alice(), U256::from(100u64)).unwrap();

        vm.set_sender(alice());
        let err = token.transfer(bob(), U256::from(101u64));
        assert_eq!(err.unwrap_err(), b"InsufficientBalance".to_vec());
    }
}
