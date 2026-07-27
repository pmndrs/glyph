#![cfg_attr(not(any(feature = "std", test)), no_std)]

extern crate alloc;

#[cfg(feature = "std")]
mod abi_contract;

#[cfg(all(target_arch = "wasm32", not(feature = "std")))]
mod wasm;

#[cfg(feature = "std")]
pub fn mtsdf_abi_json() -> alloc::string::String {
    abi_contract::json()
}
