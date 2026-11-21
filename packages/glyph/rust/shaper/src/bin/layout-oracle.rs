//! Native host for the layout oracle: loads fonts and the frozen reference set from disk and
//! runs the same commands the wasm probe runs.
//!
//! ```text
//! layout-oracle check [--tier quick|full] [--case NAME]… [--set exact] [--seeds N] [--steps N]
//! layout-oracle fuzz --case NAME --seed N --steps N
//! layout-oracle dump --out DIR [--tier …] [--case NAME]…
//! layout-oracle diff DIR_A DIR_B
//! layout-oracle list [--tier quick|full]
//! layout-oracle bless --replace-frozen-reference [--tier …] [--case NAME]… [--overwrite]
//! ```
//!
//! Fonts outside the repository are found through `GLYPH_ADVERSARIAL_FONTS`; a case whose
//! fonts are absent is skipped and reported.

use std::{
    env, fs,
    path::{Path, PathBuf},
    process::ExitCode,
    time::Instant,
};

use pmndrs_glyph_shaper::engine::oracle::{
    fonts::{FONTS, FontLibrary, FontRoot},
    lanes::Capture,
    matrix::{self, Case, Tier},
    run,
    tier::{self, Files},
};

const BLESS_FLAG: &str = "--replace-frozen-reference";

fn main() -> ExitCode {
    match run_tool(&env::args().skip(1).collect::<Vec<_>>()) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(error) => {
            eprintln!("layout-oracle: {error}");
            ExitCode::from(2)
        }
    }
}

struct Options {
    tier: Tier,
    cases: Vec<String>,
    set: String,
    seeds: Option<u64>,
    steps: Option<usize>,
    seed: u64,
    out: Option<PathBuf>,
    overwrite: bool,
    bless: bool,
    positional: Vec<String>,
}

fn options(arguments: &[String]) -> Result<Options, String> {
    let mut options = Options {
        tier: Tier::Quick,
        cases: Vec::new(),
        set: "exact".into(),
        seeds: None,
        steps: None,
        seed: 1,
        out: None,
        overwrite: false,
        bless: false,
        positional: Vec::new(),
    };
    let mut arguments = arguments.iter();
    while let Some(argument) = arguments.next() {
        let mut value = || {
            arguments
                .next()
                .cloned()
                .ok_or_else(|| format!("{argument} needs a value"))
        };
        let number = |text: String| text.parse::<u64>().map_err(|error| error.to_string());
        match argument.as_str() {
            "--tier" => options.tier = matrix::parse_tier(&value()?)?,
            "--case" => options.cases.push(value()?),
            "--set" => options.set = value()?,
            "--seeds" => options.seeds = Some(number(value()?)?),
            "--steps" => options.steps = Some(number(value()?)? as usize),
            "--seed" => options.seed = number(value()?)?,
            "--out" => options.out = Some(PathBuf::from(value()?)),
            "--overwrite" => options.overwrite = true,
            BLESS_FLAG => options.bless = true,
            other if other.starts_with("--") => return Err(format!("unknown option {other}")),
            other => options.positional.push(other.into()),
        }
    }
    Ok(options)
}

fn run_tool(arguments: &[String]) -> Result<bool, String> {
    let (command, rest) = arguments
        .split_first()
        .ok_or("no command; see the header of src/bin/layout-oracle.rs")?;
    let options = options(rest)?;
    match command.as_str() {
        "list" => {
            print!("{}", run::list(options.tier));
            Ok(true)
        }
        "check" => check(&options),
        "bless" => bless(&options),
        "fuzz" => fuzz(&options),
        "dump" => dump(&options),
        "diff" => diff(&options),
        #[cfg(feature = "stage-bench")]
        "bench" => bench(&options),
        other => Err(format!("unknown command {other}")),
    }
}

fn manifest_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn font_root(root: FontRoot) -> Option<PathBuf> {
    match root {
        FontRoot::Repository => {
            Some(manifest_directory().join("../../../../benches/fixtures/fonts"))
        }
        FontRoot::Synthetic => Some(manifest_directory().join("src/engine/adversarial-fonts")),
        FontRoot::Adversarial => env::var_os("GLYPH_ADVERSARIAL_FONTS").map(PathBuf::from),
    }
}

/// Loads every font the selected cases name and that exists on disk.
fn library(cases: &[Case]) -> Result<FontLibrary, String> {
    let mut library = FontLibrary::default();
    let wanted: Vec<&str> = cases.iter().flat_map(Case::font_keys).collect();
    for font in FONTS.iter().filter(|font| wanted.contains(&font.key)) {
        let Some(root) = font_root(font.root) else {
            continue;
        };
        if let Ok(bytes) = fs::read(root.join(font.path)) {
            library.insert(font.key, bytes)?;
        }
    }
    Ok(library)
}

/// `bench <stage-bench command>`: the probe's stage clocks, natively, for a profiler.
#[cfg(feature = "stage-bench")]
fn bench(options: &Options) -> Result<bool, String> {
    let mut library = FontLibrary::default();
    for font in FONTS {
        if let Some(bytes) =
            font_root(font.root).and_then(|root| fs::read(root.join(font.path)).ok())
        {
            library.insert(font.key, bytes)?;
        }
    }
    let line = format!("bench {}", options.positional.join(" "));
    let answer = run::command(&library, &ReferenceSet::new(&options.set), &line, "");
    print!("{answer}");
    Ok(answer.starts_with("ok"))
}

fn selected(options: &Options) -> Result<Vec<Case>, String> {
    let names: Vec<&str> = options.cases.iter().map(String::as_str).collect();
    tier::selected(options.tier, &names)
}

