//! Fonts the oracle shapes with, registered the way a host registers a baked font: shaping
//! SFNT bytes, an ink box per glyph, and an availability bit per glyph.
//!
//! The host hands over raw font files; nothing here reads a filesystem, so the same code runs
//! natively and in wasm32. Ink boxes come from the `glyf` header when the font has one. A CFF
//! font has no cheap box, so it gets a deterministic synthetic one derived from the glyph's own
//! advance and side bearing: the ink stages then compute over per-glyph-varying data, which is
//! what the oracle needs, without claiming those are the baked boxes.

use alloc::{
    collections::BTreeMap,
    rc::Rc,
    string::{String, ToString},
    vec,
    vec::Vec,
};

use read_fonts::{FontRef, TableProvider, types::GlyphId};

/// Where a font file comes from. Paths are relative to the root the host resolves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FontRoot {
    /// `benches/fixtures/fonts/` in the repository.
    Repository,
    /// The crate's own `src/engine/adversarial-fonts/`.
    Synthetic,
    /// The fetched adversarial set, outside the repository (`GLYPH_ADVERSARIAL_FONTS`).
    Adversarial,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FontSpec {
    pub key: &'static str,
    pub root: FontRoot,
    pub path: &'static str,
}

const fn repository(key: &'static str, path: &'static str) -> FontSpec {
    FontSpec {
        key,
        root: FontRoot::Repository,
        path,
    }
}

const fn synthetic(key: &'static str, path: &'static str) -> FontSpec {
    FontSpec {
        key,
        root: FontRoot::Synthetic,
        path,
    }
}

const fn adversarial(key: &'static str, path: &'static str) -> FontSpec {
    FontSpec {
        key,
        root: FontRoot::Adversarial,
        path,
    }
}

pub const FONTS: &[FontSpec] = &[
    repository("inter", "inter-v4.1/Inter-Regular.ttf"),
    repository("fredoka", "fredoka-issue-216/Fredoka-Regular.ttf"),
    repository(
        "source-serif",
        "source-serif-4.005/SourceSerif4-Regular.ttf",
    ),
    repository(
        "dancing-script",
        "dancing-script-3.000/DancingScript-Regular.otf",
    ),
    repository("amiri", "amiri-1.002/Amiri-Regular.ttf"),
    repository("devanagari", "noto-sans-devanagari/NotoSansDevanagari.ttf"),
    repository("cjk-jp", "noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf"),
    repository("dot-gothic", "dot-gothic-16/DotGothic16-Regular.ttf"),
    synthetic("synthetic-supported", "supported.sfnt"),
    synthetic("synthetic-long-ligature", "long-ligature-reject.sfnt"),
    synthetic("synthetic-value2-pair1", "value2-pair1-reject.sfnt"),
    synthetic("synthetic-value2-pair2", "value2-pair2-reject.sfnt"),
    adversarial(
        "hebrew",
        "noto-sans-hebrew/NotoSansHebrew-static-default-SYNTH.ttf",
    ),
    adversarial(
        "thai",
        "noto-sans-thai/NotoSansThai-static-default-SYNTH.ttf",
    ),
    adversarial(
        "bengali",
        "noto-sans-bengali/NotoSansBengali-static-default-SYNTH.ttf",
    ),
    adversarial("hangul", "noto-sans-kr/NotoSansKR-static-default-SYNTH.ttf"),
    adversarial("emoji", "noto-color-emoji/Noto-COLRv1.ttf"),
    adversarial(
        "nastaliq",
        "noto-nastaliq-urdu/NotoNastaliqUrdu-static-default-SYNTH.ttf",
    ),
    adversarial("fira-code", "fira-code/FiraCode-Regular.ttf"),
    adversarial(
        "fira-code-rand",
        "rand-synth-fira-code/FiraCode-Regular-rand-SYNTH.ttf",
    ),
    adversarial(
        "eb-garamond",
        "eb-garamond/EBGaramond-static-default-SYNTH.ttf",
    ),
    adversarial(
        "eb-garamond-italic",
        "eb-garamond/EBGaramond-Italic-static-default-SYNTH.ttf",
    ),
    adversarial(
        "recursive",
        "recursive/Recursive-static-wght650-CASL0.75-MONO0.5-slnt-9-CRSV1-SYNTH.ttf",
    ),
    adversarial("nabla", "nabla/Nabla-static-default-SYNTH.ttf"),
    adversarial(
        "kern-only",
        "kern-only-cherry-cream-soda/CherryCreamSoda-Regular.ttf",
    ),
    adversarial(
        "kern-only-synth",
        "kern-only-synth-syncopate/Syncopate-Regular-kernonly-SYNTH.ttf",
    ),
    adversarial("cjk-sc", "noto-sans-cjk-sc/NotoSansCJKsc-Regular.otf"),
];

