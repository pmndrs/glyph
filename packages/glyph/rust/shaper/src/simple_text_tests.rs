//! The simple-text path against HarfRust on every font the repository and the adversarial set
//! hold. `with_shaped_range` shapes each item the path accepts a second time with HarfRust and
//! panics on any difference, so a test proves equality by shaping; the assertions here pin what
//! the path must refuse.

use super::*;
use engine::work_attribution;
use std::{
    env, fs,
    path::{Path, PathBuf},
    string::String,
    vec,
};

const LATN: u32 = u32::from_be_bytes(*b"Latn");
const ZYYY: u32 = u32::from_be_bytes(*b"Zyyy");

struct Fixture {
    name: String,
    registry: ShaperRegistry,
    /// Every BMP scalar the font's `cmap` maps, plus a few it may not.
    characters: Vec<u16>,
}

fn font_files(root: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            font_files(&path, files);
        } else if matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some("ttf" | "otf" | "sfnt")
        ) {
            files.push(path);
        }
    }
}

/// The fonts under `roots` that register, each in its own registry.
fn fixtures(roots: &[PathBuf]) -> Vec<Fixture> {
    let mut files = Vec::new();
    for root in roots {
        font_files(root, &mut files);
    }
    files.sort();
    let mut fixtures = Vec::new();
    for path in files {
        let sfnt = fs::read(&path).expect("font file reads");
        let Ok(font) = FontRef::new(&sfnt) else {
            continue;
        };
        let Ok(glyph_count) = font.maxp().map(|maxp| usize::from(maxp.num_glyphs())) else {
            continue;
        };
        let mut registry = ShaperRegistry::default();
        let extents = vec![0_u8; glyph_count * 8];
        let availability = vec![0_u8; glyph_count.div_ceil(8)];
        if registry.register_font(1, &sfnt, &extents, &availability, 0, 0) != STATUS_OK {
            continue;
        }
        let cmap = font.cmap().ok();
        let mut characters: Vec<u16> = (0..=u16::MAX)
            .filter(|unit| !(0xD800..=0xDFFF).contains(unit))
            .filter(|unit| {
                cmap.as_ref()
                    .is_some_and(|cmap| cmap.map_codepoint(u32::from(*unit)).is_some())
            })
            .collect();
        // Characters shaping treats specially whether or not the font maps them: controls,
        // marks, joiners, spaces and letters a font may lack and the normaliser then decomposes
        // or replaces, an unassigned scalar, a private-use one and a noncharacter.
        characters.extend([
            0x0009, 0x000A, 0x000D, 0x00A0, 0x00AD, 0x00C5, 0x0301, 0x034F, 0x0378, 0x1E9E, 0x2003,
            0x2010, 0x2011, 0x200B, 0x200C, 0x200D, 0x2028, 0x2044, 0x212B, 0xAC01, 0xE000, 0xFE0F,
            0xFF9E, 0xFFFD, 0xFFFF,
        ]);
        characters.sort_unstable();
        characters.dedup();
        fixtures.push(Fixture {
            name: path.display().to_string(),
            registry,
            characters,
        });
    }
    fixtures
}

fn repository_roots() -> Vec<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    vec![
        manifest.join("../../../../benches/fixtures/fonts"),
        manifest.join("../../../../vendor/harfrust-parity/fonts"),
        manifest.join("src/engine/adversarial-fonts"),
    ]
}

fn adversarial_roots() -> Vec<PathBuf> {
    env::var_os("GLYPH_ADVERSARIAL_FONTS")
        .map(PathBuf::from)
        .into_iter()
        .collect()
}

#[derive(Clone, Copy)]
struct Plan<'a> {
    script: u32,
    direction: u8,
    features: &'a [FeatureRecord],
}

/// Shapes `units[item]` with the rest of `units` as context and says whether the simple path
/// took it. The shaping itself asserts equality with HarfRust.
fn shape(
    registry: &mut ShaperRegistry,
    units: &[u16],
    item: core::ops::Range<usize>,
    plan: Plan<'_>,
    flags: u32,
) -> bool {
    let end = u32::try_from(units.len()).unwrap();
    let before = work_attribution::snapshot().simple_text_calls;
    registry
        .with_shaped_range(
            1,
            units,
            ShapeRunRef {
                text_start: 0,
                text_end: end,
                script: plan.script,
                language: None,
                features: plan.features,
                direction: plan.direction,
                cluster_level: 0,
                flags,
            },
            ShapeRangeRef {
                item_start: u32::try_from(item.start).unwrap(),
                item_end: u32::try_from(item.end).unwrap(),
                context_start: 0,
                context_end: end,
                flags,
            },
            |_| Ok(()),
        )
        .expect("fixture text shapes");
    work_attribution::snapshot().simple_text_calls != before
}

