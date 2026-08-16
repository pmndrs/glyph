use std::{env, fs, process::ExitCode};

use pmndrs_glyph_mtsdf_admission::{glyph_count, measure_font_pass};
use pmndrs_glyph_mtsdf_core::MtsdfGenerator;
use skrifa::FontRef;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let path = env::args()
        .nth(1)
        .ok_or_else(|| "usage: measure-mtsdf-font <font-path>".to_owned())?;
    let bytes = fs::read(&path).map_err(|error| format!("could not read {path}: {error}"))?;
    let font = FontRef::new(&bytes).map_err(|error| format!("could not parse {path}: {error}"))?;
    let glyph_count = glyph_count(&font).map_err(|error| format!("missing maxp: {error}"))?;
    let mut generator = MtsdfGenerator::default();
    let cold = measure_font_pass(font.clone(), glyph_count, &mut generator);
    let mut warm_nanoseconds = [0_u128; 5];
    for elapsed in &mut warm_nanoseconds {
        let warm = measure_font_pass(font.clone(), glyph_count, &mut generator);
        if cold.generated_glyphs != warm.generated_glyphs
            || cold.skipped_glyphs != warm.skipped_glyphs
            || cold.rejected_glyphs != warm.rejected_glyphs
            || cold.checksum != warm.checksum
        {
            return Err("cold and warm passes produced different results".to_owned());
        }
        *elapsed = warm.elapsed_nanoseconds;
    }
    warm_nanoseconds.sort_unstable();
    println!(
        "{path}\t{glyph_count}\t{}\t{}\t{}\t{}\t{}\t{}",
        cold.generated_glyphs,
        cold.skipped_glyphs,
        cold.rejected_glyphs,
        cold.checksum,
        cold.elapsed_nanoseconds,
        warm_nanoseconds[2],
    );
    Ok(())
}
