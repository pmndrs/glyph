use read_fonts::{
    FontRef, TableProvider,
    tables::cmap::MapVariant,
    types::{GlyphId, Tag},
};
use serde::Serialize;
use std::{collections::BTreeSet, env, fs, path::PathBuf, process};

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct MappingRequest {
    base: u32,
    selector: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureInspection {
    schema_version: u8,
    face_index: u32,
    glyph_count: u16,
    tables: Vec<SourceTable>,
    cmap_formats: Vec<u16>,
    mappings: Vec<MappingResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceTable {
    tag: String,
    bytes: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MappingResult {
    code_points: Vec<String>,
    mapping: Mapping,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Mapping {
    Missing,
    Nominal {
        #[serde(rename = "glyphId")]
        glyph_id: u32,
    },
    UseDefault {
        #[serde(rename = "glyphId")]
        glyph_id: u32,
    },
    Variant {
        #[serde(rename = "glyphId")]
        glyph_id: u32,
    },
}

struct Options {
    font_path: PathBuf,
    face_index: u32,
    mappings: Vec<MappingRequest>,
    output_path: Option<PathBuf>,
}

fn usage() -> ! {
    eprintln!(
        "usage: inspect-font-fixture <font-file> [--face-index <u32>] [--map <U+BASE[+U+SELECTOR]>]... [--output <json>]"
    );
    process::exit(2);
}

fn main() {
    if let Err(error) = run() {
        eprintln!("inspect-font-fixture: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let options = parse_options(env::args_os().skip(1))?;
    let font_bytes = fs::read(&options.font_path).map_err(|error| error.to_string())?;
    let inspection = inspect(&font_bytes, options.face_index, &options.mappings)?;
    let mut output =
        serde_json::to_string_pretty(&inspection).map_err(|error| error.to_string())?;
    output.push('\n');
    if let Some(path) = options.output_path {
        fs::write(path, output).map_err(|error| error.to_string())?;
    } else {
        print!("{output}");
    }
    Ok(())
}

fn parse_options(arguments: impl Iterator<Item = std::ffi::OsString>) -> Result<Options, String> {
    let mut arguments = arguments;
    let font_path = PathBuf::from(arguments.next().unwrap_or_else(|| usage()));
    let mut face_index = 0;
    let mut mappings = Vec::new();
    let mut output_path = None;
    while let Some(flag) = arguments.next() {
        if flag == "--face-index" {
            let value = arguments.next().unwrap_or_else(|| usage());
            face_index = value
                .to_str()
                .ok_or_else(|| "face index is not UTF-8".to_owned())?
                .parse::<u32>()
                .map_err(|error| format!("invalid face index: {error}"))?;
        } else if flag == "--map" {
            let value = arguments.next().unwrap_or_else(|| usage());
            mappings.push(parse_mapping(
                value
                    .to_str()
                    .ok_or_else(|| "mapping is not UTF-8".to_owned())?,
            )?);
        } else if flag == "--output" {
            output_path = Some(PathBuf::from(arguments.next().unwrap_or_else(|| usage())));
        } else {
            return Err(format!("unknown option {}", flag.to_string_lossy()));
        }
    }
    mappings.sort_unstable();
    if mappings.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err("mapping requests must be unique".to_owned());
    }
    Ok(Options {
        font_path,
        face_index,
        mappings,
        output_path,
    })
}

fn parse_mapping(value: &str) -> Result<MappingRequest, String> {
    let values = value
        .strip_prefix("U+")
        .ok_or_else(|| format!("mapping {value:?} must begin with U+"))?
        .split("+U+")
        .map(|part| {
            u32::from_str_radix(part, 16)
                .map_err(|error| format!("invalid code point in mapping {value:?}: {error}"))
                .and_then(|code_point| {
                    char::from_u32(code_point)
                        .map(u32::from)
                        .ok_or_else(|| format!("mapping {value:?} contains a non-scalar value"))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    match values.as_slice() {
        [base] => Ok(MappingRequest {
            base: *base,
            selector: None,
        }),
        [base, selector] if is_variation_selector(*selector) => Ok(MappingRequest {
            base: *base,
            selector: Some(*selector),
        }),
        [_, _] => Err(format!(
            "mapping {value:?} must use a standardized or ideographic variation selector"
        )),
        _ => Err(format!(
            "mapping {value:?} must contain one scalar or one base-selector pair"
        )),
    }
}

fn is_variation_selector(value: u32) -> bool {
    matches!(value, 0xFE00..=0xFE0F | 0xE0100..=0xE01EF)
}

fn inspect(
    font_bytes: &[u8],
    face_index: u32,
    requests: &[MappingRequest],
) -> Result<FixtureInspection, String> {
    let font = FontRef::from_index(font_bytes, face_index)
        .map_err(|error| format!("failed to read font face {face_index}: {error}"))?;
    let glyph_count = font
        .maxp()
        .map_err(|error| format!("failed to read maxp: {error}"))?
        .num_glyphs();
    let mut tables = font
        .table_directory()
        .table_records()
        .iter()
        .map(|record| source_table(&font, record.tag()))
        .collect::<Result<Vec<_>, _>>()?;
    tables.sort_unstable_by(|left, right| left.tag.cmp(&right.tag));
    if tables.windows(2).any(|pair| pair[0].tag == pair[1].tag) {
        return Err("font table tags must be unique".to_owned());
    }

    let cmap = font
        .cmap()
        .map_err(|error| format!("failed to read cmap: {error}"))?;
    let mut cmap_formats = BTreeSet::new();
    for index in 0..cmap.num_tables() {
        let subtable = cmap
            .subtable(index)
            .map_err(|error| format!("failed to read cmap subtable {index}: {error}"))?;
        cmap_formats.insert(subtable.format());
    }
    let mappings = requests
        .iter()
        .map(|request| map_request(&cmap, request))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(FixtureInspection {
        schema_version: 0,
        face_index,
        glyph_count,
        tables,
        cmap_formats: cmap_formats.into_iter().collect(),
        mappings,
    })
}

fn source_table(font: &FontRef<'_>, tag: Tag) -> Result<SourceTable, String> {
    let data = font
        .table_data(tag)
        .ok_or_else(|| format!("table {tag} has an invalid range"))?;
    Ok(SourceTable {
        tag: tag.to_string(),
        bytes: data.len(),
    })
}

fn map_request(
    cmap: &read_fonts::tables::cmap::Cmap<'_>,
    request: &MappingRequest,
) -> Result<MappingResult, String> {
    let nominal = || cmap.map_codepoint(request.base).map(glyph_id);
    let mapping = match request.selector {
        None => nominal()
            .map(|glyph_id| Mapping::Nominal { glyph_id })
            .unwrap_or(Mapping::Missing),
        Some(selector) => match cmap
            .uvs_subtable()
            .and_then(|(_, subtable)| subtable.map_variant(request.base, selector))
        {
            None => Mapping::Missing,
            Some(MapVariant::Variant(glyph)) => Mapping::Variant {
                glyph_id: glyph_id(glyph),
            },
            Some(MapVariant::UseDefault) => Mapping::UseDefault {
                glyph_id: nominal().ok_or_else(|| {
                    format!(
                        "variation mapping {} uses a missing default glyph",
                        format_code_point(request.base)
                    )
                })?,
            },
        },
    };
    Ok(MappingResult {
        code_points: [Some(request.base), request.selector]
            .into_iter()
            .flatten()
            .map(format_code_point)
            .collect(),
        mapping,
    })
}

fn glyph_id(value: GlyphId) -> u32 {
    value.to_u32()
}

fn format_code_point(value: u32) -> String {
    format!("U+{value:04X}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const INTER: &[u8] = include_bytes!(
        "../../../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf"
    );

    #[test]
    fn parses_the_focused_cjk_mapping_forms() {
        assert_eq!(parse_mapping("U+2000B").unwrap().base, 0x2000B);
        for value in ["U+3001+U+FE00", "U+3002+U+FE01", "U+79B0+U+E0100"] {
            assert!(parse_mapping(value).unwrap().selector.is_some());
        }
        assert!(parse_mapping("U+D800").is_err());
        assert!(parse_mapping("U+0041+U+0042").is_err());
    }

    #[test]
    fn inspects_one_face_deterministically_through_read_fonts() {
        let requests = [
            parse_mapping("U+0041").unwrap(),
            parse_mapping("U+2000B").unwrap(),
            parse_mapping("U+3001+U+FE00").unwrap(),
        ];
        let first = inspect(INTER, 0, &requests).unwrap();
        let second = inspect(INTER, 0, &requests).unwrap();
        assert_eq!(first.glyph_count, 2937);
        assert_eq!(first.cmap_formats, [4, 12]);
        assert!(
            first
                .tables
                .windows(2)
                .all(|pair| pair[0].tag < pair[1].tag)
        );
        let first_json = serde_json::to_string(&first).unwrap();
        assert_eq!(first_json, serde_json::to_string(&second).unwrap());
        assert!(first_json.contains("\"glyphId\":"));
        assert!(!first_json.contains("glyph_id"));
    }
}
