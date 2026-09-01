//! Shared allocation-conscious primitives for lossless raster artifacts.

#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(not(feature = "std"))]
extern crate alloc as std;

mod atlas;
mod coverage;
mod glb;
mod ktx;
mod records;

pub use atlas::{AtlasPage, RasterizedPage};
pub use coverage::{
    MAX_RASTER_COVERAGE_GLYPH_IDS, MAX_RASTER_COVERAGE_RANGES, MAX_RASTER_COVERAGE_SCALARS,
    MAX_RASTER_COVERAGE_TEXT_CODE_POINTS, RasterCoverageError, RasterCoverageV0,
    RasterUnicodeRangeV0, ResolvedRasterCoverage, canonical_raster_coverage_json,
    raster_coverage_json_value, resolve_raster_coverage,
};
pub use glb::{append_buffer_view, encode_glb};
pub use ktx::{KtxFormat, encode_ktx2};
pub use records::{ABSENT_PAGE, GLYPH_RECORD_STRIDE, GlyphRecordTable};

use core::fmt;
use serde::{Deserialize, Serialize};
use std::string::String;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactPackaging {
    Embedded,
    External,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PagePackaging {
    Embedded,
    External,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RasterArtifactError {
    Allocation,
    ArithmeticOverflow,
    InvalidTexture,
    Serialization,
}

impl fmt::Display for RasterArtifactError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Allocation => "raster artifact allocation failed",
            Self::ArithmeticOverflow => "raster artifact size exceeds the supported range",
            Self::InvalidTexture => "texture dimensions do not match the texel payload",
            Self::Serialization => "raster artifact serialization failed",
        })
    }
}

pub const ARTIFACT_FINGERPRINT_V0: u32 = 0x6172_7430;
pub const CACHE_FINGERPRINT_V0: u32 = 0x6361_6330;
pub const DESCRIPTOR_FINGERPRINT_V0: u32 = 0x6473_6330;
pub const SHAPING_FINGERPRINT_V0: u32 = 0x7368_7030;
pub const SOURCE_FINGERPRINT_V0: u32 = 0x736f_7572;

/// MurmurHash3 x86 128 serialized as four little-endian u32 lanes.
pub fn fingerprint128(bytes: &[u8], seed: u32) -> String {
    use core::fmt::Write;

    let lanes = murmur3_x86_128(bytes, seed);
    let mut output = String::with_capacity(32);
    for byte in lanes.into_iter().flat_map(u32::to_le_bytes) {
        let _ = write!(output, "{byte:02x}");
    }
    output
}

