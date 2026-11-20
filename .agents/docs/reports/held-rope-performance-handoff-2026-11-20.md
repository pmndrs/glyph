---
type: Engineering Research
title: HELD rope performance WIP handoff — 2026-11-20
description: Continuation prompt, research links, measured outcomes, and unfinished performance work for the unaccepted rope prototype.
status: draft
sources:
  - resource: ../planning/decisions/retained-prepare-publish.md
    title: Preparation and publication contract
  - resource: ../planning/retained-text-assignment.md
    title: Retained assignment design and Rope Science mapping
  - resource: ../planning/publication-frontier.md
    title: Historical frontier and retained experiments
  - resource: ../log/2026-11-20-held-rope-ascii-anchor-wip.md
    title: Current WIP checkpoint and known failures
  - resource: https://xi-editor.io/docs/rope_science_01.html
    title: Rope Science — MapReduce for text
  - resource: https://xi-editor.io/docs/rope_science_02.html
    title: Rope Science — metrics
  - resource: https://xi-editor.io/docs/rope_science_03.html
    title: Rope Science — grapheme cluster boundaries
  - resource: https://xi-editor.io/docs/rope_science_05.html
    title: Rope Science — incremental word wrapping
  - resource: https://xi-editor.io/docs/rope_science_06.html
    title: Rope Science — parallel and asynchronous word wrapping
  - resource: https://xi-editor.io/docs/rope_science_12.html
    title: Rope Science — minimal invalidation
generated:
  by: openai-codex/gpt-6
  at: '2026-11-20T23:23:21Z'
---

# Continuation prompt

