//! Where a style span lands after a replacement: a pure function of four numbers.
//!
//! The host owns its spans and rebases them with the same rule in TypeScript
//! (`src/text-editing.ts`); both read the vectors in
//! `tests/fixtures/span-rebase-vectors.json`, so the two cannot drift apart.

use super::TextRange;

/// The range of `span` after units `[start, end)` are replaced by `inserted` units, or `None`
/// when nothing of the span is left.
///
/// Inserted text takes the style of the grapheme before it: a span that ends at or inside the
/// replaced range grows over the insertion, and a span that starts there starts after it. At
/// the very start of the text nothing comes before, so the insertion takes the style of what
/// follows it. Boundaries before the range stay; boundaries after it shift.
pub fn rebase_span(span: TextRange, start: u32, end: u32, inserted: u32) -> Option<TextRange> {
    let after = |offset: u32| offset - (end - start) + inserted;
    let span_start = if span.start < start || (span.start == start && start == 0) {
        span.start
    } else if span.start <= end {
        start + inserted
    } else {
        after(span.start)
    };
    let span_end = if span.end < start {
        span.end
    } else if span.end < end {
        start + inserted
    } else {
        after(span.end)
    };
    (span_start < span_end).then_some(TextRange {
        start: span_start,
        end: span_end,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shared_vectors_hold() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/span-rebase-vectors.json"
        ))
        .expect("the vector file is JSON");
        let cases = vectors["cases"].as_array().expect("cases");
        assert!(cases.len() > 20);
        let number = |value: &serde_json::Value| value.as_u64().expect("an offset") as u32;
        for case in cases {
            let span = TextRange {
                start: number(&case["span"][0]),
                end: number(&case["span"][1]),
            };
            let expected = (!case["result"].is_null()).then(|| TextRange {
                start: number(&case["result"][0]),
                end: number(&case["result"][1]),
            });
            assert_eq!(
                rebase_span(
                    span,
                    number(&case["replace"][0]),
                    number(&case["replace"][1]),
                    number(&case["inserted"]),
                ),
                expected,
                "{}",
                case["name"]
            );
        }
    }
}
