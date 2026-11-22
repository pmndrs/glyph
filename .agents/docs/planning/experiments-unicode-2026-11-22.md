---
type: Log
title: 'Text analysis experiments, 2026-11-22'
description: 'Spikes on Unicode classes, break rules, bidi, script itemisation and cluster build for 0.2.0: what was measured, what landed and what was discarded.'
status: draft
generated:
  by: anthropic/claude-fable-5-2
  at: '2026-11-22T10:30:00Z'
---

# Text analysis experiments, 2026-11-22

Branch `experiments/sil-exp-unicode`, cut from `experiments/segment-indexed-layout` at `ac4f9e4b9` (tag
`sil-green-27`). The plan is [segment-indexed-layout.md](segment-indexed-layout.md), section "SIMD experiments".
Each experiment is kept when it is faster or equal with output unchanged; a discarded spike leaves only its
numbers here.

## How it was measured

Apple M4, wasm32+simd128 under Node 24 (V8), the optimized oracle probe of `scripts/stage-bench.mjs`. Other lanes
were building and benchmarking on the same machine (load average 6–11 throughout), so every comparison runs both
probes interleaved in one process, round by round, and reads the minimum; medians are noisier and are not
quoted. A difference under about 1% of a whole step is inside the noise of this session.

- **Isolated kernel:** `stage-bench --suite analysis` (added here): `UnicodeAnalysis::analyze` and
  `bidi::analyze_into` alone on one 15,000-grapheme paragraph per script.
- **End to end:** `stage-bench` paragraph cases: a whole engine step for one grapheme typed mid-paragraph
  (`insert_mid`), three typed in one request (`three_range`) and the whole text replaced (`replace_all`), with
  the Unicode, bidi and cluster stages clocked inside the step (the first two clocks added here).
- **Size:** the shipped simd128 shaper built as `scripts/build.mjs` builds it, raw and gzip -9.

The browser headline harness (`glyph-baselines-2026-11-22/profile-harnesses/browser`, copied to scratch) ran
once after experiment 5, on a tarball packed from `d0c17d8e3` against the saved `main` consumer: plan
`headline`, three A/B rounds of the Latin 15k Inter edit rows and the small ASCII frame, one fresh browser per
load, load average 8–14. Complete frame, per-step median of loads, milliseconds:

| Workload      | Config            | main | this branch | branch/main | Baseline branch/main |
| ------------- | ----------------- | ---: | ----------: | ----------: | -------------------: |
| type-end      | latin15k-inter    | 9.81 |        5.33 |        0.54 |                 0.54 |
| insert-middle | latin15k-inter    | 7.95 |        5.39 |        0.68 |                 0.68 |
| delete-middle | latin15k-inter    | 8.04 |        5.30 |        0.66 |                 0.67 |
| paste-middle  | latin15k-inter    | 8.37 |        5.37 |        0.64 |                 0.65 |
| ascii         | ascii-interbitmap | 6.05 |        5.00 |        0.83 |                 0.84 |

The baseline column is the 2026-11-22 headline report's branch arm. The Wasm saving of 3b and 5 on a Latin
insert, about 0.2 ms of a 5.4 ms frame, is inside the spread of three loads, so the browser rows show no change
attributable to this lane; the engine-step rows above are the measurement.

## Where analysis time was at the start

One grapheme typed mid-paragraph, 15,000 graphemes, microseconds (minimum):

| Paragraph         | Whole step | Unicode | Bidi | Cluster stage |
| ----------------- | ---------: | ------: | ---: | ------------: |
| Latin, Inter      |      2,704 |      68 |   92 |           337 |
| CJK, Noto Sans JP |      3,643 |     118 |   86 |           862 |
| Arabic, Amiri     |     14,839 |     266 |  412 |           600 |
| Devanagari        |      5,553 |   1,371 |  200 |           587 |

Bidi cost more than the whole Unicode kernel on left-to-right text: the plain-paragraph scan decoded each unit
to a `char`, read the class trie, mapped the class enum to its code and pushed one byte, 6 ns per unit.
Devanagari, Thai and emoji text is all kernel residue, so its Unicode stage is the scalar analysis at about
50 ns per unit.

## Experiments

| #   | Experiment                                         | Hypothesis                                                                                                              | Isolated result (wasm)                                                                                         | End to end (wasm engine step)                                                                                                     | Size (shipped wasm)         | Verdict    |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------- |
| 3a  | Bidi class lanes for plain paragraphs (first form) | An ASCII table lane beside the per-character trie walk removes most of the scan                                         | Bidi, pure ASCII 119 → 15.6 µs; Latin prose with curly quotes 93 → 44; CJK 84 → 69                             | Bidi stage 94 → 45 µs on Latin 15k                                                                                                | not built                   | superseded |
| 3b  | The same with a BMP lane and fused paragraph scan  | Classify sixteen units per step (ASCII table or trie), find the paragraph separator in the codes, emit one run if plain | Bidi, ASCII 117 → 6.0 µs (19×); Latin 91 → 11.1 (8.2×); CJK 83 → 20.6; Devanagari 193 → 32.6; Arabic unchanged | `insert_mid` Latin 15k 2,704 → 2,616 (−3.3%), 22k 4,022 → 3,882 (−3.5%), CJK −3.1%, Devanagari −3.3%; `replace_all` −1.3 to −1.9% | +1,377 B raw, +619 B gzip   | **landed** |
| 5   | Windowed Unicode analysis of one edit              | Restart points bound breaks and graphemes; an explicit-script grapheme on each side bounds scripts                      | Unicode stage of one typed grapheme: Latin 73 → 5.3 µs, CJK 118 → 18, Arabic 266 → 6.6, Devanagari 1,379 → 40  | `insert_mid` Latin 15k −4.5%, Devanagari −24.8%, CJK −1.2%, Arabic in noise; `replace_all`, `three_range` unchanged               | +6,142 B raw, +2,272 B gzip | **landed** |