/// One reference set on disk: `tests/oracle/reference/<set>/`.
struct ReferenceSet(PathBuf);

impl ReferenceSet {
    fn new(set: &str) -> Self {
        Self(
            manifest_directory()
                .join("tests/oracle/reference")
                .join(set),
        )
    }
}

impl Files for ReferenceSet {
    fn read(&self, name: &str) -> String {
        fs::read_to_string(self.0.join(name)).unwrap_or_default()
    }
}

fn check(options: &Options) -> Result<bool, String> {
    let cases = selected(options)?;
    let library = library(&cases)?;
    let files = ReferenceSet::new(&options.set);
    let (seeds, steps) = match options.tier {
        Tier::Quick => (1, 24),
        Tier::Full => (4, 60),
    };
    let started = Instant::now();
    let references = tier::references(&library, &files, &cases);
    print!("{}", references.report);
    let reference_seconds = started.elapsed().as_secs_f64();
    let started = Instant::now();
    let differential = tier::differential(
        &library,
        &files,
        &cases,
        options.seeds.unwrap_or(seeds),
        options.steps.unwrap_or(steps),
    );
    print!("{}", differential.report);
    println!(
        "reference set `{}`; references {reference_seconds:.1}s, differential {:.1}s",
        options.set,
        started.elapsed().as_secs_f64()
    );
    Ok(references.passed && differential.passed)
}

fn fuzz(options: &Options) -> Result<bool, String> {
    let cases = selected(options)?;
    let library = library(&cases)?;
    let files = ReferenceSet::new(&options.set);
    let mut passed = true;
    for case in &cases {
        let line = format!(
            "fuzz {} {} {}",
            case.name,
            options.seed,
            options.steps.unwrap_or(40)
        );
        let answer = run::command(&library, &files, &line, "");
        passed &= !answer.starts_with("fail");
        println!("{answer}");
    }
    Ok(passed)
}

/// Writes frozen files for the selection. The reference is what later units are judged
/// against, so it takes a flag to write at all and a second one to replace a file that exists.
fn bless(options: &Options) -> Result<bool, String> {
    if !options.bless {
        return Err(format!(
            "bless writes the frozen reference later units are judged against; pass {BLESS_FLAG} to do it on purpose"
        ));
    }
    let cases = selected(options)?;
    let library = library(&cases)?;
    let files = ReferenceSet::new(&options.set);
    fs::create_dir_all(&files.0).map_err(|error| error.to_string())?;
    let mut manifest = tier::manifest(&files.read(tier::MANIFEST));
    for case in &cases {
        let path = files.0.join(tier::reference_file(&case.name));
        if path.exists() && !options.overwrite {
            continue;
        }
        let answer = run::command(&library, &files, &format!("reference {}", case.name), "");
        let Some(text) = answer.strip_prefix("ok\n") else {
            println!("not blessed {}: {}", case.name, answer.replace('\n', " "));
            continue;
        };
        if path.exists() {
            println!("REPLACING FROZEN REFERENCE {}", case.name);
        } else {
            println!("new reference {}", case.name);
        }
        fs::write(&path, text).map_err(|error| error.to_string())?;
        manifest.insert(case.name.clone(), tier::file_digest(text));
    }
    fs::write(files.0.join(tier::MANIFEST), tier::manifest_text(&manifest))
        .map_err(|error| error.to_string())?;
    println!(
        "reference set `{}` is {}",
        options.set,
        tier::set_digest(&manifest)
    );
    Ok(true)
}

/// Writes every lane of every step of the selected cases, one file per step.
fn dump(options: &Options) -> Result<bool, String> {
    let out = options.out.as_ref().ok_or("dump needs --out DIR")?;
    let cases = selected(options)?;
    let library = library(&cases)?;
    for case in &cases {
        let missing = library.missing(case.font_keys());
        if !missing.is_empty() {
            println!(
                "SKIPPED {}: missing fonts {}",
                case.name,
                missing.join(", ")
            );
            continue;
        }
        let reference = run::reference(&library, case, &[])?;
        let directory = out.join(&case.name);
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        for (index, (_, capture)) in reference.captures.iter().enumerate() {
            fs::write(directory.join(format!("{index:02}.lanes")), capture.dump())
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(true)
}

/// Compares two dump directories and prints the first differing row of every differing lane.
fn diff(options: &Options) -> Result<bool, String> {
    let [left, right] = options.positional.as_slice() else {
        return Err("diff needs two dump directories".into());
    };
    let mut same = true;
    let mut files = Vec::new();
    collect(Path::new(left), Path::new(left), &mut files)?;
    for relative in files {
        let read = |root: &str| {
            let bytes = fs::read(Path::new(root).join(&relative)).map_err(|e| e.to_string())?;
            Capture::from_dump(&bytes)
        };
        let (Ok(a), Ok(b)) = (read(left), read(right)) else {
            println!("{}: missing or unreadable on one side", relative.display());
            same = false;
            continue;
        };
        for difference in run::dump_differences(&a, &b) {
            same = false;
            println!("{}: {}", relative.display(), difference.render());
        }
    }
    Ok(same)
}

fn collect(root: &Path, directory: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let mut entries: Vec<PathBuf> = fs::read_dir(directory)
        .map_err(|error| format!("{}: {error}", directory.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            collect(root, &path, files)?;
        } else if let Ok(relative) = path.strip_prefix(root) {
            files.push(relative.to_path_buf());
        }
    }
    Ok(())
}
