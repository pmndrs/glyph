use core::convert::Infallible;
#[cfg(not(target_arch = "wasm32"))]
use core::fmt::Write;

#[cfg(test)]
use pmndrs_text_mtsdf_core::ReadOutlineError;
use pmndrs_text_mtsdf_core::{AtlasRegion, Bounds, MtsdfGenerator, OutlineSink, OutlineSource};

#[cfg(feature = "full-font-evidence")]
mod fontations;

#[cfg(feature = "full-font-evidence")]
pub use fontations::{FontPassEvidence, glyph_count, measure_font_pass};

#[cfg(feature = "fuzzing")]
mod fuzzing;

#[cfg(feature = "fuzzing")]
pub use fuzzing::exercise_outline_bytes;

pub const UNITS_PER_EM: f32 = 1_000.0;
pub const REGION: AtlasRegion = AtlasRegion {
    inner_width: 32,
    inner_height: 32,
    padding_x: 4,
    padding_y: 4,
};

#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone, Copy)]
enum OutlineCommand {
    Move(f32, f32),
    Line(f32, f32),
    Quad(f32, f32, f32, f32),
    Cubic(f32, f32, f32, f32, f32, f32),
    Close,
}

/// One package-owned shape used to compare the candidate with the native quality oracle.
#[cfg(not(target_arch = "wasm32"))]
pub struct OracleCase {
    pub id: &'static str,
    bounds: [f32; 4],
    commands: &'static [OutlineCommand],
}

#[cfg(not(target_arch = "wasm32"))]
const SQUARE: &[OutlineCommand] = &[
    OutlineCommand::Move(100.0, 100.0),
    OutlineCommand::Line(100.0, 900.0),
    OutlineCommand::Line(900.0, 900.0),
    OutlineCommand::Line(900.0, 100.0),
    OutlineCommand::Close,
];
#[cfg(not(target_arch = "wasm32"))]
const ACUTE: &[OutlineCommand] = &[
    OutlineCommand::Move(100.0, 100.0),
    OutlineCommand::Line(500.0, 950.0),
    OutlineCommand::Line(565.0, 100.0),
    OutlineCommand::Close,
];
#[cfg(not(target_arch = "wasm32"))]
const OVERLAP: &[OutlineCommand] = &[
    OutlineCommand::Move(100.0, 200.0),
    OutlineCommand::Line(100.0, 800.0),
    OutlineCommand::Line(600.0, 800.0),
    OutlineCommand::Line(600.0, 200.0),
    OutlineCommand::Close,
    OutlineCommand::Move(400.0, 100.0),
    OutlineCommand::Line(400.0, 700.0),
    OutlineCommand::Line(900.0, 700.0),
    OutlineCommand::Line(900.0, 100.0),
    OutlineCommand::Close,
];
#[cfg(not(target_arch = "wasm32"))]
const SELF_INTERSECTION: &[OutlineCommand] = &[
    OutlineCommand::Move(100.0, 100.0),
    OutlineCommand::Line(900.0, 900.0),
    OutlineCommand::Line(100.0, 900.0),
    OutlineCommand::Line(900.0, 100.0),
    OutlineCommand::Close,
];
#[cfg(not(target_arch = "wasm32"))]
const QUADRATIC: &[OutlineCommand] = &[
    OutlineCommand::Move(100.0, 500.0),
    OutlineCommand::Quad(100.0, 900.0, 500.0, 900.0),
    OutlineCommand::Quad(900.0, 900.0, 900.0, 500.0),
    OutlineCommand::Quad(900.0, 100.0, 500.0, 100.0),
    OutlineCommand::Quad(100.0, 100.0, 100.0, 500.0),
    OutlineCommand::Close,
];
#[cfg(not(target_arch = "wasm32"))]
const CUBIC: &[OutlineCommand] = &[
    OutlineCommand::Move(500.0, 950.0),
    OutlineCommand::Cubic(920.0, 740.0, 900.0, 210.0, 500.0, 100.0),
    OutlineCommand::Cubic(100.0, 210.0, 80.0, 740.0, 500.0, 950.0),
    OutlineCommand::Close,
];
#[cfg(not(target_arch = "wasm32"))]
const COMPLEX: &[OutlineCommand] = &[
    OutlineCommand::Move(80.0, 100.0),
    OutlineCommand::Line(380.0, 920.0),
    OutlineCommand::Line(620.0, 920.0),
    OutlineCommand::Line(920.0, 100.0),
    OutlineCommand::Line(720.0, 100.0),
    OutlineCommand::Line(650.0, 310.0),
    OutlineCommand::Line(350.0, 310.0),
    OutlineCommand::Line(280.0, 100.0),
    OutlineCommand::Close,
    OutlineCommand::Move(410.0, 480.0),
    OutlineCommand::Line(590.0, 480.0),
    OutlineCommand::Line(500.0, 760.0),
    OutlineCommand::Close,
];

