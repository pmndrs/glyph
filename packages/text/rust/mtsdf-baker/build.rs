fn main() {
    println!("cargo:rerun-if-changed=src/abi_contract.rs");
    println!("cargo:rerun-if-changed=src/abi_layout.rs");
}
