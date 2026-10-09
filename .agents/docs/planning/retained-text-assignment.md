---
type: Engineering Plan
title: Retained text assignment and incremental invalidation
description: Agreed assignment-first plan for sparse text updates, rope research, packed comparison, and Labs acceptance.
status: draft
tags: [performance, text, shaping, layout, swar, rope, labs]
sources:
  - id: xi
    resource: https://xi-editor.io/docs.html
    title: Xi editor and Rope Science series
  - id: wrapping
    resource: https://xi-editor.io/docs/rope_science_05.html
    title: Incremental word wrapping
  - id: summaries
    resource: https://xi-editor.io/docs/rope_science_01.html
    title: MapReduce for text
  - id: metrics
    resource: https://xi-editor.io/docs/rope_science_02.html
    title: Metrics
  - id: graphemes
    resource: https://xi-editor.io/docs/rope_science_03.html
    title: Grapheme cluster boundaries
  - id: bulk-wrap
    resource: https://xi-editor.io/docs/rope_science_06.html
    title: Parallel and asynchronous word wrapping
  - id: invalidation
    resource: https://xi-editor.io/docs/rope_science_12.html
    title: Minimal invalidation
  - id: bibliography
    resource: ../../../RESEARCH.md
    title: Primary-source research bibliography
  - id: encoding
    resource: ../../../packages/glyph/src/engine-encoding.ts
    title: Existing text mutation discovery
  - id: state
    resource: ../../../packages/glyph/rust/shaper/src/engine/state.rs
    title: Retained engine candidate and accepted text state
  - id: edit-bench
    resource: ../../../benches/labs/package/edit.bench.ts
    title: Long-paragraph typing Labs cases
  - id: spans-bench
    resource: ../../../benches/labs/package/adapter-publication.bench.ts
    title: Retained label and trailing-span Labs cases
generated:
  by: openai-codex/gpt-6
  at: '2026-10-09T15:21:10Z'
---

# Retained text assignment and incremental invalidation

## Agreed direction

Keep public `Text.set()` and whole-state assignment ergonomics. Derive invalidation within the existing engine pipeline,
using packed candidate and accepted text. Do not build a detailed multi-island edit table in JavaScript or introduce a
public edit API for this work. See the [accepted decision](decisions/retained-text-assignment-invalidation.md).

Keep one execution pipeline. Retained-boundary evidence selects reuse, bounded shaping windows, or whole-run work within
the same shaping/splice executor. A failed boundary proof broadens that scope; it does not enter a duplicated optimized
or conservative implementation. Font-fallback uncertainty continues through the existing fallback owner.

