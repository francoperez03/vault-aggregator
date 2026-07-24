use alloc::vec::Vec;

use alloy_primitives::Address;
use stylus_sdk::prelude::*;

use crate::VaultPeriphery;

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
}
