//! The OpenType layout features a bake keeps.
//!
//! A bake starts from [`COMMON_LAYOUT_FEATURES`] (hb-subset's default list) or, with `*`, from every feature the source
//! has, then adds `tag`/`+tag` and removes `-tag`. Features in [`SHAPING_FLOOR`] are what script shaping needs for a
//! correct result, so no selection can remove them.

use read_fonts::{FontRef, TableProvider, collections::IntSet, types::Tag};
use skera::DEFAULT_LAYOUT_FEATURES;
use std::{string::String, string::ToString, vec::Vec};

use crate::{BakeError, BakeErrorCode, report::parse_tag};

const MAX_LAYOUT_FEATURE_TOKENS: usize = 1_024;

/// hb-subset's default layout features: what shaping applies by default, plus `frac numr dnom`, the vertical and
/// direction features, and every complex-script shaper's features.
pub(crate) const COMMON_LAYOUT_FEATURES: &[Tag] = DEFAULT_LAYOUT_FEATURES;

/// Features a selection cannot remove. HarfBuzz-model shapers apply them unasked to produce correct text, not
/// typographic preference: composition and localized forms (`ccmp`, `locl`), variation selection (`rvrn`), mark
/// attachment (`mark`, `mkmk`, `curs`), required ligatures and contextual forms (`rlig`, `rclt`), right-to-left and
/// left-to-right alternates and mirrored forms (`rtla`, `rtlm`, `ltra`, `ltrm`), and the Arabic, Hangul, Indic,
/// Tibetan and Universal Shaping Engine features. `liga`, `clig`, `calt`, `kern` and `frac`/`numr`/`dnom` stay
/// removable: they are defaults, not correctness. Vertical, East Asian spacing, `jalt` and `rand` are removable too;
/// Glyph lays text out horizontally.
pub(crate) const SHAPING_FLOOR: &[Tag] = &[
    Tag::new(b"ccmp"),
    Tag::new(b"locl"),
    Tag::new(b"rvrn"),
    Tag::new(b"mark"),
    Tag::new(b"mkmk"),
    Tag::new(b"curs"),
    Tag::new(b"rlig"),
    Tag::new(b"rclt"),
    Tag::new(b"ltra"),
    Tag::new(b"ltrm"),
    Tag::new(b"rtla"),
    Tag::new(b"rtlm"),
    // Arabic
    Tag::new(b"init"),
    Tag::new(b"medi"),
    Tag::new(b"fina"),
    Tag::new(b"isol"),
    Tag::new(b"med2"),
    Tag::new(b"fin2"),
    Tag::new(b"fin3"),
    Tag::new(b"cswh"),
    Tag::new(b"mset"),
    Tag::new(b"stch"),
    // Hangul
    Tag::new(b"ljmo"),
    Tag::new(b"vjmo"),
    Tag::new(b"tjmo"),
    // Indic, Tibetan, Khmer, Myanmar and the Universal Shaping Engine
    Tag::new(b"nukt"),
    Tag::new(b"akhn"),
    Tag::new(b"rphf"),
    Tag::new(b"rkrf"),
    Tag::new(b"pref"),
    Tag::new(b"blwf"),
    Tag::new(b"half"),
    Tag::new(b"abvf"),
    Tag::new(b"pstf"),
    Tag::new(b"cfar"),
    Tag::new(b"vatu"),
    Tag::new(b"cjct"),
    Tag::new(b"pres"),
    Tag::new(b"abvs"),
    Tag::new(b"blws"),
    Tag::new(b"psts"),
    Tag::new(b"haln"),
    Tag::new(b"dist"),
    Tag::new(b"abvm"),
    Tag::new(b"blwm"),
];

/// A parsed `--layout-features` selection. Tokens are a set: apart from `*`, which must come first, order does not
/// matter, and a tag both added and removed is an error.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct LayoutFeatureSelection {
    every: bool,
    added: Vec<Tag>,
    removed: Vec<Tag>,
}

/// What a selection keeps for one source font.
pub(crate) struct ResolvedLayoutFeatures {
    pub kept: IntSet<Tag>,
    /// Added tags the source has no feature for, sorted.
    pub missing: Vec<String>,
    /// Source feature tags the selection does not keep, sorted.
    pub dropped: Vec<String>,
}

