use std::{env, fs, path::PathBuf, process::ExitCode};

use pmndrs_glyph_mtsdf_baker::{
    ArtifactPackaging, MSDF_GENERATOR_VERSION, MtsdfBakeRequestV0, MtsdfDescriptorV0,
    MtsdfPackagingV0, PagePackaging, RasterCoverageV0, RasterUnicodeRangeV0, bake_mtsdf_profiled,
    descriptor_raster_key,
};
use pmndrs_glyph_mtsdf_fontations::glyph_count;
use pmndrs_glyph_raster_artifact::sha256_hex;
use serde_json::json;
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

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let arguments = Arguments::parse()?;
    let source = fs::read(&arguments.font)?;
    let font = FontRef::from_index(&source, 0)?;
    let glyph_count = glyph_count(&font)?;
    let descriptor = MtsdfDescriptorV0 {
        coverage: arguments.case.coverage(),
        generator_version: MSDF_GENERATOR_VERSION.into(),
        em_size: None,
        pixel_range: None,
    };
    let raster_key = descriptor_raster_key(&descriptor);
    let shaping_hash = sha256_hex(&source);
    let profiled = bake_mtsdf_profiled(
        &source,
        MtsdfBakeRequestV0 {
            font_face_index: 0,
            glyph_count,
            shaping_hash,
            raster_key,
            packaging: MtsdfPackagingV0 {
                artifact: ArtifactPackaging::Embedded,
                pages: PagePackaging::Embedded,
            },
            descriptor,
        },
    )?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "schemaVersion": 0,
            "kind": "mtsdf-baker-native-profile",
            "case": arguments.case.label(),
            "font": arguments.font,
            "glyphSlots": glyph_count,
            "profile": profiled.profile,
            "payload": profiled.result.report,
            "artifacts": profiled.result.artifacts,
        }))?
    );
    Ok(())
}

struct Arguments {
    font: PathBuf,
    case: ProfileCase,
}

impl Arguments {
    fn parse() -> Result<Self, &'static str> {
        let mut values = env::args_os().skip(1);
        let mut font = None;
        let mut case = None;
        while let Some(argument) = values.next() {
            let argument = argument.to_str().ok_or("arguments must be valid UTF-8")?;
            match argument {
                "--font" => {
                    font = Some(PathBuf::from(
                        values.next().ok_or("--font requires a path")?,
                    ));
                }
                "--case" => {
                    let value = values.next().ok_or("--case requires a value")?;
                    case = Some(ProfileCase::parse(
                        value.to_str().ok_or("--case must be valid UTF-8")?,
                    )?);
                }
                _ if argument.starts_with("--font=") => {
                    font = Some(PathBuf::from(&argument["--font=".len()..]));
                }
                _ if argument.starts_with("--case=") => {
                    case = Some(ProfileCase::parse(&argument["--case=".len()..])?);
                }
                _ => return Err(USAGE),
            }
        }
        Ok(Self {
            font: font.ok_or("--font is required")?,
            case: case.ok_or("--case is required")?,
        })
    }
}

const USAGE: &str = "usage: profile-mtsdf-baker --font <path> --case <small|medium|complete>";

#[derive(Clone, Copy)]
enum ProfileCase {
    Small,
    Medium,
    Complete,
}

impl ProfileCase {
    fn parse(value: &str) -> Result<Self, &'static str> {
        match value {
            "small" => Ok(Self::Small),
            "medium" => Ok(Self::Medium),
            "complete" => Ok(Self::Complete),
            _ => Err("--case must be small, medium, or complete"),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Small => "small",
            Self::Medium => "medium",
            Self::Complete => "complete",
        }
    }

    fn coverage(self) -> Option<RasterCoverageV0> {
        match self {
            Self::Small => Some(RasterCoverageV0 {
                unicode_ranges: None,
                text: Some("Sphinx of black quartz, judge my vow. 0123456789".into()),
                glyph_ids: None,
            }),
            Self::Medium => Some(RasterCoverageV0 {
                unicode_ranges: Some(vec![RasterUnicodeRangeV0 {
                    start: 0x20,
                    end: 0x24f,
                }]),
                text: None,
                glyph_ids: None,
            }),
            Self::Complete => None,
        }
    }
}