#[cfg(not(target_arch = "wasm32"))]
static ORACLE_CASES: &[OracleCase] = &[
    OracleCase {
        id: "ordinary-square",
        bounds: [100.0, 100.0, 900.0, 900.0],
        commands: SQUARE,
    },
    OracleCase {
        id: "acute-corner",
        bounds: [100.0, 100.0, 565.0, 950.0],
        commands: ACUTE,
    },
    OracleCase {
        id: "overlapping-contours",
        bounds: [100.0, 100.0, 900.0, 800.0],
        commands: OVERLAP,
    },
    OracleCase {
        id: "self-intersection",
        bounds: [100.0, 100.0, 900.0, 900.0],
        commands: SELF_INTERSECTION,
    },
    OracleCase {
        id: "quadratic-oval",
        bounds: [100.0, 100.0, 900.0, 900.0],
        commands: QUADRATIC,
    },
    OracleCase {
        id: "cubic-teardrop",
        bounds: [80.0, 100.0, 920.0, 950.0],
        commands: CUBIC,
    },
    OracleCase {
        id: "complex-counter",
        bounds: [80.0, 100.0, 920.0, 920.0],
        commands: COMPLEX,
    },
];

#[cfg(not(target_arch = "wasm32"))]
pub fn oracle_cases() -> &'static [OracleCase] {
    ORACLE_CASES
}

#[cfg(not(target_arch = "wasm32"))]
impl OracleCase {
    pub fn shape_description(&self) -> String {
        let mut output = String::new();
        for command in self.commands {
            match *command {
                OutlineCommand::Move(x, y) => {
                    let _ = write!(output, "{{ {x:.0}, {y:.0};");
                }
                OutlineCommand::Line(x, y) => {
                    let _ = write!(output, " {x:.0}, {y:.0};");
                }
                OutlineCommand::Quad(cx, cy, x, y) => {
                    let _ = write!(output, " ({cx:.0}, {cy:.0}); {x:.0}, {y:.0};");
                }
                OutlineCommand::Cubic(cx0, cy0, cx1, cy1, x, y) => {
                    let _ = write!(
                        output,
                        " ({cx0:.0}, {cy0:.0}; {cx1:.0}, {cy1:.0}); {x:.0}, {y:.0};"
                    );
                }
                OutlineCommand::Close => output.push_str(" # } "),
            }
        }
        output
    }

    pub fn native_scale(&self) -> (f32, f32) {
        (
            REGION.inner_width as f32 / (self.bounds[2] - self.bounds[0]),
            REGION.inner_height as f32 / (self.bounds[3] - self.bounds[1]),
        )
    }

