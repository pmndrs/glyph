use std::{
    env, fs,
    io::{self, BufWriter, Write},
    process::ExitCode,
};

use pmndrs_text_mtsdf_admission::{font_outline_source, glyph_count};
use skrifa::{FontRef, GlyphId, outline::OutlinePen};

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
        .ok_or_else(|| "usage: emit-mtsdf-font-requests <font-path>".to_owned())?;
    let bytes = fs::read(&path).map_err(|error| format!("could not read {path}: {error}"))?;
    let font = FontRef::new(&bytes).map_err(|error| format!("could not parse {path}: {error}"))?;
    let count = glyph_count(&font).map_err(|error| format!("missing maxp: {error}"))?;
    let mut output = BufWriter::new(io::stdout().lock());
    writeln!(output, "pmndrs-mtsdf-font-requests-v0\t{count}").map_err(write_error)?;
    for raw_glyph_id in 0..count {
        let glyph_id = GlyphId::new(u32::from(raw_glyph_id));
        let Some(source) = font_outline_source(&font, glyph_id) else {
            writeln!(output, "s\t{raw_glyph_id}").map_err(write_error)?;
            continue;
        };
        let bounds = source.bounds();
        writeln!(
            output,
            "g\t{raw_glyph_id}\t{}\t{}\t{}\t{}\t{}\t{}",
            source.units_per_em(),
            bounds.min_x,
            bounds.min_y,
            bounds.max_x,
            bounds.max_y,
            u8::from(source.reversed()),
        )
        .map_err(write_error)?;
        let mut pen = RequestPen::new(&mut output);
        source
            .draw(&mut pen)
            .map_err(|error| format!("glyph {raw_glyph_id} outline failed: {error}"))?;
        pen.finish()?;
        writeln!(output, "e").map_err(write_error)?;
    }
    output.flush().map_err(write_error)
}

fn write_error(error: io::Error) -> String {
    format!("could not write request corpus: {error}")
}

struct RequestPen<'writer, Writer> {
    writer: &'writer mut Writer,
    error: Option<io::Error>,
}

impl<Writer: Write> RequestPen<'_, Writer> {
    fn new(writer: &mut Writer) -> RequestPen<'_, Writer> {
        RequestPen {
            writer,
            error: None,
        }
    }

    fn command(&mut self, command: &str, coordinates: &[f32]) {
        if self.error.is_some() {
            return;
        }
        if let Err(error) = write_command(self.writer, command, coordinates) {
            self.error = Some(error);
        }
    }

    fn finish(self) -> Result<(), String> {
        self.error.map_or(Ok(()), |error| Err(write_error(error)))
    }
}

fn write_command(writer: &mut impl Write, command: &str, coordinates: &[f32]) -> io::Result<()> {
    write!(writer, "{command}")?;
    for coordinate in coordinates {
        write!(writer, "\t{coordinate}")?;
    }
    writeln!(writer)
}

impl<Writer: Write> OutlinePen for RequestPen<'_, Writer> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.command("m", &[x, y]);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.command("l", &[x, y]);
    }

    fn quad_to(&mut self, control_x: f32, control_y: f32, x: f32, y: f32) {
        self.command("q", &[control_x, control_y, x, y]);
    }

    fn curve_to(
        &mut self,
        control0_x: f32,
        control0_y: f32,
        control1_x: f32,
        control1_y: f32,
        x: f32,
        y: f32,
    ) {
        self.command("c", &[control0_x, control0_y, control1_x, control1_y, x, y]);
    }

    fn close(&mut self) {
        self.command("z", &[]);
    }
}
