#![no_main]

use libfuzzer_sys::fuzz_target;
use pmndrs_glyph_font_baker::{BakeDescriptorV0, bake_font};

fuzz_target!(|input: &[u8]| {
    if input.starts_with(b"\0\x01\0\0") || input.starts_with(b"OTTO") || input.starts_with(b"ttcf")
    {
        let _ = bake_font(input, BakeDescriptorV0::new(0));
        return;
    }
    if input.len() < 5 {
        return;
    }
    let descriptor = BakeDescriptorV0 {
        format_version: input[0],
        font_face_index: u32::from_le_bytes([input[1], input[2], input[3], input[4]]),
    };
    let _ = bake_font(&input[5..], descriptor);
});