struct Random(u64);

impl Random {
    fn below(&mut self, bound: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % bound as u64) as usize
    }
}

const KERN_OFF: [FeatureRecord; 1] = [FeatureRecord {
    tag: u32::from_be_bytes(*b"kern"),
    value: 0,
    start: 0,
    end: u32::MAX,
}];
const OPTIONAL_ON: [FeatureRecord; 4] = [
    FeatureRecord {
        tag: u32::from_be_bytes(*b"dlig"),
        value: 1,
        start: 0,
        end: u32::MAX,
    },
    FeatureRecord {
        tag: u32::from_be_bytes(*b"ss01"),
        value: 1,
        start: 0,
        end: u32::MAX,
    },
    FeatureRecord {
        tag: u32::from_be_bytes(*b"zero"),
        value: 1,
        start: 0,
        end: u32::MAX,
    },
    // A ranged feature: masks differ per glyph.
    FeatureRecord {
        tag: u32::from_be_bytes(*b"smcp"),
        value: 1,
        start: 1,
        end: 3,
    },
];

/// Every character alone, then seeded sequences of accepted characters (alone, and as an item
/// inside context the path would refuse), then sequences mixing in refused characters. Returns
/// whether the plan accepts any character of the font.
fn exercise(fixture: &mut Fixture, plan: Plan<'_>, seed: u64) -> bool {
    let registry = &mut fixture.registry;
    let mut simple = Vec::new();
    let mut refused = Vec::new();
    for &unit in &fixture.characters {
        if shape(registry, &[unit], 0..1, plan, 0x40) {
            simple.push(unit);
        } else {
            refused.push(unit);
        }
    }
    if simple.is_empty() {
        return false;
    }
    let mut random = Random(seed | 1);
    for round in 0..600 {
        let length = 1 + random.below(24);
        let mut units: Vec<u16> = (0..length)
            .map(|_| simple[random.below(simple.len())])
            .collect();
        let flags = [0x40, 0x43, 0x00, 0x41][round % 4];
        assert!(
            shape(registry, &units, 0..length, plan, flags),
            "{}: a sequence of simple characters was refused",
            fixture.name
        );
        if refused.is_empty() {
            continue;
        }
        // The same item between characters the font has rules for: context is not shaped.
        let lead = refused[random.below(refused.len())];
        let trail = refused[random.below(refused.len())];
        let mut framed = vec![lead];
        framed.extend_from_slice(&units);
        framed.push(trail);
        assert!(
            shape(registry, &framed, 1..length + 1, plan, 0x40),
            "{}: context changed what the simple path accepts",
            fixture.name
        );
        // One refused character anywhere refuses the whole item.
        let at = random.below(length);
        units[at] = refused[random.below(refused.len())];
        assert!(
            !shape(registry, &units, 0..length, plan, flags),
            "{}: an item holding U+{:04X} was accepted",
            fixture.name,
            units[at]
        );
    }
    true
}

fn exercise_all(fixtures: &mut [Fixture]) {
    for (index, fixture) in fixtures.iter_mut().enumerate() {
        for (plan_index, plan) in [
            Plan {
                script: LATN,
                direction: 0,
                features: &[],
            },
            Plan {
                script: ZYYY,
                direction: 0,
                features: &[],
            },
            Plan {
                script: LATN,
                direction: 0,
                features: &KERN_OFF,
            },
            Plan {
                script: LATN,
                direction: 0,
                features: &OPTIONAL_ON,
            },
        ]
        .into_iter()
        .enumerate()
        {
            let seed = 0x9E37_79B9_7F4A_7C15_u64
                .wrapping_mul(index as u64 + 1)
                .wrapping_add(plan_index as u64);
            exercise(fixture, plan, seed);
        }
        // Scripts with their own shapers: HarfRust picks the shaper per font, so these only
        // have to agree with it, whichever way the plan goes.
        for (script_index, script) in [b"Arab", b"Hebr", b"Deva", b"Hang", b"Thai", b"Grek"]
            .into_iter()
            .enumerate()
        {
            let plan = Plan {
                script: u32::from_be_bytes(*script),
                direction: 0,
                features: &[],
            };
            exercise(fixture, plan, 0xA5A5_0000 + script_index as u64);
        }
        // Right-to-left text reorders and mirrors: no character is simple.
        let rtl = Plan {
            script: LATN,
            direction: 1,
            features: &[],
        };
        let units = fixture.characters.clone();
        for &unit in &units {
            assert!(
                !shape(&mut fixture.registry, &[unit], 0..1, rtl, 0x40),
                "{}: U+{unit:04X} accepted right-to-left",
                fixture.name
            );
        }
        // Marks, joiners, variation selectors and the fraction slash are never simple.
        let latin = Plan {
            script: LATN,
            direction: 0,
            features: &[],
        };
        for unit in [
            0x00AD, 0x0301, 0x034F, 0x200B, 0x200C, 0x200D, 0x2044, 0xFE0F, 0xFF9E,
        ] {
            assert!(!shape(&mut fixture.registry, &[unit], 0..1, latin, 0x40));
            assert!(!shape(
                &mut fixture.registry,
                &[0x41, unit],
                0..2,
                latin,
                0x40
            ));
        }
        // A surrogate pair is outside the table.
        assert!(!shape(
            &mut fixture.registry,
            &[0xD83D, 0xDE00],
            0..2,
            latin,
            0x40
        ));
    }
}