impl LayoutFeatureSelection {
    pub(crate) fn parse(tokens: &[String]) -> Result<Self, BakeError> {
        if tokens.len() > MAX_LAYOUT_FEATURE_TOKENS {
            return Err(invalid(format!(
                "layout features exceed {MAX_LAYOUT_FEATURE_TOKENS} tokens"
            )));
        }
        let mut selection = Self::default();
        for (index, token) in tokens.iter().enumerate() {
            if token == "*" {
                if index != 0 {
                    return Err(invalid(
                        "layout feature '*' must be the first token".to_string(),
                    ));
                }
                selection.every = true;
                continue;
            }
            let (removing, tag) = match token.as_bytes().first() {
                Some(b'-') => (true, &token[1..]),
                Some(b'+') => (false, &token[1..]),
                _ => (false, token.as_str()),
            };
            let tag = parse_tag(tag).ok_or_else(|| {
                invalid(format!(
                    "layout feature {token:?} is not '*', or a four-character OpenType tag with an optional + or -"
                ))
            })?;
            if removing {
                if SHAPING_FLOOR.contains(&tag) {
                    return Err(invalid(format!(
                        "layout feature '{tag}' is required for correct script shaping and cannot be removed"
                    )));
                }
                selection.removed.push(tag);
            } else {
                selection.added.push(tag);
            }
        }
        selection.added.sort();
        selection.added.dedup();
        selection.removed.sort();
        selection.removed.dedup();
        if let Some(tag) = selection
            .added
            .iter()
            .find(|tag| selection.removed.binary_search(tag).is_ok())
        {
            return Err(invalid(format!(
                "layout feature '{tag}' is both added and removed"
            )));
        }
        Ok(selection)
    }

    pub(crate) fn resolve(&self, font: &FontRef<'_>) -> ResolvedLayoutFeatures {
        let present = source_feature_tags(font);
        let mut kept = IntSet::<Tag>::empty();
        if self.every {
            kept.invert();
        } else {
            kept.extend(COMMON_LAYOUT_FEATURES.iter().copied());
        }
        kept.extend(self.added.iter().copied());
        for &tag in &self.removed {
            kept.remove(tag);
        }
        let missing = self
            .added
            .iter()
            .filter(|&&tag| !present.contains(tag))
            .map(ToString::to_string)
            .collect();
        let mut dropped = present
            .iter()
            .filter(|&tag| !kept.contains(tag))
            .map(|tag| tag.to_string())
            .collect::<Vec<_>>();
        dropped.sort();
        ResolvedLayoutFeatures {
            kept,
            missing,
            dropped,
        }
    }
}

/// Every feature tag in the font's GSUB and GPOS feature lists.
pub(crate) fn source_feature_tags(font: &FontRef<'_>) -> IntSet<Tag> {
    let mut tags = IntSet::<Tag>::empty();
    if let Ok(list) = font.gsub().and_then(|gsub| gsub.feature_list()) {
        tags.extend(
            list.feature_records()
                .iter()
                .map(|record| record.feature_tag()),
        );
    }
    if let Ok(list) = font.gpos().and_then(|gpos| gpos.feature_list()) {
        tags.extend(
            list.feature_records()
                .iter()
                .map(|record| record.feature_tag()),
        );
    }
    tags
}

fn invalid(message: String) -> BakeError {
    BakeError::new(BakeErrorCode::InvalidSelection, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(tokens: &[&str]) -> Result<LayoutFeatureSelection, BakeError> {
        LayoutFeatureSelection::parse(
            &tokens
                .iter()
                .map(|token| token.to_string())
                .collect::<Vec<_>>(),
        )
    }

    #[test]
    fn the_floor_is_part_of_the_common_set() {
        for tag in SHAPING_FLOOR {
            assert!(COMMON_LAYOUT_FEATURES.contains(tag), "{tag}");
        }
    }

    #[test]
    fn tokens_are_an_order_independent_set() {
        assert_eq!(
            parse(&["smcp", "-liga", "+onum", "smcp"]).expect("tokens"),
            parse(&["-liga", "onum", "+smcp"]).expect("tokens")
        );
        assert_eq!(
            parse(&[]).expect("empty"),
            LayoutFeatureSelection::default()
        );
    }

    #[test]
    fn malformed_contradictory_and_floor_tokens_are_rejected() {
        for (tokens, message) in [
            (&["smcp", "*"][..], "'*' must be the first token"),
            (&["*", "*"][..], "'*' must be the first token"),
            (&["smcp", "-smcp"][..], "'smcp' is both added and removed"),
            (
                &["-ccmp"][..],
                "'ccmp' is required for correct script shaping",
            ),
            (&["-init"][..], "'init' is required"),
            (&["smcpx"][..], "is not '*'"),
            (&["-"][..], "is not '*'"),
            (&[""][..], "is not '*'"),
            (&[" smc"][..], "is not '*'"),
        ] {
            let error = parse(tokens).expect_err(message);
            assert_eq!(error.code, BakeErrorCode::InvalidSelection);
            assert!(
                error.message.contains(message),
                "{tokens:?}: {}",
                error.message
            );
        }
        parse(&["-liga", "-kern", "-calt", "-clig", "-frac", "-vert"])
            .expect("defaults are removable");
        parse(&["cv1 "]).expect("space-padded tag");
    }
}
