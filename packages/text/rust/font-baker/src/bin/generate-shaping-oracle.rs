use harfrust::{
    BufferFlags, Direction, Feature, FontRef, Language, Script, ShapeOptions, ShaperData,
    UnicodeBuffer,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{env, fs, path::PathBuf, process, str::FromStr};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Corpus {
    schema_version: u8,
    font_fixture: String,
    cluster_unit: String,
    defaults: SegmentProperties,
    cases: Vec<Case>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SegmentProperties {
    direction: String,
    script: String,
    language: String,
    features: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Case {
    id: String,
    text: String,
    utf16_length: usize,
    code_points: Vec<String>,
    #[serde(default)]
    direction: Option<String>,
    #[serde(default)]
    script: Option<String>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    features: Option<Vec<String>>,
    #[serde(default = "default_true")]
    oracle: bool,
}

fn default_true() -> bool {
    true
}

fn usage() -> ! {
    eprintln!("usage: generate-shaping-oracle <font-file> <cases.json> [--output <harfrust.json>]");
    process::exit(2);
}

fn main() {
    if let Err(error) = run() {
        eprintln!("generate-shaping-oracle: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut arguments = env::args_os().skip(1);
    let font_path = PathBuf::from(arguments.next().unwrap_or_else(|| usage()));
    let cases_path = PathBuf::from(arguments.next().unwrap_or_else(|| usage()));
    let output_path = match arguments.next() {
        None => None,
        Some(flag) if flag == "--output" => {
            Some(PathBuf::from(arguments.next().unwrap_or_else(|| usage())))
        }
        Some(_) => usage(),
    };
    if arguments.next().is_some() {
        usage();
    }

    let font_bytes = fs::read(&font_path).map_err(|error| error.to_string())?;
    let font = FontRef::new(&font_bytes).map_err(|error| error.to_string())?;
    let shaper_data = ShaperData::new(&font);
    let shaper = shaper_data.shaper(&font).build();
    let corpus: Corpus =
        serde_json::from_slice(&fs::read(&cases_path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    if corpus.schema_version != 0 || corpus.cluster_unit != "utf16" {
        return Err("unsupported corpus schema or cluster unit".to_owned());
    }

    let cases = corpus
        .cases
        .iter()
        .filter(|case| case.oracle)
        .map(|case| shape_case(&shaper, &corpus.defaults, case))
        .collect::<Result<Vec<_>, _>>()?;
    let document = json!({
        "schemaVersion": 0,
        "engine": {
            "name": "HarfRust",
            "version": "0.12.0",
            "commit": "60b28ea22b5261710018d69c168a762bcb28794c"
        },
        "fontFixture": corpus.font_fixture,
        "clusterUnit": "utf16",
        "positionUnit": "font-unit",
        "cases": cases
    });
    let mut output = serde_json::to_string_pretty(&document).map_err(|error| error.to_string())?;
    output.push('\n');
    if let Some(path) = output_path {
        fs::write(path, output).map_err(|error| error.to_string())?;
    } else {
        print!("{output}");
    }
    Ok(())
}

fn shape_case(
    shaper: &harfrust::Shaper<'_>,
    defaults: &SegmentProperties,
    case: &Case,
) -> Result<Value, String> {
    if case.text.encode_utf16().count() != case.utf16_length {
        return Err(format!("case {} has an incorrect UTF-16 length", case.id));
    }
    if case.text.chars().count() != case.code_points.len() {
        return Err(format!(
            "case {} has an incorrect code-point inventory",
            case.id
        ));
    }

    let direction = case.direction.as_ref().unwrap_or(&defaults.direction);
    let script = case.script.as_ref().unwrap_or(&defaults.script);
    let language = case.language.as_ref().unwrap_or(&defaults.language);
    let feature_sources = case.features.as_ref().unwrap_or(&defaults.features);
    let features = feature_sources
        .iter()
        .map(|feature| Feature::from_str(feature).map_err(str::to_owned))
        .collect::<Result<Vec<_>, _>>()?;

    let mut buffer = UnicodeBuffer::new();
    let mut utf16_offset = 0_u32;
    for character in case.text.chars() {
        buffer.add(character, utf16_offset);
        utf16_offset += character.len_utf16() as u32;
    }
    buffer.set_direction(Direction::from_str(direction).map_err(str::to_owned)?);
    buffer.set_script(Script::from_str(script).map_err(str::to_owned)?);
    buffer.set_language(Language::from_str(language).map_err(str::to_owned)?);
    buffer.set_flags(BufferFlags::PRODUCE_UNSAFE_TO_CONCAT);

    let shaped = shaper.shape(buffer, ShapeOptions::new().features(&features));
    let glyphs = shaped
        .glyph_infos()
        .iter()
        .zip(shaped.glyph_positions())
        .map(|(info, position)| {
            json!({
                "glyphId": info.glyph_id,
                "cluster": info.cluster,
                "xAdvance": position.x_advance,
                "yAdvance": position.y_advance,
                "xOffset": position.x_offset,
                "yOffset": position.y_offset,
                "flags": info.flags().to_bits()
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "id": case.id,
        "text": case.text,
        "segment": {
            "direction": direction,
            "script": script,
            "language": language,
            "features": feature_sources
        },
        "glyphs": glyphs
    }))
}
