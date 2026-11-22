//! BCP 47 to OpenType language-system tags, resolved here instead of inside HarfRust.
//!
//! HarfRust's own resolution is a chain of ~150 subtag tests compiled as comparison code plus a
//! 1,433-row table. The shaper builds HarfRust without it (the fork's `language-tags` feature) and
//! passes the tags through `ShapePlan::new_with_language_tags`; this module is the same resolution
//! as data. It reproduces HarfRust's `tags_from_script_and_language` language half exactly,
//! quirks included, and the differential test below proves that against HarfRust itself.

use harfrust::Tag;

mod generated {
    include!("generated/language_tag_data.rs");
}

use generated::{
    LANGUAGE_ROW_BLOCKS, LANGUAGE_ROW_COUNT, LANGUAGE_ROWS, LANGUAGE_RULES, LANGUAGE_TAGS,
    ROWS_PER_BLOCK,
};

/// `subtag_matches(language, text)`.
const RULE_SUBTAG: u8 = 0;
/// `&language[1..] == text`.
const RULE_EXACT: u8 = 1;
/// `lang_matches(&language[1..], text)`.
const RULE_LANGUAGE: u8 = 2;
/// `language[1..].starts_with(text) && subtag_matches(language, subtag)`.
const RULE_PREFIX_AND_SUBTAG: u8 = 3;

/// At most three candidate tags, best first: the capacity of HarfRust's own tag list.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct LanguageTags {
    tags: [Tag; 3],
    len: u8,
}

impl LanguageTags {
    pub(crate) fn as_slice(&self) -> &[Tag] {
        &self.tags[..usize::from(self.len)]
    }

    fn push(&mut self, tag: Tag) {
        if let Some(slot) = self.tags.get_mut(usize::from(self.len)) {
            *slot = tag;
            self.len += 1;
        }
    }
}

/// The OpenType language-system tags HarfRust would choose for `language`, which is
/// `harfrust::Language` bytes (ASCII lowercase, `-` separated).
pub(crate) fn resolve(language: &[u8]) -> LanguageTags {
    let mut tags = LanguageTags::default();
    let (private_use, prefix) = split_private_use(language);
    if !parse_private_use_tag(private_use, &mut tags) && !prefix.is_empty() {
        tags_from_language(prefix, &mut tags);
    }
    tags
}

/// HarfRust's split of a language into its `x-` private-use part and the prefix it resolves.
fn split_private_use(language: &[u8]) -> (Option<&[u8]>, &[u8]) {
    if language.starts_with(b"x-") {
        return (Some(language), b"");
    }
    let mut prefix: &[u8] = b"";
    let mut index = 1;
    while index < language.len() {
        if language[index - 1] == b'-' && language.get(index + 1) == Some(&b'-') {
            if language[index] == b'x' {
                if prefix.is_empty() {
                    prefix = &language[..index - 1];
                }
                let private_use = &language[index..];
                return (Some(private_use), prefix);
            }
            prefix = &language[..index - 1];
        }
        index += 1;
    }
    if prefix.is_empty() {
        prefix = language;
    }
    (None, prefix)
}

/// The `-hbot` private-use subtag: up to four alphanumerics after the first `-hbot`, uppercased.
fn parse_private_use_tag(private_use: Option<&[u8]>, tags: &mut LanguageTags) -> bool {
    let Some(private_use) = private_use else {
        return false;
    };
    let Some(position) = private_use.windows(5).position(|window| window == b"-hbot") else {
        return false;
    };
    let mut bytes = [b' '; 4];
    let mut len = 0;
    for &byte in private_use[position + 5..].iter().take(4) {
        if !byte.is_ascii_alphanumeric() {
            break;
        }
        bytes[len] = byte.to_ascii_uppercase();
        len += 1;
    }
    if len == 0 {
        return false;
    }
    let mut tag = u32::from_be_bytes(bytes);
    // HarfBuzz maps a tag spelling `DFLT` in any case to lowercase.
    if tag & 0xDFDF_DFDF == u32::from_be_bytes(*b"DFLT") {
        tag ^= !0xDFDF_DFDF;
    }
    tags.push(Tag::from_u32(tag));
    true
}

