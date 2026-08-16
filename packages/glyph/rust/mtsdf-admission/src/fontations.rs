use std::{hint::black_box, time::Instant};

use pmndrs_glyph_mtsdf_core::MtsdfGenerator;
pub use pmndrs_glyph_mtsdf_fontations::{FontationsOutlineSource, font_outline_source, glyph_count};
use skrifa::{FontRef, GlyphId};

use crate::{REGION, fnv1a};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FontPassEvidence {
    pub elapsed_nanoseconds: u128,
    pub generated_glyphs: u32,
    pub skipped_glyphs: u32,
    pub rejected_glyphs: u32,
    pub checksum: u32,
}

pub fn measure_font_pass(
    font: FontRef<'_>,
    glyph_count: u16,
    generator: &mut MtsdfGenerator,
) -> FontPassEvidence {
    let start = Instant::now();
    let mut generated_glyphs = 0_u32;
    let mut skipped_glyphs = 0_u32;
    let mut rejected_glyphs = 0_u32;
    let mut checksum = 2_166_136_261_u32;
    for raw_glyph_id in 0..glyph_count {
        let glyph_id = GlyphId::new(u32::from(raw_glyph_id));
        let Some(source) = font_outline_source(&font, glyph_id) else {
            skipped_glyphs += 1;
            continue;
        };
        let Ok(mut outline) = generator.read_outline(&source) else {
            rejected_glyphs += 1;
            continue;
        };
        let Ok(bytes) = outline.generate_mtsdf(REGION) else {
            rejected_glyphs += 1;
            continue;
        };
        checksum ^= fnv1a(bytes);
        checksum = checksum.wrapping_mul(16_777_619);
        generated_glyphs += 1;
    }
    black_box(checksum);
    FontPassEvidence {
        elapsed_nanoseconds: start.elapsed().as_nanos(),
        generated_glyphs,
        skipped_glyphs,
        rejected_glyphs,
        checksum,
    }
}
