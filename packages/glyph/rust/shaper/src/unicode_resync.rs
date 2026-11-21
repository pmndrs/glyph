//! Where a local edit may stop reanalysing: restart points per Unicode lane.
//!
//! A restart at `position` means the lane's analysis of the text equals its analysis of
//! `text[..position]` followed by its analysis of `text[position..]`, with the join itself
//! described by a `Joint`. A local edit recomputes a lane from the last restart at or before the
//! edit to the first restart at or after it (`resync_window`) and keeps everything outside.
//!
//! The predicates read generated properties only (`scripts/generate-unicode-kernel-data.mjs`):
//!
//! - **Resync point**, shared by line breaks, graphemes, words and sentences: letter, U+0020,
//!   letter, where a letter has line-break class AL or HL, an explicit single script, a letter
//!   Word_Break and Sentence_Break class and is not East Asian, and the unit after the second
//!   letter is in the kernel closure (so it is not Extend, SpacingMark or ZWJ).
//! - **Required breaks** restart line breaks, graphemes and words. They do not restart sentences
//!   (U+000B and U+000C are Sentence_Break Sp, so `Mr.` VT `smith` is one sentence), bidi
//!   (U+2028 is Bidi_Class WS) or scripts (`я` LF `1 2 3` is one Cyrillic item).
//! - **Sentences** also restart after a paragraph separator (LF, CR not before LF, U+0085,
//!   U+2028, U+2029); **bidi** restarts only after Bidi_Class B.
//! - **Scripts** have no restart points: a neutral unit takes its script from the explicit
//!   scripts on either side, however far. `script_resync_range` widens an edit to the explicit
//!   single-script units around it instead.
//!
//! Windows are unbounded: LB25 can move a break 41 units from an edit and SB8 80, and both stay
//! inside one window because neither crosses a resync point.

use super::kernel;

/// A Unicode analysis lane with its own restart points.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lane {
    LineBreak,
    Grapheme,
    Word,
    Sentence,
    Script,
    Bidi,
}

/// What the lane has at a restart position.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Joint {
    /// A boundary: a grapheme, word or sentence start, an allowed line break, a new bidi
    /// paragraph.
    Boundary,
    /// A required line break.
    RequiredBreak,
    /// The lane restarts here without a boundary: a sentence continues across a resync point.
    Continuation,
}

const SPACE: u16 = 0x20;

/// True for a unit carrying the generated resync-letter property.
pub fn is_resync_letter(unit: u16) -> bool {
    kernel::unit_class(unit) & kernel::KERNEL_RESYNC_LETTER != 0
}

/// Letter, single space, letter, with the unit after the second letter in the kernel closure.
pub fn is_resync_point(text: &[u16], position: usize) -> bool {
    position >= 2
        && position < text.len()
        && text[position - 1] == SPACE
        && is_resync_letter(text[position - 2])
        && is_resync_letter(text[position])
        && text
            .get(position + 1)
            .is_none_or(|unit| kernel::unit_class(*unit) != 0)
}

/// The unit before `position` forces a line: BK, LF, NL, or a CR that no LF follows.
fn after_required_break(text: &[u16], position: usize) -> bool {
    match text[position - 1] {
        0x0d => text.get(position) != Some(&0x0a),
        unit => kernel::unit_class(unit) & kernel::KERNEL_CLASS_MASK == kernel::K_HARD,
    }
}

/// The unit before `position` is a Sentence_Break paragraph separator (SB4).
fn after_paragraph_separator(text: &[u16], position: usize) -> bool {
    match text[position - 1] {
        0x0a | 0x85 | 0x2028 | 0x2029 => true,
        0x0d => text.get(position) != Some(&0x0a),
        _ => false,
    }
}

/// The unit before `position` has Bidi_Class B (UAX #9 P1).
fn after_bidi_separator(text: &[u16], position: usize) -> bool {
    matches!(
        text[position - 1],
        0x0a | 0x0d | 0x1c..=0x1e | 0x85 | 0x2029
    )
}