pub fn font_spec(key: &str) -> Option<FontSpec> {
    FONTS.iter().copied().find(|font| font.key == key)
}

/// One font ready to register: the registration payload is derived once and shared by every
/// warm and cold engine the oracle builds.
pub struct PreparedFont {
    pub sfnt: Vec<u8>,
    pub extents: Vec<u8>,
    pub availability: Vec<u8>,
    pub glyph_count: u32,
}

impl PreparedFont {
    pub fn new(sfnt: Vec<u8>) -> Result<Self, String> {
        let font = FontRef::new(&sfnt).map_err(|error| error.to_string())?;
        let glyph_count = u32::from(font.maxp().map_err(|e| e.to_string())?.num_glyphs());
        let boxes = GlyphBoxes::new(&font)?;
        let mut extents = vec![0_u8; glyph_count as usize * 8];
        let mut availability = vec![0_u8; (glyph_count as usize).div_ceil(8)];
        // Glyph 0 stays unavailable and boxless, as a baked font reports its missing glyph.
        for glyph in 1..glyph_count {
            let Some(ink) = boxes.ink(glyph) else {
                continue;
            };
            let at = glyph as usize * 8;
            for (slot, value) in ink.into_iter().enumerate() {
                extents[at + slot * 2..at + slot * 2 + 2].copy_from_slice(&value.to_le_bytes());
            }
            availability[glyph as usize >> 3] |= 1 << (glyph & 7);
        }
        Ok(Self {
            sfnt,
            extents,
            availability,
            glyph_count,
        })
    }
}

struct GlyphBoxes<'a> {
    font: &'a FontRef<'a>,
    outlines: Option<(
        read_fonts::tables::loca::Loca<'a>,
        read_fonts::tables::glyf::Glyf<'a>,
    )>,
    cap_height: i16,
}

impl<'a> GlyphBoxes<'a> {
    fn new(font: &'a FontRef<'a>) -> Result<Self, String> {
        let outlines = match (font.loca(None), font.glyf()) {
            (Ok(loca), Ok(glyf)) => Some((loca, glyf)),
            _ => None,
        };
        let units_per_em = font.head().map_err(|e| e.to_string())?.units_per_em();
        Ok(Self {
            font,
            outlines,
            cap_height: i16::try_from(u32::from(units_per_em) * 7 / 10).unwrap_or(i16::MAX),
        })
    }

    /// `[x_min, y_min, x_max, y_max]`, or `None` for a glyph that draws nothing.
    fn ink(&self, glyph: u32) -> Option<[i16; 4]> {
        match &self.outlines {
            Some((loca, glyf)) => {
                let outline = loca.get_glyf(GlyphId::new(glyph), glyf).ok()??;
                let ink = [
                    outline.x_min(),
                    outline.y_min(),
                    outline.x_max(),
                    outline.y_max(),
                ];
                (ink[0] < ink[2] && ink[1] < ink[3]).then_some(ink)
            }
            None => self.synthetic_ink(glyph),
        }
    }

    fn synthetic_ink(&self, glyph: u32) -> Option<[i16; 4]> {
        let hmtx = self.font.hmtx().ok()?;
        let advance = i32::from(hmtx.advance(GlyphId::new(glyph))?);
        if advance == 0 {
            return None;
        }
        let bearing = i32::from(hmtx.side_bearing(GlyphId::new(glyph)).unwrap_or(0));
        let right = (advance - bearing).max(bearing + 1);
        // Vary the vertical box by glyph id so line ink is not one constant per font.
        let descent = (glyph % 7) as i32 * 30;
        let ascent = i32::from(self.cap_height) + (glyph % 5) as i32 * 40;
        Some([
            i16::try_from(bearing).ok()?,
            i16::try_from(-descent).ok()?,
            i16::try_from(right).ok()?,
            i16::try_from(ascent).ok()?,
        ])
    }
}

/// Fonts the host managed to load, by key. A case whose fonts are not all present is skipped
/// and reported, never silently passed.
#[derive(Default)]
pub struct FontLibrary {
    fonts: BTreeMap<String, Rc<PreparedFont>>,
}

impl FontLibrary {
    pub fn insert(&mut self, key: &str, sfnt: Vec<u8>) -> Result<(), String> {
        let font =
            PreparedFont::new(sfnt).map_err(|error| alloc::format!("font {key}: {error}"))?;
        self.fonts.insert(key.to_string(), Rc::new(font));
        Ok(())
    }

    pub fn get(&self, key: &str) -> Option<Rc<PreparedFont>> {
        self.fonts.get(key).cloned()
    }

    pub fn missing<'a>(&self, keys: impl IntoIterator<Item = &'a str>) -> Vec<&'a str> {
        keys.into_iter()
            .filter(|key| !self.fonts.contains_key(*key))
            .collect()
    }
}
