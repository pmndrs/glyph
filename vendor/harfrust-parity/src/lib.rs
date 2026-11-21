//! Differential harness for the in-tree HarfRust fork (`vendor/harfrust`).
//!
//! `upstream` is the crates.io release the fork was cut from and `fork` is the vendored
//! source. Both expose the same API, so one macro instantiates the same shaping routine
//! against each and the tests compare the glyph streams field by field.

use std::fmt;

/// One shaping request, expressed in the vocabulary both crates parse from strings.
#[derive(Clone, Debug)]
pub struct Request {
    pub text: String,
    /// `None` lets HarfRust guess direction, script and language from the text.
    pub segment: Option<Segment>,
    pub features: Vec<String>,
    pub buffer_flags: u32,
    /// Shape through a precompiled `ShapePlan`, as the pmndrs/glyph shaper does.
    pub precompiled_plan: bool,
}

#[derive(Clone, Debug)]
pub struct Segment {
    pub direction: String,
    pub script: String,
    pub language: Option<String>,
}

/// Every observable field of one shaped glyph.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Glyph {
    pub glyph_id: u32,
    pub cluster: u32,
    pub flags: u32,
    pub x_advance: i32,
    pub y_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
}

impl fmt::Debug for Glyph {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}@{} f{} adv({},{}) off({},{})",
            self.glyph_id,
            self.cluster,
            self.flags,
            self.x_advance,
            self.y_advance,
            self.x_offset,
            self.y_offset
        )
    }
}

macro_rules! engine {
    ($module:ident, $harfrust:ident) => {
        pub mod $module {
            use super::{Glyph, Request};
            use core::str::FromStr;
            use $harfrust::{
                BufferFlags, Direction, Feature, FontRef, Language, Script, ShapeOptions,
                ShapePlan, ShaperData, UnicodeBuffer,
            };

            /// Per-font shaping caches, built once like a registered font in the product.
            pub struct Font<'a> {
                font: FontRef<'a>,
                data: ShaperData,
            }

            impl<'a> Font<'a> {
                pub fn new(bytes: &'a [u8]) -> Self {
                    let font = FontRef::new(bytes).expect("fixture is a readable font");
                    let data = ShaperData::new(&font);
                    Self { font, data }
                }

                pub fn shape(&self, request: &Request) -> Vec<Glyph> {
                    let shaper = self.data.shaper(&self.font).build();
                    let features: Vec<Feature> = request
                        .features
                        .iter()
                        .map(|feature| Feature::from_str(feature).expect("valid feature"))
                        .collect();
                    let buffer = buffer_for(request);
                    let language = buffer.language();
                    let plan = request.precompiled_plan.then(|| {
                        ShapePlan::new(
                            &shaper,
                            buffer.direction(),
                            Some(buffer.script()),
                            language.as_ref(),
                            &features,
                        )
                    });
                    let shaped = shaper.shape(
                        buffer,
                        ShapeOptions::new().features(&features).plan(plan.as_ref()),
                    );
                    shaped
                        .glyph_infos()
                        .iter()
                        .zip(shaped.glyph_positions())
                        .map(|(info, position)| Glyph {
                            glyph_id: info.glyph_id,
                            cluster: info.cluster,
                            flags: info.flags().to_bits(),
                            x_advance: position.x_advance,
                            y_advance: position.y_advance,
                            x_offset: position.x_offset,
                            y_offset: position.y_offset,
                        })
                        .collect()
                }
            }

            /// The request's text with UTF-16 clusters and its segment properties applied.
            fn buffer_for(request: &Request) -> UnicodeBuffer {
                let mut buffer = UnicodeBuffer::new();
                let mut utf16_offset = 0_u32;
                for character in request.text.chars() {
                    buffer.add(character, utf16_offset);
                    utf16_offset += character.len_utf16() as u32;
                }
                match &request.segment {
                    Some(segment) => {
                        buffer.set_direction(
                            Direction::from_str(&segment.direction).expect("valid direction"),
                        );
                        buffer.set_script(Script::from_str(&segment.script).expect("valid script"));
                        if let Some(language) = &segment.language {
                            buffer.set_language(
                                Language::from_str(language).expect("valid language"),
                            );
                        }
                    }
                    None => buffer.guess_segment_properties(),
                }
                buffer.set_flags(
                    BufferFlags::from_bits(request.buffer_flags).expect("valid buffer flags"),
                );
                buffer
            }
        }
    };
}

engine!(upstream_engine, upstream);
engine!(fork_engine, fork);

/// Whether the fork under test was built with its upstream-default `aat` and `rand` features.
pub const FORK_HAS_AAT_AND_RAND: bool = cfg!(feature = "fork-default-features");