fn tags_from_language(language: &[u8], tags: &mut LanguageTags) {
    if tags_from_complex_language(language, tags) {
        return;
    }

    let mut sublang = language;
    if let Some(index) = language.iter().position(|&byte| byte == b'-')
        && language.len() >= 6
    {
        let extlang = match language[index + 1..].iter().position(|&byte| byte == b'-') {
            Some(end) => end == 3,
            None => language.len() - index - 1 == 3,
        };
        if extlang && language[index + 1].is_ascii_alphabetic() {
            sublang = &language[index + 1..];
        }
    }

    let word_end = sublang
        .iter()
        .position(|&byte| byte == b'-' || byte == 0)
        .unwrap_or(sublang.len());
    if let Some(key) = simple_key(&sublang[..word_end])
        && table_tags(key, tags)
    {
        return;
    }

    if let [a, b, c] = *language {
        tags.push(Tag::new(&[
            a.to_ascii_uppercase(),
            b.to_ascii_uppercase(),
            c.to_ascii_uppercase(),
            b' ',
        ]));
    }
}

/// `word` as a `SIMPLE_KEYS` value when it could equal a table key: one to three lowercase letters.
fn simple_key(word: &[u8]) -> Option<u16> {
    if word.is_empty() || word.len() > 3 || !word.iter().all(u8::is_ascii_lowercase) {
        return None;
    }
    let mut key = 0u16;
    for index in 0..3 {
        key = key * 27
            + word
                .get(index)
                .map_or(0, |&byte| u16::from(byte - b'a' + 1));
    }
    Some(key)
}

/// The `OPEN_TYPE_LANGUAGES` rows for `key`, as HarfRust's binary search reads them. Returns
/// whether `key` has a row, which ends resolution even when the row's tag is null.
fn table_tags(key: u16, tags: &mut LanguageTags) -> bool {
    // The last block whose preceding row sorts before `key` holds the first row for `key`, if any.
    let block = LANGUAGE_ROW_BLOCKS
        .partition_point(|&(previous, _)| previous < key)
        .saturating_sub(1);
    let (mut current, offset) = LANGUAGE_ROW_BLOCKS[block];
    let mut rows = &LANGUAGE_ROWS[usize::from(offset)..];
    let mut end = None;
    for row in block * ROWS_PER_BLOCK..LANGUAGE_ROW_COUNT {
        current += read_varint(&mut rows);
        let tag = LANGUAGE_TAGS[usize::from(read_varint(&mut rows))];
        if current > key {
            break;
        }
        if current == key {
            // HarfRust bounds the run by `rows - first - 1`, so the last table row yields no tag.
            let end = *end.get_or_insert(row + (LANGUAGE_ROW_COUNT - row - 1).min(3));
            if row >= end || tag == 0 {
                break;
            }
            tags.push(Tag::from_u32(tag));
        }
    }
    end.is_some()
}