fn fixture<'a>(fixtures: &'a mut [Fixture], name: &str) -> &'a mut Fixture {
    fixtures
        .iter_mut()
        .find(|fixture| fixture.name.ends_with(name))
        .unwrap_or_else(|| panic!("{name} is a fixture"))
}

fn accepts(fixture: &mut Fixture, text: &str, features: &[FeatureRecord]) -> bool {
    let units: Vec<u16> = text.encode_utf16().collect();
    let plan = Plan {
        script: LATN,
        direction: 0,
        features,
    };
    shape(&mut fixture.registry, &units, 0..units.len(), plan, 0x40)
}

#[test]
fn simple_text_equals_harfrust_on_repository_fonts() {
    let mut fixtures = fixtures(&repository_roots());
    assert!(fixtures.len() >= 12, "only {} fonts found", fixtures.len());
    exercise_all(&mut fixtures);

    // The equality runs above are not vacuous: a pixel font with no rules on its Latin and
    // kana accepts whole lines.
    let plain = fixture(&mut fixtures, "DotGothic16-Regular.ttf");
    let latin = Plan {
        script: LATN,
        direction: 0,
        features: &[],
    };
    assert!(exercise(plain, latin, 11));
    for text in [
        "Hello, world.",
        ".:+*#%@ .:+*#%@",
        "\u{30A2}\u{30A4}\u{30A6} abc",
    ] {
        assert!(accepts(plain, text, &[]), "DotGothic16: {text:?}");
    }

    // Legacy `kern` reaches every glyph of a buffer: such a font has no simple character.
    for name in [
        "CherryCreamSoda-Regular.ttf",
        "Syncopate-Regular-kernonly-SYNTH.ttf",
    ] {
        let font = fixture(&mut fixtures, name);
        for text in ["A", " ", ".", "AV", "o o"] {
            assert!(!accepts(font, text, &[]), "{name}: {text:?}");
            assert!(!accepts(font, text, &KERN_OFF), "{name}: {text:?}");
        }
    }
    // Inter kerns its letters and has contextual rules on punctuation and digits.
    let inter = fixture(&mut fixtures, "Inter-Regular.ttf");
    for text in [
        "A", "V", "T", "o", "f", "1", ":", "-", "AV", "To", "fi", "1:2",
    ] {
        assert!(!accepts(inter, text, &[]), "Inter: {text:?}");
    }
    // Dancing Script joins its letters cursively.
    let dancing = fixture(&mut fixtures, "DancingScript-Regular.otf");
    for text in ["a", "o", "n", "on"] {
        assert!(!accepts(dancing, text, &[]), "Dancing Script: {text:?}");
    }
}

#[test]
fn simple_text_equals_harfrust_on_adversarial_fonts() {
    let roots = adversarial_roots();
    if roots.is_empty() {
        std::eprintln!("skipped: GLYPH_ADVERSARIAL_FONTS is unset");
        return;
    }
    let mut fixtures = fixtures(&roots);
    assert!(fixtures.len() >= 10, "only {} fonts found", fixtures.len());
    exercise_all(&mut fixtures);

    // Fira Code builds its ligatures from contextual rules on ASCII punctuation.
    let fira = fixture(&mut fixtures, "fira-code/FiraCode-Regular.ttf");
    for text in ["-", ">", "=", "!", "->", "=>", "!=", "www", "a->b"] {
        assert!(!accepts(fira, text, &[]), "Fira Code: {text:?}");
    }
    let kern_only = fixture(&mut fixtures, "CherryCreamSoda-Regular.ttf");
    for text in ["A", " ", "AV"] {
        assert!(
            !accepts(kern_only, text, &[]),
            "Cherry Cream Soda: {text:?}"
        );
    }
    // EB Garamond kerns and ligates its letters.
    let garamond = fixture(&mut fixtures, "EBGaramond-static-default-SYNTH.ttf");
    for text in ["A", "V", "f", "fi", "Th"] {
        assert!(!accepts(garamond, text, &[]), "EB Garamond: {text:?}");
    }
}

