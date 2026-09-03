---
type: Research Concept
title: Paragraph-scoped synchronous measurement (11.17)
description: Implementation plan for the retained speculative measure transaction — a paragraph-scoped synchronous engine entry without plan compilation, revision burn, or a third result buffer, with identity reservation and next-frame candidate adoption.
documentation_type: explanation
status: draft
tags: [planning, engine, measurement, uikit, performance]
generated:
  by: 'anthropic/claude-fable-5'
  at: '2026-08-13T08:20:00Z'
sources:
  - id: engine-state
    resource: ../../../packages/glyph/rust/shaper/src/engine/state.rs
    title: Retained Rust text engine
  - id: transport
    resource: ../../../packages/glyph/rust/shaper/src/engine/transport.rs
    title: Frame transport arenas
  - id: uikit-integration
    resource: uikit-integration.md
    title: uikit integration seam
---

# Paragraph-scoped synchronous measurement (11.17)

Roadmap 11.17 implements the design the log recorded as "paragraph-scoped synchronous preparation without
triple buffering": one retained speculative session transaction, paragraph-keyed pending states, linear identity
reservation, explicit prepare/adopt/leave-committed modes, inactive-slot copied query results with host lease
retention, and next-frame candidate adoption before global plan compilation.

## Why: what a measurement pays today

The only `semantic_view_mask` gate in the engine is the record-emission stage. A measurement-only update still
pays, in order: full per-paragraph preparation across **every** paragraph in the session, full policy gather and
render-plan compilation (a changed constraint always sets `positioned_changed`, defeating plan reuse), semantic
records for every paragraph, full publication packing, the A/B result-arena flip with a publication-generation
bump — and a revision advance the renderer never consumes, which forces the **next real frame into a checkpoint
rebuild**. That last hazard is the largest hidden cost for reactive integrations that measure between frames.

No prepared state survives across calls: every `prepare_*` stage aborts its pending arena at entry, and identity
counters roll back on abort.

## The entry contract (layer 1)

`pmndrs_glyph_engine_measure_paragraph(session, request_offset, request_len, paragraph_id) → result pointer`

- Reuses the update request layout unchanged; the queried paragraph rides as an ABI argument.
- Runs validation and per-paragraph preparation for the queried paragraph only; skips revision bump, fence
  acknowledgment, gather, plan compilation, and publication.
- Emits measurement records for the queried paragraph into the **inactive** result slot without `publish_success`:
  no A/B flip, no generation bump. The host must copy the records out before its next update call (host lease).
- Terminates leave-committed: committed arenas untouched; the follow-up frame proceeds from pre-measure revisions
  with no checkpoint hazard.

## Later layers

2. **Retained speculative transaction + identity reservation** — fingerprint-gate the abort-at-entry discipline
   above `ParagraphState::prepare` (the write-only `geometry_fingerprint` is the ready-made hook; text and style
   need sibling fingerprints), preserve pending arenas and the identity high-water mark across sequential queries.
3. **Candidate adoption** — the committing frame compares input fingerprints per paragraph before preparation and
   adopts the measure transaction's pending state and reserved identities on a hit.
4. **Host fast path** — a core-host `measureParagraph` and a `Text.layout` route that uses it when only
   geometry changed; the uikit integration document gains the fast-path guidance.
5. **Evidence** — a measure-latency probe pinning the cost delta, roadmap 11.17 closure, and the decision-register
   row.

## Proof obligations

- The raw-Wasm regression (in the shaper-registration suite) proves: queried-constraint measurement, unchanged
  publication generation and engine revision, and an ordinary follow-up frame continuing from pre-measure
  revisions.
- Layer 2 adds: sequential queries extend one transaction; abort and adopt leave identical observable state to
  cold preparation (same stable ids, same measurements).
- Layer 4 adds: a Three-level test that repeated `measure` under changing constraints performs no
  publication flips and no checkpoint rebuilds.
