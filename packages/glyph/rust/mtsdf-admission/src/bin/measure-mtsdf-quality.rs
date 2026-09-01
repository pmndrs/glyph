//! Measure reconstructed MTSDF coverage against an independent rasterization of the same outline.
//!
//! The native msdfgen oracle answers "does the kernel agree with msdfgen". This answers "is the
//! glyph the shader reconstructs actually the glyph", which is the question a corner artifact
//! poses. Framing mirrors `mtsdf-baker`'s `QuantizedGlyph`: the source bounds are snapped outward
//! to whole texels on the `em_size` grid, so texels per em is uniform across every glyph.
//!
//! ```text
//! measure-mtsdf-quality <font> --em-size 64 --pixel-range 8 --zoom 8 --chars "aeg&W"
//! ```

use std::{env, fs, path::PathBuf, process::ExitCode};

use pmndrs_glyph_mtsdf_admission::{
    Channel, FlatteningPen, REFERENCE_CHORDS_PER_CURVE, ShapePen, compare, font_outline_source,
    reconstruct_coverage, write_triptych,
};
use pmndrs_glyph_mtsdf_core::{AtlasRegion, MtsdfGenerator, MtsdfTransform};
use skrifa::{
    FontRef, MetadataProvider,
    prelude::{LocationRef, Size},
};

struct Options {
    font: String,
    em_size: u16,
    pixel_range: u16,
    zoom: usize,
    characters: Vec<char>,
    dump: Option<PathBuf>,
    channel: Channel,
    field_dump: Option<PathBuf>,
    emit_shape: bool,
    external_field: Option<PathBuf>,
}

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
    let options = parse_options()?;
    let bytes = fs::read(&options.font)
        .map_err(|error| format!("could not read {}: {error}", options.font))?;
    let font = FontRef::new(&bytes)
        .map_err(|error| format!("could not parse {}: {error}", options.font))?;
    let charmap = font.charmap();
    let units_per_em = f32::from(
        font.metrics(Size::unscaled(), LocationRef::default())
            .units_per_em,
    );
    let mut generator = MtsdfGenerator::default();

    if !options.emit_shape {
        println!(
            "character\tglyph\twidth\theight\tmeanAbsoluteError\tmaximumAbsoluteError\tworstX\tworstY\tsamplesOverQuarter\tsamplesOverHalf"
        );
    }
    for character in &options.characters {
        let Some(glyph_id) = charmap.map(*character) else {
            eprintln!("{character:?} is not in the font's character map");
            continue;
        };
        let Some(source) = font_outline_source(&font, glyph_id) else {
            eprintln!("{character:?} has no outline");
            continue;
        };
        let framing = Framing::new(
            source.bounds(),
            units_per_em,
            options.em_size,
            options.pixel_range,
        )?;

        if options.emit_shape {
            let mut shape = ShapePen::new();
            source
                .draw(&mut shape)
                .map_err(|error| format!("{character:?}: could not draw outline: {error}"))?;
            // msdfgen projects font -> texel as `scale * (p + translate)`, so translate is in
            // shape units and applied first. Our texel x center sits at font
            // `inverse_scale * (plane_left + x + 0.5)`, which reproduces as scale
            // `em_size / units_per_em` and translate `-plane_left * inverse_scale`.
            println!(
                "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                u32::from(*character),
                framing.total_width(),
                framing.total_height(),
                f64::from(options.em_size) / f64::from(units_per_em),
                -f64::from(framing.plane_left) * f64::from(units_per_em)
                    / f64::from(options.em_size),
                -f64::from(framing.plane_bottom) * f64::from(units_per_em)
                    / f64::from(options.em_size),
                framing.transform.full_distance_range_font_units(),
                shape.finish().trim(),
            );
            continue;
        }

        let field = if let Some(directory) = &options.external_field {
            let path = directory.join(format!("u{:04X}.rgba", u32::from(*character)));
            let bytes = fs::read(&path)
                .map_err(|error| format!("could not read {}: {error}", path.display()))?;
            let expected = framing.total_width() * framing.total_height() * 4;
            if bytes.len() != expected {
                return Err(format!(
                    "{} has {} bytes, expected {expected}",
                    path.display(),
                    bytes.len()
                ));
            }
            bytes
        } else {
            let mut outline = generator
                .read_outline(&source)
                .map_err(|error| format!("{character:?}: {error}"))?;
            outline
                .generate_mtsdf_with_transform(framing.region, framing.transform)
                .map_err(|error| format!("{character:?}: {error}"))?
                .to_vec()
        };

        let width = framing.total_width();
        let height = framing.total_height();
        let out_width = width * options.zoom;
        let out_height = height * options.zoom;

        // Font unit -> output pixel. The generator writes row 0 at the top, so y flips here.
        let inverse_scale = f64::from(units_per_em) / f64::from(options.em_size);
        let plane_left = f64::from(framing.plane_left);
        let plane_bottom = f64::from(framing.plane_bottom);
        let zoom = options.zoom as f64;
        let to_pixel = move |x: f32, y: f32| -> [f64; 2] {
            [
                (f64::from(x) / inverse_scale - plane_left) * zoom,
                (plane_bottom + height as f64 - f64::from(y) / inverse_scale) * zoom,
            ]
        };

        let mut pen = FlatteningPen::new(to_pixel, REFERENCE_CHORDS_PER_CURVE);
        source
            .draw(&mut pen)
            .map_err(|error| format!("{character:?}: could not draw outline: {error}"))?;
        let reference = pen.finish().rasterize(out_width, out_height);

        let candidate = reconstruct_coverage(
            &field,
            width,
            height,
            options.zoom,
            f64::from(options.pixel_range),
            options.channel,
        );
        let measurement = compare(&candidate, &reference, out_width);

        println!(
            "{}\t{}\t{}\t{}\t{:.5}\t{:.5}\t{}\t{}\t{}\t{}",
            character,
            glyph_id.to_u32(),
            out_width,
            out_height,
            measurement.mean_absolute_error,
            measurement.maximum_absolute_error,
            measurement.worst_x,
            measurement.worst_y,
            measurement.samples_over_quarter,
            measurement.samples_over_half,
        );

        if let Some(directory) = &options.field_dump {
            fs::create_dir_all(directory)
                .map_err(|error| format!("could not create {}: {error}", directory.display()))?;
            let path = directory.join(format!(
                "u{:04X}.{width}x{height}.rgba",
                u32::from(*character)
            ));
            fs::write(&path, &field)
                .map_err(|error| format!("could not write {}: {error}", path.display()))?;
        }
        if let Some(directory) = &options.dump {
            fs::create_dir_all(directory)
                .map_err(|error| format!("could not create {}: {error}", directory.display()))?;
            let path = directory.join(format!("u{:04X}.ppm", u32::from(*character)));
            fs::write(
                &path,
                write_triptych(&candidate, &reference, out_width, out_height),
            )
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
        }
    }
    Ok(())
}

