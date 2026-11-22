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

The browser headline harness (`glyph-baselines-2026-11-22/profile-harnesses/browser`) was not rerun: it needs a
packed tarball per arm and a quiet GPU, and four other lanes were using the machine. The engine-step rows above
are the Wasm share of its edit rows.

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

| #   | Experiment                                         | Hypothesis                                                                                                              | Isolated result (wasm)                                                                                         | End to end (wasm engine step)                                                                                                     | Size (shipped wasm)       | Verdict    |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------- |
| 3a  | Bidi class lanes for plain paragraphs (first form) | An ASCII table lane beside the per-character trie walk removes most of the scan                                         | Bidi, pure ASCII 119 → 15.6 µs; Latin prose with curly quotes 93 → 44; CJK 84 → 69                             | Bidi stage 94 → 45 µs on Latin 15k                                                                                                | not built                 | superseded |
| 3b  | The same with a BMP lane and fused paragraph scan  | Classify sixteen units per step (ASCII table or trie), find the paragraph separator in the codes, emit one run if plain | Bidi, ASCII 117 → 6.0 µs (19×); Latin 91 → 11.1 (8.2×); CJK 83 → 20.6; Devanagari 193 → 32.6; Arabic unchanged | `insert_mid` Latin 15k 2,704 → 2,616 (−3.3%), 22k 4,022 → 3,882 (−3.5%), CJK −3.1%, Devanagari −3.3%; `replace_all` −1.3 to −1.9% | +1,377 B raw, +619 B gzip | **landed** |

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

## In progress, not landed

**Windowed Unicode analysis of one edit.** `resync::restart` and `script_resync_range` already prove where the
line-break, grapheme and script lanes can restart, but only the word and sentence lanes use them: every text
edit still analyses the whole paragraph. A spike that analyses only the window around a single edit and joins
it to the previous lanes passed a fuzz against the cold analysis (60,000 chains of up to twelve edits, ill-formed
edits included) and takes the Unicode stage of one typed grapheme on Latin 15k from 72 to 6.2 µs. The whole step read
2,637 against 2,611 µs under a load average above 17, which is not a measurement. Devanagari is unchanged
(1,353 µs): its letters are kernel residue and carry no script anchor, so the script window is the whole text.
The spike is kept outside the branch until both are settled.
