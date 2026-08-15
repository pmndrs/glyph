#![no_main]

use libfuzzer_sys::fuzz_target;
use pmndrs_glyph_mtsdf_admission::exercise_outline_bytes;

fuzz_target!(|input: &[u8]| exercise_outline_bytes(input));