Continue pmndrs/glyph's HELD rope performance work from
[experiments/held-rope-ascii-anchor-wip](https://github.com/pmndrs/glyph/tree/experiments/held-rope-ascii-anchor-wip).
This is the current WIP source and regression-test checkpoint. Read the research directly and examine the actual code.
Use the results below as the experiment record; choose the next design from evidence.

The existing stack is
[#292](https://github.com/pmndrs/glyph/pull/292) →
[#301](https://github.com/pmndrs/glyph/pull/301) →
[#302](https://github.com/pmndrs/glyph/pull/302) →
[draft #310](https://github.com/pmndrs/glyph/pull/310) →
this WIP branch. The immediate parent is #310's
`8957be42dce88266b8e2753c1b89a6ff02b332d0` on `feat/rust-text-input-wire`.
Fetch and verify the actual WIP tip; that parent SHA is not the complete new snapshot.
The user requested a pushed WIP branch without a new PR. Keep the existing stack unmerged.

The objective remains complete-operation parity against **both** same-machine main and published 0.1.0
across all seven fixed families, preserving the wins already found. Stop at verified parity.
Synchronous setters, prepared measurement and glyph access, independent split, Rust authority, logical order,
and packed storage are user requirements. Present any proposed contract change explicitly.
The user's current design question is what information must be ready after set for measurement and glyph access,
and what work should happen at publication to make the complete operation faster.

Use native Sol Medium implementors, fresh Sol High review, and Luna for all gates, builds, benchmarks, hashes and
statistical recomputation. One heavy lane, pinned tools, maintained named workflows, no ai-cli.
Preserve local source, tests, documentation, earlier variants, raw results and failed receipts.
Submit accepted work through real gh-stack. No release, tag or demo merge.

## Rope Science research

- [Introduction](https://xi-editor.io/docs/rope_science_00.html)
- [Part 1 — MapReduce for text](https://xi-editor.io/docs/rope_science_01.html)
- [Part 2 — Metrics](https://xi-editor.io/docs/rope_science_02.html)
- [Part 3 — Grapheme cluster boundaries](https://xi-editor.io/docs/rope_science_03.html)
- [Part 4 — Parenthesis matching](https://xi-editor.io/docs/rope_science_04.html)
- [Part 5 — Incremental word wrapping](https://xi-editor.io/docs/rope_science_05.html)
- [Part 6 — Parallel and asynchronous word wrapping](https://xi-editor.io/docs/rope_science_06.html)
- [Part 12 — Minimal invalidation](https://xi-editor.io/docs/rope_science_12.html)

Repository history is in [retained text assignment](../planning/retained-text-assignment.md),
the [publication frontier](../planning/publication-frontier.md), and the
[preparation/publication decision](../planning/decisions/retained-prepare-publish.md).

## What succeeded

### Measured complete-operation wins in the earlier full candidate

The independently validated old K matrix used 18 fresh arms in six three-way permutations.
Each pass had 145 K/M identities and 143 published identities with two declared outline omissions.
Selected saved **p50 / p90 milliseconds**:

| Complete operation                                           |             Old K |        Main control |     Published 0.1.0 |
| ------------------------------------------------------------ | ----------------: | ------------------: | ------------------: |
| 100 edits interleaved with reads/publication in 1,000 labels | 50.0834 / 58.1557 | 136.4626 / 181.8949 | 223.5996 / 343.9272 |
| First same-length edit + scene publication among 1,000       |   1.8335 / 2.4912 |     3.0486 / 3.6669 |     3.6310 / 4.3747 |
| Edit + independent glyph copy among 1,000                    |   2.0389 / 2.6500 |     3.0566 / 3.7554 |    7.4061 / 14.9199 |

All three had faster K p50 in all six paired passes against both controls.
These are results for the older canonical inline-leaf candidate, before the new ASCII-anchor runtime.
They are not timings of the current runtime.

### The new bounded shaping mechanism and correctness tests

The latest runtime experiment replaces the length-changing whole-run HarfRust producer with an optional,
typed-font-screened ASCII-anchor item. It uses the actual registered-font lifetime and prepared text facts.
Its current admission is a single-font Latn/LTR printable-ASCII paragraph of at most 8,192 units,
with two immutable anchors per side and a shaped item of at most 256 units.
Unsupported inputs use the existing producer.

The real Fredoka setter test shaped **4–5 UTF-16 units instead of 4,947–4,948** in the main producer.
The resulting run header and all seven raw lanes matched full cold shaping.
The same diagnostic separately recorded 130 downstream wrapping-shape calls / 140 units.
The first eligible edit paid a separate 95-character nominal bootstrap.
These are observed work counts; complete-operation timing for this runtime has not run.

Tests also passed for immediate measurements, glyph identities, independent split, prepared and committed generic
Codec output, unsupported-font and edge/cap fallback, font lifetime, and staged Unicode facts.
Preflight rejection preserves accepted state. The injected downstream failure follows the ordinary invalidation/reset path.

The final native run passed **512 unit tests + 13 integration tests = 525 passes**, with one ignored test
and no warnings. The standard package check built shipping JS/Wasm and passed its package tests and formatting,
then stopped at the two Clippy findings listed below.

## What failed or did not show the intended gain

### Remaining regressions in the earlier full candidate

The old full candidate did not reach both-control seven-family parity. Saved p50 / p90 milliseconds:

| Complete operation                      |             Old K |      Main control |   Published 0.1.0 |
| --------------------------------------- | ----------------: | ----------------: | ----------------: |
| Grouped rewrite 512 + scene publication |   7.9146 / 9.0731 |   7.4322 / 8.3010 |   7.9233 / 9.5861 |
| Publish 1,024 retained Text instances   | 15.9607 / 18.5790 | 16.2033 / 18.9129 | 16.1142 / 21.1654 |
| Fredoka length edit + immediate measure |   2.1002 / 2.3591 |   1.6129 / 1.9075 |   1.5630 / 1.9046 |
| Width change + immediate measure        |   1.7844 / 2.4667 |   0.8917 / 1.1597 |   1.0117 / 1.4495 |
| Cold mount + publish 22k glyphs         | 21.1315 / 24.3952 | 17.8463 / 20.1212 | 20.0723 / 31.3066 |

Fredoka was slower in all six paired passes against both controls.
Dense 512 was slower than main in five passes; dense 1,024 had mixed signs.
Common publication, long reflow, width, cold and some unchanged inspection cases also remained slower.
The main control was `4e25a96a57462fef5ad0d19065a822695b480f60`.

### Other recorded attempts

- **Whole V3 combination:** measured without a credible dense gain.
- **Empty-query staging:** correctness and authentication passed, but measurement showed no credible dense gain.
- **Strict concat-flag Fredoka splice:** exact raw-output tests passed, but the producer still shaped all
  4,948/4,947 units; it did not achieve the intended bounded shaping.
- **Initial simple/zero-flag font predicate:** rejected the actual Fredoka font. The current typed immutable-anchor
  experiment followed that result.
- **Earlier local insertion/deletion seam:** broader Amiri coverage exposed incorrect ligature rejoining;
  that implementation was retired.
- **Sole-run storage transfer:** the common-edit experiment showed no classified speedups and two slower
  paint-span workloads.
- **Compiler-inlining and several scratch/helper variants:** prior ablations/combinations were negative or
  inconclusive. Their source and results are retained locally.
- **First global Harf counter assertion for the new runtime:** expected one call but observed 131 because
  downstream wrapping calls were included. Separate producer counters repaired the test; the real bounded
  main-producer test then passed.
- **First standard package build attempt:** an orchestration CARGO_TARGET_DIR override put baker output in the
  wrong target directory. Removing the override got the corrected attempt through the build and package tests.

Do not automatically rerun these unchanged attempts. Their exact source/artifacts/results remain preserved.

## Source investigations and work still open

These have not produced a complete-operation success or failure result for the new runtime:

- The actual retained gather projects each visited row once and compares/updates columns in that callback.
  A proposed gather fusion was not shown to remove a second whole projection.
- The width audit found one full flow/positioning producer.
- Prepared-block and canonical-occurrence certificates were source studies with unresolved implementation/cost work.
- The current ASCII-anchor route still reconstructs the flat raw arena and leaves Cluster/RunLocal, flow,
  positioning, measurement/query preparation and generic publication work in place.
- The current same-length sparse route clears optional font provenance, so a later length change can fall back.
  The current cap also sends 22k inputs to the ordinary producer.
- Reconsidering the preparation/publication boundary, retaining more derived summaries, and extending continuation
  reuse remain design work. No replacement architecture was selected or measured at this pause.

The current producer's proposed complete-operation budget was:
`old full HarfRust + old raw-output copy > bounded HarfRust + item scratch + flat reconstruction + policy/provenance/probes + ASCII-fact work`.
First-use screen/bootstrap and remaining downstream work must be included when evaluating it.

The immediate unfinished implementation checks are two Clippy findings in `ascii_anchor_policy.rs`:
`fixed_window` has eight arguments, and the right-anchor range loop triggers `needless_range_loop`.
No lint repair is included in this WIP snapshot.

The new runtime still needs its authenticated package archive and matching named Wasm, strict visual acceptance,
precisely identified owned-system allocation measurements, and complete comparative timings.
A raw-tail Labs harness passed its isolated policy tests. The raw32 collector source exists locally;
the independently authored validator and final frozen execution protocol are still unfinished.
No new product benchmark is active.

## Benchmark protocol the user requested

Future changed-candidate timings must use **both ABBA and ABAB** against main and published 0.1.0 separately,
including reversed orders BAAB/BABA. A = new candidate K; B = one control.
The planned eight epochs are M `KMMK`, P `KPPK`, M `MKKM`, P `PKKP`,
M `KMKM`, P `KPKP`, M `MKMK`, P `PKPK`: **32 fresh full-suite process arms**.

Freeze exact source, archives, shipping/named Wasm, raw-tail harness, commands, order and independent validation first.
Use two blocks, single-call sampling and fixed-20 warmup; the worker actually performs 21 untimed callbacks.
Use recorded sample counts, ordered untrimmed block vectors, absolute complete-operation p50/p90 and real arm times.
Keep patterns and controls separate in the analysis. No favorable replacement arms or result-dependent stopping.
Preserve tails; do not use contaminated p95 alone as failure. No 5% admission floor.
Measure only precisely identified owned-system allocations.

The seven families are dense 512/1,024; long edits/Unicode/shape/flow; selected copy/inspection;
small unchanged setters/ingress; sparse/root publication; tails/memory/delivery; width/cold/inspection.
Their canonical counts are 2/9/8/26/82/6/12. Published has two outline omissions:
copying per-glyph metrics with outlines after text change, and reading every outline from an unchanged copy.
Preserve the frozen canonical identity keys.

The earlier 18-arm matrix was not ABBA/ABAB.
Old Labs removed two low and two high samples per block before serialization; those missing values and
per-block membership cannot be recreated from its saved trimmed pool.
The successor raw-tail policy test preserves raw vectors and separately reconstructs legacy trimmed statistics.

## Source and local evidence locations

The remote branch contains source, tests and docs. Ignored archives, binaries, raw data and earlier local variants
remain on the original machine.

Important source files in this branch:

- `packages/glyph/rust/shaper/src/engine/{inline_leaf,cluster_state,run_local,state,layout_query,codec_gather}.rs`
  and existing flow/positioning/ordered-plan consumers.
- `packages/glyph/rust/shaper/src/ascii_anchor_policy.rs`, `src/unicode.rs`, and registered-font state in `src/lib.rs`.
- `engine/state_ascii_anchor_{runtime_oracle,acceptance_tests,policy_tests,adversarial}.rs`,
  four `engine/adversarial-fonts/*.sfnt` fixtures, and
  `packages/glyph/tests/integration/prepared-query-render-boundary.test.mjs`.

On the original machine, let
N = `/Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/evidence/canonical-occurrence-20261023`,
KP = N/`prepared-inline-leaf-prototype`.

- Older complete handoff:
  `/Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/evidence/boundary-wave-20261022/MODEL-HANDOFF.md`.
- Old full result:
  KP/`full-analysis-attempt01/{report.md,results.json,absolute.csv,blocks.csv,paired.csv}`,
  `full-independent-validation-attempt02.json`, `full-seven-family-decision-root.md`.
- Diagnostic captures/review:
  KP/`matched-attribution-evidence-review-fresh-sol-high.md` and the 16 preserved ABBA/ABAB CPU captures/summaries.
- Runtime work and correctness:
  KP/`ascii-anchor-first-runtime-budget-root.md`,
  `ascii-anchor-raw-flag-boundary-lemma-fresh-sol-high.md`,
  `ascii-anchor-runtime-meter-evidence-review-fresh-sol-high.md`,
  `ascii-anchor-runtime-acceptance-evidence-review-fresh-sol-high.md`.
- Latest actual native and package runs:
  KP/`ascii-anchor-runtime-final-full-native-gates-attempt01`,
  KP/`ascii-anchor-runtime-final-package-check-gates-attempt02`,
  KP/`source-audit-attempt60/audit.json`.
- Unfinished future timing tooling:
  KP/`raw32-collector-source/{PLAN.md,collect-raw32.mjs}` and revision-specific reviews;
  N/`source/.cache/labs-raw-tail-policy-attempt01` and the raw-tail policy source/reviews under KP.
- The frozen older K is N/`prepared-inline-leaf-source`.
  This snapshot came from KP/`ascii-anchor-runtime-final-checkout-attempt01`,
  verified against its 3,873-row post-format inventory.

The current [WIP log](../log/2026-11-20-held-rope-ascii-anchor-wip.md) records this push.
Opening status in older N/`LIVE-HANDOFF.md` or KP/`source-progress-checkpoint.md` may lag the actual receipts.
If local evidence is unavailable on another machine, identify what cannot be reauthenticated.

Preserved tools: Node 24.18.0, pnpm 11.15.1, Rust 1.97.1, Binaryen 129, mise 2026.7.6.
On the original machine, use the owned external task TMPDIR; system temp filled during earlier work.
Let the maintained package builder choose crate target directories.

Start by verifying branch/stack state and inspecting current source. Continue from these observed results.