[#247](https://github.com/pmndrs/glyph/issues/247) names the performance frontier; its issue closure is not evidence that
large sparse assignments are fast. This plan records implementation and validation work, not a completed speedup.

## Research and limits

Xi's important model is retained results plus bounded invalidation across stages. Ropes provide chunked storage and
composable summaries; they do not eliminate inspecting a freshly assigned full string.[^xi] Incremental wrapping resumes
near an edit and stops when breaks converge; cold recomputation is the correctness comparison.[^wrapping] Retained
frontend validity avoids serializing every unchanged line.[^invalidation]

For Glyph, SWAR and rope-style storage address different costs: packed comparison finds changes; retained summaries and
storage can reduce subsequent copying, shaping, reflow, and publication. This application is an inference, not measured
Glyph evidence. The [bibliography](../../../RESEARCH.md) includes metrics, grapheme context, wrapping, and minimal
invalidation sources. Xi's proposed part 7 about spans and interval trees was never written.

Rust word comparison, fused JS packing with 32-bit comparisons, scalar scans, and SIMD are candidates. Do not assume a
packed loop beats native string equality, allocate a second packed copy just to compare, or use JS BigInt per word. Keep
Unicode boundary checks and sequential mutation semantics. A storage chunk is not a safe shaping boundary by itself.

### Applying the six Rope Science articles

The following are proposed Glyph applications of the linked research, not implemented storage or measured speedups.

| Article | Mechanism                                                                                                   | Glyph application and constraint                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Part 1  | Associative summaries retained at tree nodes; an edit recomputes affected ancestors.                        | Summarize hard breaks, lengths, and proven composable properties. Arbitrary shaped width is not an additive character metric. Full assignment still requires change discovery. [^summaries]                                 |
| Part 2  | Compatible text metrics and aligned secondary break storage; stateful boundaries are computed separately.   | Keep UTF-16 offsets, Unicode boundaries, and retained layout records aligned. Use conservative difficulty summaries to select scope within the existing pipeline. [^metrics]                                                |
| Part 3  | Context summaries avoid repeatedly scanning long regional-indicator sequences for parity.                   | Carry required Unicode context across chunks instead of treating leaf boundaries as grapheme boundaries. This historical discussion is not a current Unicode ruleset or a complete shaping-boundary algorithm. [^graphemes] |
| Part 5  | Retain breaks, restart before an edit, and stop after the edit when new breaks agree with the old result.   | Add multi-island flow reconvergence after the sparse shaping slice; preserve unaffected suffixes. Derive restart and convergence proofs for Glyph's full layout state. [^wrapping]                                          |
| Part 6  | Hard-break partitioning exposes independent wrapping work; initial layout and width changes need bulk work. | Reuse independence where proved, synchronously. Keep calls answering where invoked; no background wrapping or partially correct public reads. [^bulk-wrap]                                                                  |
| Part 12 | Lightweight retained validity, including partial validity, produces small downstream updates.               | Preserve dirty scope through gather, planning, and GPU publication; distinguish changed paint from changed glyph content. Reuse the existing accepted-state authority. [^invalidation]                                      |

Part 5 is particularly relevant to the remaining reflow cost: paragraph-level caching loses the information that only a
few lines changed. Xi restarts two breaks before an edit and stops at an agreeing break beyond it, under its wrapping
model. Glyph must prove an unchanged downstream input and equivalent continuation state, including shaping context,
flow constraints, line metrics, exclusions/drop caps, and any carried bidi state; equal offsets alone are insufficient.
For scattered edits, convergence before the next dirty island skips only the intervening unchanged region, not later
dirty work. Preserve suffix positions through a proven common displacement or recompute affected positions. This is a
Glyph adaptation to validate against full layout, not a claim that Xi's simple wrap rules transfer unchanged.[^wrapping]

Keep grapheme, line-break, shaping, and storage boundaries distinct. Use the repository's pinned Unicode data and
conformance vectors; the 2016 grapheme article illustrates context composition rather than supplying today's rules.
Test long regional-indicator sequences, combining marks, ZWJ sequences, and edits at chunk seams against cold output.
Safe grapheme segmentation alone does not establish independent font shaping.[^graphemes]

The next reflow slice should instrument visited lines and reused suffixes, then test split/merged hard breaks,
length-changing edits, scattered islands, and width changes against cold layout. Benchmark local and broad changes;
incremental bookkeeping must not penalize the bulk case. Carry the resulting changed ranges through existing publication
owners and validate emitted records, rather than rediscovering changes with whole-root scans. Xi's viewport-lazy cache
is separate future research; it must not make Glyph measurements depend on what is visible.[^wrapping][^invalidation]

## Proposed JS mini-shaper fallback

For a future JS mini-shaper, reuse the same invalidation rules with 32-bit packed comparison: combine two UTF-16 code
units as `(lo | (hi << 16)) >>> 0`, compare against retained words, and inspect mismatching words to recover code-unit
boundaries. An unrolled loop can compare several words per iteration; the final odd code unit needs a separate length-aware
check. Preserve explicit lengths so a trailing NUL cannot compare equal to missing text. Packing does not permit splitting
surrogate pairs or skipping grapheme/shaping-context rules. Prefer fusing comparison with already-required packing; avoid
an extra packed allocation solely for discovery and avoid BigInt per word. This is scalar word-at-a-time comparison,
not SIMD. Benchmark it against ordinary string equality and scalar discovery in Labs before adopting it. The JS
mini-shaper is deferred; this note neither changes the current engine plan nor introduces a JS edit-table producer.

## Work sequence and ownership

| Stage                 | Required change                                                                                          | Integration constraint                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Adapter spans         | Reuse canonical owned snapshots and styles; avoid repeated cloning and normalization.                    | Keep validation for caller-owned mutable input and existing React/Vue/Tres flows.   |
| Text preparation      | Compare candidate and accepted packed text; preserve unchanged unit identities and bounded invalidation. | Keep transaction abort/retry correct and ordered internal mutations meaningful.     |
| Shaping and layout    | Reuse only proven-safe shaping windows; reflow until retained results converge.                          | Prove context, bidi, ligature, fallback, and break correctness against cold output. |
| Codec gather          | Gather changed records without copying every later paragraph after a count change.                       | Reuse current gather ownership; no second gather cache or implementation.           |
| Render plan           | Retain unchanged entries, buffers, and draw metadata.                                                    | Exercise the ordinary production compositing policy, not a test-only fast path.     |
| Three synchronization | Restrict binding/visibility work to affected scopes.                                                     | Preserve same-traversal matrices for late-added siblings and inherited transforms.  |
| Edit/read loops       | Reuse prepared state for successive demanded reads and publication.                                      | Keep one accepted-state authority and avoid repeating whole-root work.              |

Each slice must remove or simplify the path it replaces. Extra retained metadata needs a measured purpose and one owner;
review additions for parallel caches, duplicated invalidation logic, dead paths, and missing normal update-flow wiring.
Rope/tree storage versus compact chunks remains an experiment: first establish where copying or scanning dominates.
[Adaptive dirty-range uploads](dirty-range-upload-research.md) owns GPU range coalescing and partial/full upload policy.

## Validation gate

Use Labs as the performance gate, not hero FPS or browser frame-time experiments. Compare exact candidate and main
revisions with equivalent warmup, workload, toolchain, and run conditions. Report absolute times and percentages, clock
drift, skipped cases, and uncertainty. Use the narrow appropriate benchmark label; avoid duplicate full Labs runs.

Existing cases cover long-paragraph insertion/removal with measure and publication, and a trailing paint-span mutation
across 1,000 labels.[^edit-bench][^spans-bench] They do not reproduce scattered character changes throughout one large
paragraph. The new [assignment suite](../../../benches/labs/package/sparse-assignment.bench.ts) fills that gap with one
18,432-unit paragraph and 8,192 paint spans, whole assignment through the public API, scattered changes, and normal
publication. Unchanged assignment and broad replacement are controls; length changes and Unicode have correctness
coverage. Input preparation stays outside timing, while setter, encoding, shaping, and publication stay inside.

Deterministic regression and seeded sequence tests compare retained results with fresh full recomputation: glyph IDs,
clusters, advances, positions, breaks, paint, and publication. Cover ligatures, combining sequences, surrogate pairs,
bidi, fallback, split/merged paint spans, reflow, accepted/rejected transactions, abort/retry, and edit/read loops. Verify
actual emitted wire records and shaped work separately from elapsed time. A kernel microbenchmark is diagnostic only.

## Recovery and current work

The first sparse-text slice derives packed two-unit deltas in Rust, preserves unchanged unit identities, visits retained
clusters once for all islands in LTR or RTL order, and executes bounded and whole-run scopes through one executor. It
collapses spliced pieces into one canonical source run so subsequent assignments remain eligible. Storage is still
retained vectors; balanced rope/chunk storage and multi-island flow reconvergence remain later slices. No rope
implementation or measured SWAR speedup is claimed.

Independent source review is clear after correcting quadratic window discovery and retaining public cold-output and
two-sibling lifecycle regressions. At rebased source revision `79537881`, 328 Rust library tests and 85 public integration
tests passed, as did source/declaration TypeScript checks, strict shaper Clippy, and the package-Labs workflow selector.
The assignment Labs comparison remains the performance acceptance gate. Main already contains unchanged-paragraph
preparation (#276), canonical spans/style deltas (#278), scoped Three synchronization (#279), and render-plan correction
(#274). Their individual evidence does not close #247; the issue and roadmap own landing status.

Runtime PIDs, sessions, and partial traces belong in ignored `.cache/agent-router/` manifests. They are not architectural
knowledge. Resume from this plan and its decision, inspect current commits and authoritative results, and update this
concept when evidence or scope changes. Milestone ordering remains in the [roadmap](../roadmap/roadmap.md).
