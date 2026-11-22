---
type: Log Entry
title: 'Simple-text shaping path verified'
generated:
  by: process:docs-new
  at: '2026-11-22T09:49:20Z'
---

The shaper's simple-text path (`SimpleTextPlan` in the vendored HarfRust fork, used by
`packages/glyph/rust/shaper/src/lib.rs`) was verified on `experiments/sil-ascii-shaping` after merging
`experiments/segment-indexed-layout`. It gives an item its nominal glyphs and font advances without HarfRust only when
the plan runs the default shaper left to right with no legacy `kern`, `kerx`, `morx` or `trak`, and every character
is a BMP non-mark, non-format, non-ignorable character whose glyph is in no primary coverage of any GSUB or GPOS
subtable of the plan and is not a GDEF mark.

Evidence: `simple_text_tests` shapes every accepted item a second time with HarfRust (glyph, cluster, flags,
advances, offsets) over the repository fonts and `GLYPH_ADVERSARIAL_FONTS`, with random sequences, refused context and
pinned refusals (Inter, Fira Code, EB Garamond, Dancing Script, kern-only fonts, a GDEF-mark patch). The native layout
oracle (`--features oracle`, which repeats that comparison on every accepted item) and the wasm oracle pass the full
tier without re-freezing references.

Coverage is font-bound: Inter's kerning and contextual lookups cover its Latin and ASCII punctuation, so 0% of the
headline Latin prose items and the ASCII frame take the path; DotGothic16 takes 100% of the ASCII frame and 88.6% of
prose word units. On the headline harness the path measured equal to the merged base on every row (machine load
average about 40), and adds 2,495 gzip bytes to `text-shaper.wasm`.