    pub fn native_translate(&self) -> (f32, f32) {
        let (scale_x, scale_y) = self.native_scale();
        (
            -self.bounds[0] + REGION.padding_x as f32 / scale_x,
            -self.bounds[1] + REGION.padding_y as f32 / scale_y,
        )
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl OutlineSource for OracleCase {
    type Error = Infallible;

    fn units_per_em(&self) -> f32 {
        UNITS_PER_EM
    }

    fn bounds(&self) -> Bounds {
        Bounds::new(
            self.bounds[0],
            self.bounds[1],
            self.bounds[2],
            self.bounds[3],
        )
    }

    fn emit(&self, collector: &mut OutlineSink<'_>) -> Result<(), Self::Error> {
        for command in self.commands {
            match *command {
                OutlineCommand::Move(x, y) => collector.move_to(x, y),
                OutlineCommand::Line(x, y) => collector.line_to(x, y),
                OutlineCommand::Quad(cx, cy, x, y) => collector.quad_to(cx, cy, x, y),
                OutlineCommand::Cubic(cx0, cy0, cx1, cy1, x, y) => {
                    collector.cubic_to(cx0, cy0, cx1, cy1, x, y);
                }
                OutlineCommand::Close => collector.close(),
            }
        }
        Ok(())
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn generate_case(case: &OracleCase) -> Option<Vec<u8>> {
    let mut generator = MtsdfGenerator::default();
    let Ok(mut outline) = generator.read_outline(case) else {
        return None;
    };
    Some(outline.generate_mtsdf(REGION).ok()?.to_vec())
}

fn fnv1a(bytes: &[u8]) -> u32 {
    bytes.iter().fold(2_166_136_261_u32, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(16_777_619)
    })
}

struct AdmissionSquare;

impl OutlineSource for AdmissionSquare {
    type Error = Infallible;

    fn units_per_em(&self) -> f32 {
        UNITS_PER_EM
    }

    fn bounds(&self) -> Bounds {
        Bounds::new(100.0, 100.0, 900.0, 900.0)
    }

    fn emit(&self, collector: &mut OutlineSink<'_>) -> Result<(), Self::Error> {
        collector.move_to(100.0, 100.0);
        collector.line_to(100.0, 900.0);
        collector.line_to(900.0, 900.0);
        collector.line_to(900.0, 100.0);
        collector.close();
        Ok(())
    }
}

fn square_mtsdf_checksum() -> u32 {
    let mut generator = MtsdfGenerator::default();
    let Ok(mut outline) = generator.read_outline(&AdmissionSquare) else {
        return 0;
    };
    let Ok(bytes) = outline.generate_mtsdf(REGION) else {
        return 0;
    };
    fnv1a(bytes)
}

/// Retains the complete CPU generator in the admission Wasm size measurement.
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_mtsdf_admission_checksum() -> u32 {
    square_mtsdf_checksum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct InvalidOutline;

    impl core::fmt::Display for InvalidOutline {
        fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            formatter.write_str("invalid synthetic outline")
        }
    }

    impl std::error::Error for InvalidOutline {}

    struct EmptyOutline;

    impl OutlineSource for EmptyOutline {
        type Error = Infallible;

        fn units_per_em(&self) -> f32 {
            UNITS_PER_EM
        }

        fn bounds(&self) -> Bounds {
            Bounds::new(0.0, 0.0, 1.0, 1.0)
        }

        fn emit(&self, _collector: &mut OutlineSink<'_>) -> Result<(), Self::Error> {
            Ok(())
        }
    }

    struct MalformedOutline;

    impl OutlineSource for MalformedOutline {
        type Error = InvalidOutline;

        fn units_per_em(&self) -> f32 {
            UNITS_PER_EM
        }

        fn bounds(&self) -> Bounds {
            Bounds::new(0.0, 0.0, 1.0, 1.0)
        }

        fn emit(&self, _collector: &mut OutlineSink<'_>) -> Result<(), Self::Error> {
            Err(InvalidOutline)
        }
    }

    #[test]
    fn synthetic_mtsdf_is_byte_deterministic() {
        let first = square_mtsdf_checksum();
        let second = square_mtsdf_checksum();
        assert_eq!(first, second);
        assert_eq!(first, 0x3d96_25f1);
    }

    #[test]
    fn oracle_corpus_is_deterministic_and_nonempty() {
        for case in oracle_cases() {
            let first = generate_case(case).expect("valid oracle case");
            let second = generate_case(case).expect("valid oracle case");
            assert_eq!(first, second, "{} changed between runs", case.id);
            assert_eq!(
                first.len(),
                REGION.total_width().expect("width") * REGION.total_height().expect("height") * 4
            );
            assert!(first.iter().any(|byte| *byte != 0), "{} is empty", case.id);
        }
        assert_eq!(
            fnv1a(&generate_case(&oracle_cases()[0]).expect("ordinary square")),
            square_mtsdf_checksum(),
        );
    }

    #[test]
    fn candidate_rejects_empty_and_malformed_outlines() {
        let mut generator = MtsdfGenerator::default();
        assert!(matches!(
            generator.read_outline(&EmptyOutline),
            Err(ReadOutlineError::EmptyOutline)
        ));
        assert!(matches!(
            generator.read_outline(&MalformedOutline),
            Err(ReadOutlineError::Source(InvalidOutline))
        ));
    }

    #[test]
    fn owned_core_has_no_threshold_panic_surface() {
        let generator = MtsdfGenerator::default();
        assert!(generator.limits().max_edges > 0);
    }
}
