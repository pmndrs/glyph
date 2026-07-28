use std::{env, fs, path::PathBuf};

use ktx2::{
    Format,
    dfd::{Basic, Block},
};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let output_directory = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set"));
    write_dfd(&output_directory, Format::R8_UNORM, 1, "r8-dfd.bin");
    write_dfd(
        &output_directory,
        Format::R8G8B8A8_UNORM,
        1,
        "rgba8-dfd.bin",
    );
    write_dfd(
        &output_directory,
        Format::R16G16B16A16_SFLOAT,
        2,
        "rgba16f-dfd.bin",
    );
}

fn write_dfd(
    output_directory: &std::path::Path,
    format: Format,
    expected_type_size: u32,
    name: &str,
) {
    let (basic, type_size) =
        Basic::from_format(format).expect("canonical KTX2 format is supported");
    assert_eq!(type_size, expected_type_size);
    fs::write(output_directory.join(name), Block::Basic(basic).to_vec())
        .expect("write canonical KTX2 DFD");
}
