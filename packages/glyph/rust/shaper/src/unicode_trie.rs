//! Three-stage code-point tries, the shape of the generated Unicode tables.
//!
//! A code point's high bits pick a middle block in the root, its middle bits a leaf in that block,
//! and its low bits an entry in the leaf. Deduplicating both the leaves and the middle blocks keeps
//! the mostly unassigned supplementary planes to a few shared blocks.
//! `scripts/support/code-point-trie.mjs` builds the tables and round-trips every code point
//! through this lookup before writing them.

/// The leaf entry of `code_point`, which must be at most U+10FFFF.
#[inline(always)]
pub(crate) fn lookup<Root: Copy + Into<usize>, Middle: Copy + Into<usize>>(
    root: &[Root],
    middle: &[Middle],
    leaves: &[u8],
    leaf_shift: u32,
    middle_shift: u32,
    code_point: u32,
) -> u8 {
    let code_point = code_point as usize;
    let block: usize = root[code_point >> (leaf_shift + middle_shift)].into();
    let middle_index = (block << middle_shift) | ((code_point >> leaf_shift) & mask(middle_shift));
    let leaf: usize = middle[middle_index].into();
    leaves[(leaf << leaf_shift) | (code_point & mask(leaf_shift))]
}

#[inline(always)]
const fn mask(shift: u32) -> usize {
    (1 << shift) - 1
}

#[cfg(test)]
mod tests {
    extern crate std;

    use alloc::{format, string::String, vec::Vec};
    use std::io::Read;

    use unicode_bidi::BidiDataSource;

    use crate::{bidi, line_break, unicode};

    /// The results of the two-stage tables these tries replaced, as `start value` runs per lookup
    /// over every code point (`-` where the lookup takes no surrogate). Frozen from the old lookup
    /// functions before the re-encoding.
    fn two_stage_runs() -> Vec<(String, Vec<(u32, String)>)> {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/unicode-17.0.0/two-stage-lookups.txt.gz");
        let mut source = String::new();
        flate2::read::GzDecoder::new(std::fs::File::open(path).expect("open lookup fixture"))
            .read_to_string(&mut source)
            .expect("decode lookup fixture");
        let mut sections: Vec<(String, Vec<(u32, String)>)> = Vec::new();
        for line in source.lines() {
            if let Some(name) = line.strip_prefix("# ") {
                sections.push((name.into(), Vec::new()));
                continue;
            }
            let (start, value) = line.split_once(' ').expect("run line");
            let start = u32::from_str_radix(start, 16).expect("run start");
            sections
                .last_mut()
                .expect("section")
                .1
                .push((start, value.into()));
        }
        sections
    }

    fn render(lookup: &str, code_point: u32) -> String {
        match lookup {
            "script" => format!("{:x}", unicode::script(code_point).unwrap()),
            "script_extensions" => unicode::script_extensions(code_point)
                .unwrap()
                .iter()
                .map(|tag| format!("{tag:x}"))
                .collect::<Vec<_>>()
                .join(","),
            // The two-stage tables predate the `ALPHANUMERIC` bit, which has its own exhaustive test.
            "line_break" => format!(
                "{:x}",
                line_break::properties(code_point).unwrap() & !line_break::ALPHANUMERIC
            ),
            "bidi_class" => char::from_u32(code_point).map_or_else(
                || "-".into(),
                |character| {
                    format!(
                        "{}",
                        bidi::class_code(bidi::Unicode17BidiData.bidi_class(character))
                    )
                },
            ),
            _ => unreachable!("unknown lookup {lookup}"),
        }
    }

    /// Every lookup the tries back returns what the two-stage tables returned, for all 0x110000
    /// code points.
    #[test]
    fn tries_equal_the_two_stage_tables_for_every_code_point() {
        let sections = two_stage_runs();
        assert_eq!(sections.len(), 4);
        for (lookup, runs) in &sections {
            assert_eq!(runs[0].0, 0, "{lookup}");
            for (index, (start, expected)) in runs.iter().enumerate() {
                let end = runs.get(index + 1).map_or(0x11_0000, |run| run.0);
                for code_point in *start..end {
                    assert_eq!(
                        &render(lookup, code_point),
                        expected,
                        "{lookup} of U+{code_point:04X}"
                    );
                }
            }
        }
        assert_eq!(unicode::script(0x11_0000), None);
        assert_eq!(unicode::script_extensions(0x11_0000), None);
        assert_eq!(line_break::properties(0x11_0000), None);
    }
}