/// The joint at `position` if `lane` restarts there. The two ends of the text are not asked.
pub fn restart(lane: Lane, text: &[u16], position: usize) -> Option<Joint> {
    if position == 0 || position >= text.len() {
        return None;
    }
    let resync = is_resync_point(text, position);
    match lane {
        Lane::LineBreak if after_required_break(text, position) => Some(Joint::RequiredBreak),
        Lane::LineBreak | Lane::Grapheme | Lane::Word if resync => Some(Joint::Boundary),
        Lane::Grapheme | Lane::Word if after_required_break(text, position) => {
            Some(Joint::Boundary)
        }
        Lane::Sentence if after_paragraph_separator(text, position) => Some(Joint::Boundary),
        Lane::Sentence if resync => Some(Joint::Continuation),
        Lane::Bidi if after_bidi_separator(text, position) => Some(Joint::Boundary),
        _ => None,
    }
}

/// The window a lane must recompute for an edit that left `[start, end)` changed in `text`: from
/// the last restart at or before `start` to the first at or after `end`, or the text's ends.
pub fn resync_window(lane: Lane, text: &[u16], start: usize, end: usize) -> (usize, usize) {
    if lane == Lane::Script {
        return script_resync_range(text, start, end);
    }
    let from = (1..=start.min(text.len().saturating_sub(1)))
        .rev()
        .find(|position| restart(lane, text, *position).is_some())
        .unwrap_or(0);
    let to = (end.max(from + 1)..text.len())
        .find(|position| restart(lane, text, *position).is_some())
        .unwrap_or(text.len());
    (from, to)
}

/// A unit that is its own grapheme and carries an explicit single script.
fn is_script_anchor(text: &[u16], index: usize) -> bool {
    let script = kernel::unit_script(text[index]);
    script != 0
        && script < kernel::KERNEL_SCRIPT_SET_BASE
        && text
            .get(index + 1)
            .is_none_or(|unit| kernel::unit_class(*unit) != 0)
}

/// The script lane's window for an edit that left `[start, end)` changed: from the explicit
/// single-script grapheme before the edit to the one after it, both included. Script items of
/// units outside are unchanged, and the items inside equal those of the window analysed alone.
pub fn script_resync_range(text: &[u16], start: usize, end: usize) -> (usize, usize) {
    let from = (0..start.min(text.len()))
        .rev()
        .find(|index| is_script_anchor(text, *index))
        .unwrap_or(0);
    let to = (end.max(from)..text.len())
        .find(|index| is_script_anchor(text, *index))
        .map_or(text.len(), |index| index + 1);
    (from, to)
}

#[cfg(test)]
pub(crate) mod tests {
    use alloc::{string::String, vec::Vec};

    use unicode_segmentation::UnicodeSegmentation;

    use super::*;
    use crate::{bidi, line_break::LineBreakAnalysis, unicode::UnicodeAnalysis};

    /// The reviewer's adversarial alphabet (`review-v5/i18n-editing.md`, finding 3), extended.
    pub(crate) const ALPHABET: &[&str] = &[
        "a",
        "b",
        "Z",
        "s",
        "я",
        "α",
        "\u{b5}",
        "\u{1d400}",
        "א",
        "ب",
        "1",
        "2",
        ",",
        ".",
        "/",
        "-",
        "(",
        ")",
        "\"",
        "\u{201c}",
        "\u{201d}",
        "\u{ab}",
        "\u{bb}",
        "\u{2019}",
        " ",
        " ",
        " ",
        " ",
        "\u{301}",
        "\u{200d}",
        "\u{a0}",
        "%",
        "$",
        "\n",
        "\u{2028}",
        "\u{b}",
        "字",
        "。",
        "「",
        "ア",
        "ก",
        "क",
        "\u{94d}",
        "\u{1f1fa}",
        "\u{1f469}",
        "\u{fe0f}",
        "\u{2014}",
        "!",
        "?",
        ":",
        "\u{2026}",
        "[",
        "]",
        "\r",
        "\u{85}",
        "\u{2029}",
        "\u{200b}",
        "ー",
        "'",
        "\u{5f3}",
        "\u{2d0}",
        "_",
        "\u{202e}",
        "\u{2067}",
        "\u{2069}",
    ];