### 3b in detail

`bidi::analyze_into` classifies each bidi paragraph sixteen units at a time. A lane of ASCII units reads a
128-entry table built at compile time from the class trie; a lane of other BMP units reads the trie directly;
both fold what they saw into one answer, so only a lane holding a surrogate, a paragraph separator or a
character that needs the full algorithm is walked one character at a time. The separator is found in the class
codes, which removes the separate `paragraph_end` pass for plain paragraphs, and a text whose paragraphs are all
plain gets its single level run without scanning the level lane. Paragraphs that need resolution go to
`unicode-bidi` exactly as before.

Proof of equality: every scalar value's table and trie code against `Unicode17BidiData`; the set of codes that
force resolution against `BidiParagraphCounts`; every interesting unit (non-ASCII letters, marks, separators,
right-to-left letters and digits, embedding and isolate controls, paired and unpaired surrogates) at every
offset of a lane, alone and beside a second one, in texts that end inside and on a lane edge, against the
whole-text `unicode-bidi` reference in all three directions; and the existing 100,000-round token fuzz, with
every eighth text now long enough to cross several lanes.

Right-to-left and mixed text is unchanged by this experiment: the Arabic, Hebrew and mixed corpora all need the
full algorithm in every paragraph.

Verification of 3b, on the tree before `rustfmt` rewrapped three test assertions in `bidi.rs` (the committed
tip differs from it only by that formatting; the bidi unit tests were rerun on the tip):

- Native oracle, full tier: 590 cases equal, 0 differ; 54,240 differential requests, 0 runs with an unlisted
  divergence.
- Wasm oracle, full tier: the same counts, no reference re-frozen.
- `cargo test --features oracle` in the shaper: every target passed, the UAX #9, #14 and #29 conformance
  suites among them.
- `pnpm --filter @pmndrs/glyph test`: passed.

### 5. Windowed Unicode analysis of one edit (landed)

`resync::restart` already proved where the line-break and grapheme lanes can restart, but only the word and
sentence lanes used it: every text edit analysed the whole paragraph. `UnicodeAnalysis::analyze_edited` now
analyses one window around a single edit (the one a reconciliation found, or the request's only mutation) and
joins it to the committed lanes; several edits in one request, a new paragraph and a window that reaches both
ends of the text still take the whole analysis.

- **Breaks and graphemes** change only between the last restart before the edit and the first after it, with
  two units of margin so no restart predicate reads an edited unit.
- **Scripts** have no restart points. The first spike widened the edit to `script_resync_range`, whose anchor is
  a unit with an explicit single kernel script; Devanagari, Thai and emoji letters are kernel residue, so their
  window was the whole text. The landed form anchors on whole graphemes instead: it walks the committed
  graphemes outward from the break window to the first grapheme on each side whose preferred script
  (`grapheme_script_atom`) is explicit. Such a grapheme takes no script from its neighbours, and neutral
  graphemes beyond it take theirs from it, so the script items inside the window are those of the window
  analysed alone. One window covers all three lanes.

Proof of equality: chains of up to twelve random edits (60,000 chains in release, ill-formed edits included)
over the resync alphabet, with letters that restart, residue scripts that do not, and neutrals whose
Script_Extensions restrict what they join (U+0964, U+0301, U+30FC, U+A8F1); every windowed analysis equals the
cold one, lane by lane, and fails exactly when the cold one does. The oracle compares the whole engine with
cold layout (verification below).

Measured interleaved against the integration tip (`75c03af21`), same session, load average 23–38, minimum of
5 rounds × 30 iterations, wasm, 15,000 graphemes, microseconds:

| Paragraph         | Unicode stage, insert | Whole step, `insert_mid` | `replace_all` whole step |
| ----------------- | --------------------: | -----------------------: | -----------------------: |
| Latin, Inter      |            73.4 → 5.3 |    2,748 → 2,623 (−4.5%) |    6,517 → 6,504 (noise) |
| Latin, Fredoka    |            73.3 → 5.2 |    3,042 → 2,962 (−2.6%) |    4,918 → 4,969 (noise) |
| CJK, Noto Sans JP |          118.2 → 17.8 |    3,734 → 3,688 (−1.2%) |    5,982 → 5,944 (noise) |
| Arabic, Amiri     |           266.3 → 6.6 |  14,840 → 14,745 (noise) |  15,029 → 14,994 (noise) |
| Devanagari        |        1,379.0 → 40.3 |   5,409 → 4,066 (−24.8%) |  14,794 → 14,734 (noise) |

`three_range` (three edits in one request) is unchanged by design. Shipped simd128 shaper: +6,142 B raw, +2,272 B gzip.

Verification of 5, on `d0c17d8e3`:

- Native oracle, full tier: 590 cases equal, 0 differ; 54,240 differential requests, 0 runs with an unlisted
  divergence (the one listed divergence, `rg-clipped-noop-borrowed-layout` step 03, is unchanged).
- Wasm oracle, full tier: the same counts, no reference re-frozen.
- `cargo test --features oracle` in the shaper: every target passed, the UAX #9, #14 and #29 conformance
  suites among them (569 library tests).
- `pnpm --filter @pmndrs/glyph test`: passed.