fn murmur3_x86_128(bytes: &[u8], seed: u32) -> [u32; 4] {
    let [mut h1, mut h2, mut h3, mut h4] = [seed; 4];
    let mut chunks = bytes.chunks_exact(16);
    for block in &mut chunks {
        let mut k1 = read_u32(block, 0);
        let mut k2 = read_u32(block, 4);
        let mut k3 = read_u32(block, 8);
        let mut k4 = read_u32(block, 12);
        k1 = k1
            .wrapping_mul(0x239b_961b)
            .rotate_left(15)
            .wrapping_mul(0xab0e_9789);
        h1 ^= k1;
        h1 = h1
            .rotate_left(19)
            .wrapping_add(h2)
            .wrapping_mul(5)
            .wrapping_add(0x561c_cd1b);
        k2 = k2
            .wrapping_mul(0xab0e_9789)
            .rotate_left(16)
            .wrapping_mul(0x38b3_4ae5);
        h2 ^= k2;
        h2 = h2
            .rotate_left(17)
            .wrapping_add(h3)
            .wrapping_mul(5)
            .wrapping_add(0x0bca_a747);
        k3 = k3
            .wrapping_mul(0x38b3_4ae5)
            .rotate_left(17)
            .wrapping_mul(0xa1e3_8b93);
        h3 ^= k3;
        h3 = h3
            .rotate_left(15)
            .wrapping_add(h4)
            .wrapping_mul(5)
            .wrapping_add(0x96cd_1c35);
        k4 = k4
            .wrapping_mul(0xa1e3_8b93)
            .rotate_left(18)
            .wrapping_mul(0x239b_961b);
        h4 ^= k4;
        h4 = h4
            .rotate_left(13)
            .wrapping_add(h1)
            .wrapping_mul(5)
            .wrapping_add(0x32ac_3b17);
    }

    let tail = chunks.remainder();
    let mut k1 = 0_u32;
    let mut k2 = 0_u32;
    let mut k3 = 0_u32;
    let mut k4 = 0_u32;
    if tail.len() >= 15 {
        k4 ^= u32::from(tail[14]) << 16;
    }
    if tail.len() >= 14 {
        k4 ^= u32::from(tail[13]) << 8;
    }
    if tail.len() >= 13 {
        k4 ^= u32::from(tail[12]);
        h4 ^= k4
            .wrapping_mul(0xa1e3_8b93)
            .rotate_left(18)
            .wrapping_mul(0x239b_961b);
    }
    if tail.len() >= 12 {
        k3 ^= u32::from(tail[11]) << 24;
    }
    if tail.len() >= 11 {
        k3 ^= u32::from(tail[10]) << 16;
    }
    if tail.len() >= 10 {
        k3 ^= u32::from(tail[9]) << 8;
    }
    if tail.len() >= 9 {
        k3 ^= u32::from(tail[8]);
        h3 ^= k3
            .wrapping_mul(0x38b3_4ae5)
            .rotate_left(17)
            .wrapping_mul(0xa1e3_8b93);
    }
    if tail.len() >= 8 {
        k2 ^= u32::from(tail[7]) << 24;
    }
    if tail.len() >= 7 {
        k2 ^= u32::from(tail[6]) << 16;
    }
    if tail.len() >= 6 {
        k2 ^= u32::from(tail[5]) << 8;
    }
    if tail.len() >= 5 {
        k2 ^= u32::from(tail[4]);
        h2 ^= k2
            .wrapping_mul(0xab0e_9789)
            .rotate_left(16)
            .wrapping_mul(0x38b3_4ae5);
    }
    if tail.len() >= 4 {
        k1 ^= u32::from(tail[3]) << 24;
    }
    if tail.len() >= 3 {
        k1 ^= u32::from(tail[2]) << 16;
    }
    if tail.len() >= 2 {
        k1 ^= u32::from(tail[1]) << 8;
    }
    if !tail.is_empty() {
        k1 ^= u32::from(tail[0]);
        h1 ^= k1
            .wrapping_mul(0x239b_961b)
            .rotate_left(15)
            .wrapping_mul(0xab0e_9789);
    }

    let length = bytes.len() as u32;
    h1 ^= length;
    h2 ^= length;
    h3 ^= length;
    h4 ^= length;
    h1 = h1.wrapping_add(h2).wrapping_add(h3).wrapping_add(h4);
    h2 = h2.wrapping_add(h1);
    h3 = h3.wrapping_add(h1);
    h4 = h4.wrapping_add(h1);
    h1 = finalize(h1);
    h2 = finalize(h2);
    h3 = finalize(h3);
    h4 = finalize(h4);
    h1 = h1.wrapping_add(h2).wrapping_add(h3).wrapping_add(h4);
    h2 = h2.wrapping_add(h1);
    h3 = h3.wrapping_add(h1);
    h4 = h4.wrapping_add(h1);
    [h1, h2, h3, h4]
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn finalize(mut value: u32) -> u32 {
    value ^= value >> 16;
    value = value.wrapping_mul(0x85eb_ca6b);
    value ^= value >> 13;
    value = value.wrapping_mul(0xc2b2_ae35);
    value ^ (value >> 16)
}

pub(crate) fn zeroed_bytes(byte_length: usize) -> Result<std::vec::Vec<u8>, RasterArtifactError> {
    let mut bytes = std::vec::Vec::new();
    bytes
        .try_reserve_exact(byte_length)
        .map_err(|_| RasterArtifactError::Allocation)?;
    bytes.resize(byte_length, 0);
    Ok(bytes)
}

#[cfg(test)]
mod fingerprint_tests {
    use super::*;

    /// Reference vectors produced by mmh3, a MurmurHash3 implementation outside this
    /// repository.
    ///
    /// This hash is implemented twice: here, and in TypeScript at
    /// `packages/glyph/src/internal/fingerprint.ts`. Rust stamps external page filenames at
    /// bake time and TypeScript recomputes them at load time, so a single divergent bit makes
    /// every external page 404. Holding both ports against an outside implementation catches a
    /// bug the two share, which comparing them only to each other cannot.
    const REFERENCE_VECTORS: &str = include_str!("../evidence/fingerprint-vectors-v0.json");

    #[test]
    fn fingerprint_vectors_are_stable() {
        assert_eq!(fingerprint128(b"", 0), "00000000000000000000000000000000");
        assert_eq!(
            fingerprint128(b"foo", 0),
            "251b7c576525b6606525b6606525b660"
        );
    }

    /// The corpus is only evidence about this crate while its seeds are this crate's seeds.
    #[test]
    fn domain_seeds_match_the_reference_corpus() {
        let document: serde_json::Value =
            serde_json::from_str(REFERENCE_VECTORS).expect("corpus parses");
        for (name, constant) in [
            ("artifact", ARTIFACT_FINGERPRINT_V0),
            ("cache", CACHE_FINGERPRINT_V0),
            ("descriptor", DESCRIPTOR_FINGERPRINT_V0),
            ("shaping", SHAPING_FINGERPRINT_V0),
            ("source", SOURCE_FINGERPRINT_V0),
        ] {
            assert_eq!(
                document["seeds"][name].as_u64(),
                Some(u64::from(constant)),
                "{name} seed drifted from the corpus"
            );
        }
    }

    #[test]
    fn fingerprint_matches_independent_reference_vectors() {
        let document: serde_json::Value =
            serde_json::from_str(REFERENCE_VECTORS).expect("corpus parses");
        let seeds = document["seeds"].as_object().expect("corpus seeds");
        let cases = document["cases"].as_array().expect("corpus cases");

        let mut lengths = std::collections::BTreeSet::new();
        let mut checked = 0usize;
        for case in cases {
            let input = decode_hex(case["input"].as_str().expect("case payload"));
            let length = usize::try_from(case["length"].as_u64().expect("case length"))
                .expect("length fits");
            assert_eq!(
                input.len(),
                length,
                "case length disagrees with its payload"
            );
            lengths.insert(length);
            for (name, expected) in case["fingerprints"].as_object().expect("case fingerprints") {
                let seed =
                    u32::try_from(seeds[name].as_u64().expect("corpus seed")).expect("seed fits");
                assert_eq!(
                    fingerprint128(&input, seed).as_str(),
                    expected.as_str().expect("expected fingerprint"),
                    "length {length} seed {name}"
                );
                checked += 1;
            }
        }

        // Lengths 0..=32 walk every arm of the 15-branch tail switch and both block
        // boundaries. Without this the corpus can pass while one arm is wrong.
        for length in 0..=32usize {
            assert!(
                lengths.contains(&length),
                "corpus is missing length {length}"
            );
        }
        assert!(
            lengths.iter().any(|length| *length > 32),
            "corpus must cover multi-block accumulation"
        );
        assert_eq!(checked, cases.len() * seeds.len(), "corpus is ragged");
    }

    fn decode_hex(value: &str) -> Vec<u8> {
        assert!(value.len().is_multiple_of(2), "hex payload must be even");
        (0..value.len())
            .step_by(2)
            .map(|index| {
                u8::from_str_radix(&value[index..index + 2], 16).expect("hex payload byte")
            })
            .collect()
    }
}
