use pmndrs_text_font_baker::{BakeDescriptorV0, bake_font};
use std::{env, fs, path::PathBuf, process};

const DEFAULT_SEED: u32 = 0x504d_4e44;
const DEFAULT_RUNS: usize = 10_000;

fn main() {
    if let Err(error) = run() {
        eprintln!("fuzz-bake: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut arguments = env::args_os().skip(1);
    let mut source_path = None;
    let mut runs = DEFAULT_RUNS;
    let mut seed = DEFAULT_SEED;
    while let Some(argument) = arguments.next() {
        if argument == "--source" {
            source_path = Some(PathBuf::from(
                arguments.next().ok_or("--source requires a path")?,
            ));
        } else if argument == "--runs" {
            runs = parse_positive(arguments.next(), "--runs")?;
        } else if argument == "--seed" {
            seed = parse_u32(arguments.next(), "--seed")?;
        } else {
            return Err(format!(
                "unexpected argument {}",
                argument.to_string_lossy()
            ));
        }
    }
    let source_path = source_path.ok_or("--source is required")?;
    let source = fs::read(&source_path).map_err(|error| error.to_string())?;
    if source.len() < 8 {
        return Err("source must contain at least eight bytes".into());
    }

    let mut random = XorShift32(seed);
    let mut accepted = 0;
    let mut rejected = 0;
    for case in 0..runs {
        let mutated = mutate(&source, &mut random, case % 7);
        match bake_font(&mutated, BakeDescriptorV0::new(0)) {
            Ok(_) => accepted += 1,
            Err(_) => rejected += 1,
        }
    }
    println!(r#"{{"seed":{seed},"runs":{runs},"accepted":{accepted},"rejected":{rejected}}}"#);
    Ok(())
}

fn mutate(source: &[u8], random: &mut XorShift32, mode: usize) -> Vec<u8> {
    match mode {
        0 => {
            let mut bytes = source.to_vec();
            let offset = random.index(bytes.len());
            bytes[offset] ^= 1 << (random.next() & 7);
            bytes
        }
        1 => source[..random.index(source.len())].to_vec(),
        2 => {
            let mut bytes = source.to_vec();
            let offset = random.index(bytes.len() - 3);
            bytes[offset..offset + 4].copy_from_slice(&random.next().to_le_bytes());
            bytes
        }
        3 => {
            let offset = random.index(source.len() + 1);
            let length = 1 + random.index(16);
            let mut bytes = Vec::with_capacity(source.len() + length);
            bytes.extend_from_slice(&source[..offset]);
            bytes.extend((0..length).map(|_| random.next() as u8));
            bytes.extend_from_slice(&source[offset..]);
            bytes
        }
        4 => {
            let start = random.index(source.len());
            let length = (1 + random.index(32)).min(source.len() - start);
            let mut bytes = Vec::with_capacity(source.len() - length);
            bytes.extend_from_slice(&source[..start]);
            bytes.extend_from_slice(&source[start + length..]);
            bytes
        }
        5 => {
            let mut bytes = source.to_vec();
            let start = random.index(bytes.len());
            let length = (1 + random.index(32)).min(bytes.len() - start);
            bytes[start..start + length].fill(random.next() as u8);
            bytes
        }
        _ => source.to_vec(),
    }
}

fn parse_positive(value: Option<std::ffi::OsString>, name: &str) -> Result<usize, String> {
    let result = value
        .ok_or_else(|| format!("{name} requires a value"))?
        .to_string_lossy()
        .parse::<usize>()
        .map_err(|_| format!("{name} must be a positive integer"))?;
    if result == 0 {
        return Err(format!("{name} must be a positive integer"));
    }
    Ok(result)
}

fn parse_u32(value: Option<std::ffi::OsString>, name: &str) -> Result<u32, String> {
    value
        .ok_or_else(|| format!("{name} requires a value"))?
        .to_string_lossy()
        .parse::<u32>()
        .map_err(|_| format!("{name} must be a u32 integer"))
}

struct XorShift32(u32);

impl XorShift32 {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }

    fn index(&mut self, length: usize) -> usize {
        self.next() as usize % length
    }
}