    struct Lanes {
        breaks: Vec<(u32, bool)>,
        graphemes: Vec<u32>,
        scripts: Vec<u32>,
        levels: Vec<u8>,
        words: Vec<u32>,
        sentences: Vec<u32>,
    }

    fn lanes(units: &[u16]) -> Lanes {
        let text = String::from_utf16(units).expect("fuzz text is valid UTF-16");
        let mut line = LineBreakAnalysis::default();
        line.analyze(units).unwrap();
        let mut analysis = UnicodeAnalysis::default();
        analysis.analyze(units).unwrap();
        let mut scripts = alloc::vec![0; units.len()];
        for item in analysis.script_items() {
            scripts[item.text_start as usize..item.text_end as usize].fill(item.script);
        }
        let to_utf16 = |byte: usize| text[..byte].encode_utf16().count() as u32;
        Lanes {
            breaks: line
                .breaks()
                .iter()
                .map(|line_break| (line_break.position, line_break.required))
                .collect(),
            graphemes: analysis.grapheme_boundaries().to_vec(),
            scripts,
            levels: bidi::analyze(units, bidi::DIRECTION_AUTO).unwrap().levels,
            words: text
                .split_word_bound_indices()
                .map(|(byte, _)| to_utf16(byte))
                .collect(),
            sentences: text
                .split_sentence_bound_indices()
                .map(|(byte, _)| to_utf16(byte))
                .collect(),
        }
    }

    /// `left` then `right` shifted by `cut`, with the cut itself present or absent.
    fn joined(left: &[u32], right: &[u32], cut: u32, boundary: bool) -> Vec<u32> {
        let mut all: Vec<u32> = left
            .iter()
            .copied()
            .chain(right.iter().map(|position| position + cut))
            .filter(|position| *position != cut)
            .collect();
        if boundary {
            all.push(cut);
        }
        all.sort_unstable();
        all.dedup();
        all
    }

    fn check_restarts(units: &[u16], checked: &mut [usize; 5]) {
        let full = lanes(units);
        let shown = || {
            String::from_utf16_lossy(units)
                .escape_unicode()
                .collect::<String>()
        };
        for cut in 1..units.len() {
            let lane_restarts = [
                Lane::LineBreak,
                Lane::Grapheme,
                Lane::Word,
                Lane::Sentence,
                Lane::Bidi,
            ]
            .map(|lane| restart(lane, units, cut));
            assert_eq!(restart(Lane::Script, units, cut), None);
            if lane_restarts.iter().all(Option::is_none) {
                continue;
            }
            let (left, right) = (lanes(&units[..cut]), lanes(&units[cut..]));
            let at = cut as u32;
            if let Some(joint) = lane_restarts[0] {
                let mut glued: Vec<(u32, bool)> = left
                    .breaks
                    .iter()
                    .copied()
                    .filter(|line_break| line_break.0 != at)
                    .collect();
                glued.push((at, joint == Joint::RequiredBreak));
                glued.extend(
                    right
                        .breaks
                        .iter()
                        .map(|(position, required)| (position + at, *required)),
                );
                assert_eq!(full.breaks, glued, "line breaks of {} at {cut}", shown());
                checked[0] += 1;
            }
            if lane_restarts[1].is_some() {
                let glued = joined(&left.graphemes, &right.graphemes, at, true);
                assert_eq!(full.graphemes, glued, "graphemes of {} at {cut}", shown());
                checked[1] += 1;
            }
            if lane_restarts[2].is_some() {
                let glued = joined(&left.words, &right.words, at, true);
                assert_eq!(full.words, glued, "words of {} at {cut}", shown());
                checked[2] += 1;
            }
            if let Some(joint) = lane_restarts[3] {
                let glued = joined(
                    &left.sentences,
                    &right.sentences,
                    at,
                    joint == Joint::Boundary,
                );
                assert_eq!(full.sentences, glued, "sentences of {} at {cut}", shown());
                checked[3] += 1;
            }
            if lane_restarts[4].is_some() {
                let mut glued = left.levels.clone();
                glued.extend_from_slice(&right.levels);
                assert_eq!(full.levels, glued, "bidi levels of {} at {cut}", shown());
                checked[4] += 1;
            }
        }
    }

