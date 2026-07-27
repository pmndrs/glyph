extern crate alloc;

#[path = "src/abi_contract.rs"]
mod abi_contract;

fn main() {
    println!("cargo:rerun-if-changed=src/abi_contract.rs");
    println!(
        "cargo:rustc-env=PMNDRS_TEXT_MTSDF_ABI={}",
        abi_contract::json()
    );
}