/// `sfnt` with `table` added, or replacing the table of that tag.
fn with_table(sfnt: &[u8], tag: [u8; 4], table: &[u8]) -> Vec<u8> {
    let u16_at = |at: usize| usize::from(u16::from_be_bytes([sfnt[at], sfnt[at + 1]]));
    let u32_at = |at: usize| {
        u32::from_be_bytes([sfnt[at], sfnt[at + 1], sfnt[at + 2], sfnt[at + 3]]) as usize
    };
    let mut tables: Vec<([u8; 4], Vec<u8>)> = (0..u16_at(4))
        .map(|index| {
            let record = 12 + index * 16;
            let (offset, length) = (u32_at(record + 8), u32_at(record + 12));
            let tag = [
                sfnt[record],
                sfnt[record + 1],
                sfnt[record + 2],
                sfnt[record + 3],
            ];
            (tag, sfnt[offset..offset + length].to_vec())
        })
        .filter(|(existing, _)| *existing != tag)
        .collect();
    tables.push((tag, table.to_vec()));
    tables.sort();
    let mut out = sfnt[..4].to_vec();
    out.extend_from_slice(&u16::try_from(tables.len()).unwrap().to_be_bytes());
    out.extend_from_slice(&[0; 6]);
    let mut offset = 12 + tables.len() * 16;
    for (tag, data) in &tables {
        out.extend_from_slice(tag);
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&u32::try_from(offset).unwrap().to_be_bytes());
        out.extend_from_slice(&u32::try_from(data.len()).unwrap().to_be_bytes());
        offset += data.len().next_multiple_of(4);
    }
    for (_, data) in &tables {
        out.extend_from_slice(data);
        out.resize(out.len().next_multiple_of(4), 0);
    }
    out
}

fn advances(registry: &mut ShaperRegistry, unit: u16) -> Vec<i32> {
    registry
        .with_shaped_run(
            1,
            &[unit],
            ShapeRunRef {
                text_start: 0,
                text_end: 1,
                script: LATN,
                language: None,
                features: &[],
                direction: 0,
                cluster_level: 0,
                flags: 0x40,
            },
            |glyphs| {
                Ok(glyphs
                    .glyph_positions()
                    .iter()
                    .map(|position| position.x_advance)
                    .collect())
            },
        )
        .expect("fixture text shapes")
}

// GDEF can class a glyph as a mark whatever character maps to it, and the shaper then zeroes its
// advance. No fixture font does that to a letter, so this one is patched to.
#[test]
fn a_glyph_gdef_classes_as_a_mark_is_not_simple() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../benches/fixtures/fonts/fredoka-issue-216/Fredoka-Regular.ttf");
    let sfnt = fs::read(path).expect("font file reads");
    let font = FontRef::new(&sfnt).unwrap();
    let glyph_count = usize::from(font.maxp().unwrap().num_glyphs());
    let plan = Plan {
        script: LATN,
        direction: 0,
        features: &KERN_OFF,
    };
    let register = |sfnt: &[u8]| {
        let mut registry = ShaperRegistry::default();
        let extents = vec![0_u8; glyph_count * 8];
        let availability = vec![0_u8; glyph_count.div_ceil(8)];
        assert_eq!(
            registry.register_font(1, sfnt, &extents, &availability, 0, 0),
            STATUS_OK
        );
        registry
    };
    let mut plain = register(&sfnt);
    // Two letters the unpatched font shapes simply once kerning is off.
    let simple: Vec<u16> = (0x41..=0x7A_u16)
        .filter(|unit| shape(&mut plain, &[*unit], 0..1, plan, 0x40))
        .take(2)
        .collect();
    let [marked, other] = simple[..] else {
        panic!("Fredoka has two simple letters without kerning");
    };
    let width = advances(&mut plain, marked);
    assert_ne!(width, [0]);

    let glyph = font
        .cmap()
        .unwrap()
        .map_codepoint(u32::from(marked))
        .unwrap();
    let glyph = u16::try_from(glyph.to_u32()).unwrap().to_be_bytes();
    // GDEF 1.0 whose only table is a class definition: one range, class 3 (mark).
    let mut gdef = vec![0, 1, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0];
    gdef.extend_from_slice(&[0, 2, 0, 1, glyph[0], glyph[1], glyph[0], glyph[1], 0, 3]);
    let mut patched = register(&with_table(&sfnt, *b"GDEF", &gdef));
    assert_eq!(advances(&mut patched, marked), [0]);
    assert!(!shape(&mut patched, &[marked], 0..1, plan, 0x40));
    assert!(!shape(&mut patched, &[other, marked], 0..2, plan, 0x40));
    assert!(shape(&mut patched, &[other], 0..1, plan, 0x40));
}