/// Atlas framing for one glyph, mirroring `mtsdf-baker`'s `QuantizedGlyph`.
struct Framing {
    region: AtlasRegion,
    transform: MtsdfTransform,
    plane_left: i32,
    plane_bottom: i32,
}

impl Framing {
    fn new(
        bounds: pmndrs_glyph_mtsdf_core::Bounds,
        units_per_em: f32,
        em_size: u16,
        pixel_range: u16,
    ) -> Result<Self, String> {
        let scale = f32::from(em_size) / units_per_em;
        let left = (bounds.min_x * scale).floor() as i32;
        let bottom = (bounds.min_y * scale).floor() as i32;
        let right = (bounds.max_x * scale).ceil() as i32;
        let top = (bounds.max_y * scale).ceil() as i32;
        let padding = usize::from(pixel_range / 2 + pixel_range % 2);
        let inner_width =
            usize::try_from(right - left).map_err(|_| "glyph too large".to_owned())?;
        let inner_height =
            usize::try_from(top - bottom).map_err(|_| "glyph too large".to_owned())?;
        let inverse_scale = units_per_em / f32::from(em_size);
        let transform_bounds = pmndrs_glyph_mtsdf_core::Bounds::new(
            left as f32 * inverse_scale,
            bottom as f32 * inverse_scale,
            right as f32 * inverse_scale,
            top as f32 * inverse_scale,
        );
        let full_distance_range = units_per_em * f32::from(pixel_range) / f32::from(em_size);
        let transform = MtsdfTransform::new(transform_bounds, full_distance_range)
            .ok_or_else(|| "invalid transform".to_owned())?;
        Ok(Self {
            region: AtlasRegion {
                inner_width,
                inner_height,
                padding_x: padding,
                padding_y: padding,
            },
            transform,
            plane_left: left - padding as i32,
            plane_bottom: bottom - padding as i32,
        })
    }

    fn total_width(&self) -> usize {
        self.region.inner_width + self.region.padding_x * 2
    }

    fn total_height(&self) -> usize {
        self.region.inner_height + self.region.padding_y * 2
    }
}

fn parse_options() -> Result<Options, String> {
    let mut arguments = env::args().skip(1);
    let font = arguments
        .next()
        .ok_or_else(|| "usage: measure-mtsdf-quality <font> [--em-size N] [--pixel-range N] [--zoom N] [--chars STRING] [--dump DIR]".to_owned())?;
    let mut options = Options {
        font,
        em_size: 64,
        pixel_range: 8,
        zoom: 8,
        characters: Vec::new(),
        dump: None,
        channel: Channel::Median,
        field_dump: None,
        emit_shape: false,
        external_field: None,
    };
    let rest: Vec<String> = arguments.collect();
    let mut index = 0;
    while index < rest.len() {
        let flag = rest[index].as_str();
        let value = || {
            rest.get(index + 1)
                .cloned()
                .ok_or_else(|| format!("{flag} requires a value"))
        };
        match flag {
            "--em-size" => options.em_size = parse_number(&value()?, "--em-size")?,
            "--pixel-range" => options.pixel_range = parse_number(&value()?, "--pixel-range")?,
            "--zoom" => options.zoom = parse_number::<u16>(&value()?, "--zoom")?.into(),
            "--chars" => options.characters = value()?.chars().collect(),
            "--dump" => options.dump = Some(PathBuf::from(value()?)),
            "--field-dump" => options.field_dump = Some(PathBuf::from(value()?)),
            "--external-field" => options.external_field = Some(PathBuf::from(value()?)),
            "--emit-shape" => {
                options.emit_shape = true;
                index += 1;
                continue;
            }
            "--channel" => {
                options.channel = match value()?.as_str() {
                    "median" => Channel::Median,
                    "alpha" => Channel::TrueDistance,
                    other => return Err(format!("--channel expects median or alpha, got {other}")),
                }
            }
            other => return Err(format!("unknown flag {other}")),
        }
        index += 2;
    }
    if options.zoom == 0 {
        return Err("--zoom must be at least 1".to_owned());
    }
    if options.characters.is_empty() {
        options.characters = "aegoWMR&48".chars().collect();
    }
    Ok(options)
}

fn parse_number<T: std::str::FromStr>(value: &str, flag: &str) -> Result<T, String> {
    value
        .parse()
        .map_err(|_| format!("{flag} expects a number, got {value}"))
}
