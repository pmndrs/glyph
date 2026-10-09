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
  at: '2026-10-09T14:00:00Z'
---

# Retained text assignment and incremental invalidation

## Agreed direction

Keep public `Text.set()` and whole-state assignment ergonomics. Derive invalidation within the existing engine pipeline,
using packed candidate and accepted text. Do not build a detailed multi-island edit table in JavaScript or introduce a
public edit API for this work. See the [accepted decision](decisions/retained-text-assignment-invalidation.md).

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
paragraph. Add a deterministic Labs case for that workload: whole assignment through the public API, fixed-size text,
several separated changed islands, thousands of paint spans, then normal publication. Include unchanged assignment and
broad replacement controls; cover length changes and Unicode through correctness tests. Input preparation must not
silently hide the setter, encoding, shaping, or publication cost being optimized.

Deterministic regression and seeded sequence tests compare retained results with fresh full recomputation: glyph IDs,
clusters, advances, positions, breaks, paint, and publication. Cover ligatures, combining sequences, surrogate pairs,
bidi, fallback, split/merged paint spans, reflow, accepted/rejected transactions, abort/retry, and edit/read loops. Verify
actual emitted wire records and shaped work separately from elapsed time. A kernel microbenchmark is diagnostic only.

## Recovery and current work

As of 2026-10-09, implementation is still in isolated worktrees. No rope implementation or SWAR speedup is claimed.
The sparse-text agent removed its JS multi-island producer and is moving derivation into Rust preparation. Retained-span
normalization and render-plan production-path corrections are also in flight. Parent review, Labs comparison, and
integration remain required before landing.

Runtime PIDs, sessions, and partial traces belong in ignored `.cache/agent-router/` manifests. They are not architectural
knowledge. Resume from this plan and its decision, inspect current commits and authoritative results, and update this
concept when evidence or scope changes. Milestone ordering remains in the [roadmap](../roadmap/roadmap.md).
