use std::fmt::Write as _;
use std::io::{self, Write as _};

use pmndrs_text_mtsdf_admission::{REGION, UNITS_PER_EM, generate_case, oracle_cases};

fn main() -> io::Result<()> {
    let stdout = io::stdout();
    let mut output = io::BufWriter::new(stdout.lock());

    for case in oracle_cases() {
        let Some(bytes) = generate_case(case) else {
            return Err(io::Error::other(format!(
                "candidate rejected valid oracle case {}",
                case.id
            )));
        };
        let mut hexadecimal = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            let _ = write!(hexadecimal, "{byte:02x}");
        }
        let (scale_x, scale_y) = case.native_scale();
        let (translate_x, translate_y) = case.native_translate();
        writeln!(
            output,
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            case.id,
            REGION.total_width().expect("fixed width"),
            REGION.total_height().expect("fixed height"),
            UNITS_PER_EM,
            scale_x,
            scale_y,
            translate_x,
            translate_y,
            case.shape_description(),
            hexadecimal
        )?;
    }
    Ok(())
}
