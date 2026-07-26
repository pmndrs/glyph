use core::convert::Infallible;

use klyff_msdf::{Aabb, AtlasRegionSize, MsdfGenerator, OutlineProvider, SegmentCollector};

const REGION: AtlasRegionSize = AtlasRegionSize {
    inner_width: 32,
    inner_height: 32,
    padding_x: 4,
    padding_y: 4,
};

/// Deterministic synthetic outline used only to measure and harden candidate generators.
struct AdmissionSquare;

impl OutlineProvider for AdmissionSquare {
    type ReadFontError = Infallible;

    fn length_per_em(&self) -> f32 {
        1_000.0
    }

    fn collect_outline<'collect>(
        &self,
        collector: &mut SegmentCollector<'collect>,
    ) -> Result<Aabb, klyff_msdf::ReadGlyphOutlineError<Self::ReadFontError>> {
        collector.move_to(100.0, 100.0);
        collector.line_to(900.0, 100.0);
        collector.line_to(900.0, 900.0);
        collector.line_to(100.0, 900.0);
        collector.close();
        Ok(Aabb::new(100.0, 100.0, 900.0, 900.0))
    }
}

fn square_mtsdf_checksum() -> u32 {
    let mut generator = MsdfGenerator::new();
    let Ok(mut outline) = generator.read_glyph(&AdmissionSquare) else {
        return 0;
    };
    outline
        .generate_mtsdf(REGION)
        .iter()
        .fold(2_166_136_261_u32, |hash, byte| {
            (hash ^ u32::from(*byte)).wrapping_mul(16_777_619)
        })
}

/// Retains the complete CPU generator in the admission Wasm size measurement.
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_mtsdf_admission_checksum() -> u32 {
    square_mtsdf_checksum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthetic_mtsdf_is_byte_deterministic() {
        let first = square_mtsdf_checksum();
        let second = square_mtsdf_checksum();
        assert_eq!(first, second);
        assert_eq!(first, 0x4b58_5e49);
    }

    #[test]
    fn published_threshold_api_still_panics_on_invalid_input() {
        let result = std::panic::catch_unwind(|| {
            let mut generator = MsdfGenerator::new();
            generator.set_segment_deviation_threshold(0.0);
        });
        assert!(result.is_err(), "candidate unexpectedly stopped panicking");
    }
}
