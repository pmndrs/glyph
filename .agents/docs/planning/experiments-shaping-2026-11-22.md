---
type: Log
title: 'Shaping experiments, 2026-11-22'
description: 'Spikes on shaping cost for 0.2.0: the simple-text path that skips HarfRust, what it covers, what it measured and its size.'
status: draft
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-22T10:00:00Z'
---

# Shaping experiments, 2026-11-22

## Simple-text path (`experiments/sil-ascii-shaping`, held unmerged)

Status: correct, green, no measured win. It stays on its branch until the owner decides whether to keep it or drop it.

`SimpleTextPlan` (in the vendored HarfRust fork) gives an item its nominal glyphs and font advances without running
HarfRust. It is used only for a default-shaper, left-to-right plan with no legacy `kern`, `kerx`, `morx` or `trak`, and
only when every character in the item meets all of these conditions:

- it is in the BMP;
- it is not a mark, format character, default ignorable, U+2044 or U+FF9E/F;
- its glyph is not in the first coverage table of any GSUB or GPOS subtable the plan can reach;
- GDEF does not class its glyph as a mark.

Verification, at `e7d015b7f` after merging `experiments/segment-indexed-layout`:

- `simple_text_tests` compares every accepted item with HarfRust on the repository and adversarial fonts, and checks
  that the fonts whose rules touch the characters are refused.
- The native oracle with `--features oracle` repeats that comparison on every accepted item. It and the wasm oracle
  pass the full tier without re-freezing.
- `cargo test --features oracle` passes 631 tests.
- `pnpm --filter @pmndrs/glyph test`, `benchmark:v1-bitmap` and `benchmark:typegpu-parity` pass.

Share of characters that take the path:

| font        | Latin prose items | Latin prose word units | ASCII frame |
| ----------- | ----------------: | ---------------------: | ----------: |
| Inter       |                0% |                     0% |          0% |
| DotGothic16 |                0% |                  88.6% |        100% |

Inter's kerning and contextual lookups cover all its letters and the frame's punctuation, so the ASCII frame's shaping
cost (59% of the frame) stays with HarfRust.

Headline harness, complete frame, median ms of 3 loads. The machine load average was about 40, so differences under
10% are noise.

| row                       |  main | merged base | with path |
| ------------------------- | ----: | ----------: | --------: |
| ascii, Inter bitmap       |  5.85 |        4.81 |      4.69 |
| ascii, DotGothic          |  3.93 |        2.70 |      2.64 |
| type-end, Latin 15k       |  9.88 |        5.23 |      5.31 |
| type-end, stress 22k      | 12.95 |        6.72 |      6.97 |
| insert-middle, Latin 15k  |  8.18 |        5.37 |      5.32 |
| insert-middle, stress 22k | 15.00 |        6.78 |      6.93 |
| delete-middle, Latin 15k  |  8.12 |        5.36 |      5.32 |
| delete-middle, stress 22k | 15.17 |        6.85 |      6.96 |
| paste-middle, Latin 15k   |  8.43 |        5.40 |      5.40 |
| paste-middle, stress 22k  | 15.36 |        7.24 |      7.12 |
| sweep, Latin 15k          |  3.14 |        3.33 |      3.45 |
| sweep, stress 22k         |  3.56 |        4.15 |      4.24 |
| sweep, bidi 15k Amiri     |  6.12 |        4.94 |      4.89 |

The path matches the merged base on every row. `text-shaper.wasm` grows by 4,552 bytes (2,495 gzip).

Raw runs are in `glyph-scratch/ascii/runs/{base-tip,main-tip}`.
