extern crate alloc;

use std::env;

#[path = "src/abi_contract.rs"]
mod abi_contract;

fn main() {
    println!("cargo:rerun-if-changed=src/abi_contract.rs");
    println!(
        "cargo:rustc-env=PMNDRS_TEXT_MTSDF_ABI={}",
        abi_contract::json(env::var_os("CARGO_FEATURE_ARTIFACT_BAKER").is_some())
    );
}