/// A little-endian base-128 varint from the front of `bytes`. The generated streams hold no
/// value above `u16::MAX`.
fn read_varint(bytes: &mut &[u8]) -> u16 {
    let mut value = 0;
    let mut shift = 0;
    while let Some((&byte, rest)) = bytes.split_first() {
        *bytes = rest;
        value |= u16::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    value
}

/// One `tags_from_complex_language` test decoded from `LANGUAGE_RULES`.
struct LanguageRule {
    kind: u8,
    first: u8,
    text: &'static [u8],
    subtag: &'static [u8],
    tags: &'static [u8],
}

fn language_rules() -> impl Iterator<Item = LanguageRule> {
    let mut rules = LANGUAGE_RULES;
    core::iter::from_fn(move || {
        let (&[header, first, text_len], rest) = rules.split_first_chunk::<3>()?;
        let kind = header & 3;
        let (subtag_len, rest) = match kind {
            RULE_PREFIX_AND_SUBTAG => rest.split_first().map(|(&len, rest)| (len, rest))?,
            _ => (0, rest),
        };
        let (text, rest) = rest.split_at(usize::from(text_len));
        let (subtag, rest) = rest.split_at(usize::from(subtag_len));
        let (tags, rest) = rest.split_at(4 * (usize::from(header >> 2) + 1));
        rules = rest;
        Some(LanguageRule {
            kind,
            first,
            text,
            subtag,
            tags,
        })
    })
}

fn tags_from_complex_language(language: &[u8], tags: &mut LanguageTags) -> bool {
    let Some((&first, rest)) = language.split_first() else {
        return false;
    };
    for rule in language_rules() {
        if rule_matches(&rule, language, first, rest) {
            for tag in rule.tags.chunks_exact(4) {
                tags.push(Tag::new(&[tag[0], tag[1], tag[2], tag[3]]));
            }
            return true;
        }
    }
    false
}

fn rule_matches(rule: &LanguageRule, language: &[u8], first: u8, rest: &[u8]) -> bool {
    let text = rule.text;
    match rule.kind {
        RULE_SUBTAG => subtag_matches(language, text),
        _ if first != rule.first => false,
        RULE_EXACT => rest == text,
        RULE_LANGUAGE => {
            rest.starts_with(text) && (rest.len() == text.len() || rest[text.len()] == b'-')
        }
        _ => rest.starts_with(text) && subtag_matches(language, rule.subtag),
    }
}

/// Whether `subtag` occurs in `language` with no alphanumeric right after it.
fn subtag_matches(language: &[u8], subtag: &[u8]) -> bool {
    language
        .windows(subtag.len())
        .enumerate()
        .any(|(index, window)| {
            window == subtag
                && language
                    .get(index + subtag.len())
                    .is_none_or(|byte| !byte.is_ascii_alphanumeric())
        })
}

#[cfg(test)]
mod tests {
    use alloc::{format, string::String, vec::Vec};

    use harfrust::Language;

    use super::*;

    fn assert_matches_harfrust(input: &str) {
        let Some(language) = Language::new(input) else {
            return;
        };
        let expected = harfrust::opentype_language_tags(&language);
        let actual = resolve(language.as_bytes());
        assert_eq!(actual.as_slice(), expected.as_slice(), "language {input:?}");
    }

    /// Every rule's text, every table key and the subtags HarfRust's resolution branches on.
    fn known_subtags() -> Vec<String> {
        let mut subtags: Vec<String> = Vec::new();
        for rule in language_rules() {
            let text = String::from_utf8(rule.text.to_vec()).unwrap();
            let first = char::from(rule.first);
            subtags.push(if rule.kind == RULE_SUBTAG {
                format!("und{text}")
            } else {
                format!("{first}{text}")
            });
            if rule.kind == RULE_PREFIX_AND_SUBTAG {
                let subtag = String::from_utf8(rule.subtag.to_vec()).unwrap();
                subtags.push(format!("{first}{text}x{subtag}"));
                subtags.push(format!("{first}{text}{}", &subtag[1..]));
            }
        }
        for key in table_keys() {
            let mut word = String::new();
            for divisor in [729, 27, 1] {
                let digit = (key / divisor) % 27;
                if digit != 0 {
                    word.push(char::from(b'a' + digit as u8 - 1));
                }
            }
            subtags.push(word);
        }
        subtags
    }

    #[test]
    fn every_short_word_matches_harfrust() {
        let letters = b'a'..=b'z';
        for a in letters.clone() {
            assert_matches_harfrust(&String::from_utf8(alloc::vec![a]).unwrap());
            for b in letters.clone() {
                assert_matches_harfrust(&String::from_utf8(alloc::vec![a, b]).unwrap());
                for c in letters.clone() {
                    assert_matches_harfrust(&String::from_utf8(alloc::vec![a, b, c]).unwrap());
                }
            }
        }
    }

    #[test]
    fn every_known_subtag_in_context_matches_harfrust() {
        let subtags = known_subtags();
        let suffixes = [
            "",
            "-",
            "-hant",
            "-hans",
            "-hk",
            "-mo",
            "-tw",
            "-latn",
            "-cyrl",
            "-x-hbotabcd",
            "-x-hbscarab",
            "-x-hbot-",
            "-x",
            "-a-b",
            "-1",
            "-fonipa",
            "-polyton",
            "-yue",
            "-cmn-hant",
            "-x-foo-hbotzht",
            "-u-co-x-hbotdflt",
            "-hantx",
            "-hk1",
            "-hka",
            "-moa",
            "-twn",
        ];
        for subtag in &subtags {
            for suffix in suffixes {
                assert_matches_harfrust(&format!("{subtag}{suffix}"));
                assert_matches_harfrust(&format!("zh-{subtag}{suffix}"));
                assert_matches_harfrust(&format!("x-{subtag}{suffix}"));
            }
            // A table key as an extended language subtag after any primary.
            if subtag.len() == 3 {
                assert_matches_harfrust(&format!("ar-{subtag}"));
                assert_matches_harfrust(&format!("ar-{subtag}-eg"));
            }
            // Truncations reach the near misses of every `lang_matches` and exact rule.
            for end in 1..subtag.len() {
                assert_matches_harfrust(&subtag[..end]);
            }
        }
    }

    #[test]
    fn private_use_and_irregular_forms_match_harfrust() {
        for input in [
            "x",
            "i",
            "i-a",
            "i-hak",
            "i-navajo",
            "i-lux",
            "x-hbotzht",
            "x-hbot",
            "x-hbot1",
            "x-hbotdflt",
            "x-hbotDFLT",
            "en-x-hbotzzzz-hbscarab",
            "en-x-hbscarab",
            "en-x-hbot-zh",
            "en-a-x-hbotabc",
            "art-lojban",
            "zh-min-nan",
            "zh-min",
            "no-bok",
            "no-nyn",
            "sgn-be-fr",
            "zh-hant-mo",
            "cdo-hant-mo-x-y",
            "und-fonnapa",
            "und-syrn-x-hbotsyr",
            "en_US",
            "EN-gb",
            "a-b-c-d-e-f-g",
            "zz",
            "zza",
            "zzj",
            "zzzz",
            "abcdefgh-12345678",
        ] {
            assert_matches_harfrust(input);
        }
    }

    #[test]
    fn random_tags_match_harfrust() {
        let subtags = known_subtags();
        let alphabet = b"abcdefghijklmnopqrstuvwxyz0123456789";
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        let mut next = |bound: usize| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state % bound as u64) as usize
        };
        for _ in 0..200_000 {
            let mut input = String::new();
            for part in 0..1 + next(5) {
                if part > 0 {
                    input.push('-');
                }
                match next(4) {
                    0 => input.push_str(&subtags[next(subtags.len())]),
                    1 => input.push('x'),
                    _ => {
                        for _ in 0..1 + next(8) {
                            input.push(char::from(alphabet[next(alphabet.len())]));
                        }
                    }
                }
            }
            assert_matches_harfrust(&input);
        }
    }

    #[test]
    fn resolves_multi_tag_and_fallback_languages() {
        let tags = |input: &str| resolve(Language::new(input).unwrap().as_bytes());
        assert_eq!(
            tags("zh-Hant-MO").as_slice(),
            [Tag::new(b"ZHTM"), Tag::new(b"ZHH ")]
        );
        assert_eq!(tags("zh-Hant").as_slice(), [Tag::new(b"ZHT ")]);
        assert_eq!(tags("en").as_slice(), [Tag::new(b"ENG ")]);
        assert_eq!(tags("i-a").as_slice(), [Tag::new(b"I-A ")]);
        assert_eq!(tags("en-x-hbotabc").as_slice(), [Tag::new(b"ABC ")]);
        assert!(tags("aba").as_slice().is_empty());
    }

    fn table_keys() -> Vec<u16> {
        let mut rows = LANGUAGE_ROWS;
        let mut key = 0;
        let keys: Vec<u16> = (0..LANGUAGE_ROW_COUNT)
            .map(|_| {
                key += read_varint(&mut rows);
                read_varint(&mut rows);
                key
            })
            .collect();
        assert!(rows.is_empty());
        keys
    }

    #[test]
    fn generated_streams_decode_completely() {
        let keys = table_keys();
        assert!(keys.windows(2).all(|pair| pair[0] <= pair[1]));
        for (block, &(previous, _)) in LANGUAGE_ROW_BLOCKS.iter().enumerate() {
            let expected = block
                .checked_sub(1)
                .map_or(0, |_| keys[block * ROWS_PER_BLOCK - 1]);
            assert_eq!(previous, expected);
        }
        assert_eq!(language_rules().count(), 148);
        assert!(language_rules().all(|rule| matches!(rule.tags.len(), 4 | 8)));
    }
}