    fn xorshift(state: &mut u64) -> u64 {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        *state
    }

    fn random_text(state: &mut u64, length: usize, text: &mut String) {
        text.clear();
        for _ in 0..length {
            let pick = xorshift(state) as usize;
            text.push_str(ALPHABET[(pick >> 8) % ALPHABET.len()]);
        }
    }

    /// The reviewer's 400,000-string fuzz, per lane and including the decision at the cut.
    #[test]
    fn every_restart_decomposes_its_lane() {
        let mut state = 0x9e37_79b9_7f4a_7c15u64;
        let mut text = String::new();
        let mut checked = [0usize; 5];
        let rounds = if cfg!(debug_assertions) {
            20_000
        } else {
            400_000
        };
        for _ in 0..rounds {
            let length = 4 + (xorshift(&mut state) % 9) as usize;
            random_text(&mut state, length, &mut text);
            let units: Vec<u16> = text.encode_utf16().collect();
            check_restarts(&units, &mut checked);
        }
        assert!(
            checked.iter().all(|count| *count > rounds / 100),
            "{checked:?}"
        );
    }

    /// Every word, sentence and grapheme class between two resync letters and around a space.
    #[test]
    fn resync_points_hold_for_every_segmentation_class() {
        let mut checked = [0usize; 5];
        let representatives = kernel::SEGMENTATION_TEST_REPRESENTATIVES;
        let mut units = Vec::new();
        for first in representatives {
            for second in representatives {
                for frame in [
                    &["a ", "", "", " b c"][..],
                    &["a b", "", "", "c d"],
                    &["", "", " a b ", ""],
                    &["я ", " ", "", "я"],
                ] {
                    units.clear();
                    units.extend(frame[0].encode_utf16());
                    push_scalar(&mut units, *first);
                    units.extend(frame[1].encode_utf16());
                    push_scalar(&mut units, *second);
                    units.extend(frame[2].encode_utf16());
                    units.extend(frame[3].encode_utf16());
                    check_restarts(&units, &mut checked);
                }
            }
        }
        assert!(checked[0] > 10_000);
    }

    fn push_scalar(units: &mut Vec<u16>, scalar: u32) {
        let mut buffer = [0u16; 2];
        units.extend_from_slice(char::from_u32(scalar).unwrap().encode_utf16(&mut buffer));
    }

    #[test]
    fn required_breaks_restart_only_the_lanes_they_end() {
        let units = |text: &str| text.encode_utf16().collect::<Vec<u16>>();
        // U+000B forces a line but is Sentence_Break Sp, Bidi_Class S.
        let text = units("Mr.\u{b}smith a b");
        assert_eq!(
            restart(Lane::LineBreak, &text, 4),
            Some(Joint::RequiredBreak)
        );
        assert_eq!(restart(Lane::Word, &text, 4), Some(Joint::Boundary));
        assert_eq!(restart(Lane::Sentence, &text, 4), None);
        assert_eq!(restart(Lane::Bidi, &text, 4), None);
        // U+2028 ends a sentence and a line; it is Bidi_Class WS.
        let text = units("Mr.\u{2028}smith");
        assert_eq!(restart(Lane::Sentence, &text, 4), Some(Joint::Boundary));
        assert_eq!(restart(Lane::Bidi, &text, 4), None);
        // LF ends a bidi paragraph, and never restarts scripts.
        let text = units("я\n1 2 3");
        assert_eq!(restart(Lane::Bidi, &text, 2), Some(Joint::Boundary));
        assert_eq!(restart(Lane::Script, &text, 2), None);
        assert_eq!(script_resync_range(&text, 3, 4), (0, text.len()));
        // CR LF is one break, after the LF.
        let text = units("a\r\nb");
        assert_eq!(restart(Lane::LineBreak, &text, 2), None);
        assert_eq!(
            restart(Lane::LineBreak, &text, 3),
            Some(Joint::RequiredBreak)
        );
        // A sentence continues across a resync point; a micro sign is no resync letter.
        let text = units("a b \u{b5} c");
        assert_eq!(restart(Lane::Sentence, &text, 2), Some(Joint::Continuation));
        assert_eq!(restart(Lane::LineBreak, &text, 4), None);
        assert_eq!(restart(Lane::LineBreak, &text, 6), None);
    }

    #[test]
    fn windows_are_unbounded_for_long_range_rules() {
        let units = |text: &str| text.encode_utf16().collect::<Vec<u16>>();
        // LB25: the first unit decides a break 41 units away.
        let text = units(&alloc::format!("x y A{}5 word", "/".repeat(40)));
        let (from, to) = resync_window(Lane::LineBreak, &text, 4, 5);
        assert_eq!((from, to), (4, text.len()));
        // SB8: the letter after forty `5 ` decides a sentence break 80 units back.
        let text = units(&alloc::format!("a b Mr. {}smith a", "5 ".repeat(40)));
        let edit = text.len() - 7;
        let (from, to) = resync_window(Lane::Sentence, &text, edit, edit + 1);
        assert_eq!((from, to), (4, text.len() - 1));
        assert!(to - from > 80);
    }

    /// Random single edits: lanes outside the window keep their old values and lanes inside
    /// equal the window analysed alone.
    #[test]
    fn script_window_contains_every_change_of_an_edit() {
        let mut state = 0x2545_f491_4f6c_dd1du64;
        let (mut text, mut insert) = (String::new(), String::new());
        let rounds = if cfg!(debug_assertions) {
            10_000
        } else {
            200_000
        };
        for _ in 0..rounds {
            let length = 2 + (xorshift(&mut state) % 14) as usize;
            random_text(&mut state, length, &mut text);
            let inserted = (xorshift(&mut state) % 3) as usize;
            random_text(&mut state, inserted, &mut insert);
            let old: Vec<u16> = text.encode_utf16().collect();
            let insert: Vec<u16> = insert.encode_utf16().collect();
            let start = (xorshift(&mut state) as usize) % (old.len() + 1);
            let removed = ((xorshift(&mut state) as usize) % 3).min(old.len() - start);
            let mut new = old[..start].to_vec();
            new.extend_from_slice(&insert);
            new.extend_from_slice(&old[start + removed..]);
            // Skip edits that split a surrogate pair; the engine rejects those earlier.
            if String::from_utf16(&new).is_err() {
                continue;
            }
            let (from, to) = script_resync_range(&new, start, start + insert.len());
            let (before, after) = (lanes(&old), lanes(&new));
            let shown = || {
                alloc::format!(
                    "{} -> {} window {from}..{to}",
                    String::from_utf16_lossy(&old).escape_unicode(),
                    String::from_utf16_lossy(&new).escape_unicode()
                )
            };
            assert_eq!(before.scripts[..from], after.scripts[..from], "{}", shown());
            let tail = new.len() - to;
            assert_eq!(
                before.scripts[old.len() - tail..],
                after.scripts[to..],
                "{}",
                shown()
            );
            if String::from_utf16(&new[from..to]).is_ok() {
                let alone = lanes(&new[from..to]);
                assert_eq!(alone.scripts, after.scripts[from..to], "{}", shown());
            }
        }
    }
}
