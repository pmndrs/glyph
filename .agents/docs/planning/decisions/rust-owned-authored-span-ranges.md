---
type: Decision
title: 'Resolve authored span ranges in Rust'
description: 'Keep authored UTF-16 span offsets in TypeScript and make the existing Rust text-preparation pipeline the sole production authority for grapheme-range resolution.'
decision_status: Accepted
decided: '2026-10-11'
supersedes:
  [
    'D-265 JavaScript ownership and observable-array clauses',
    'D-320 remaining production grapheme helper clause',
    trusted-cluster-aligned-span-handoffs,
  ]
generated:
  by: process:docs-new
  at: '2026-10-11T15:18:21Z'
---

# Resolve authored span ranges in Rust

## Decision

TypeScript continues to author, compose, snapshot, and serialize text and span updates using the existing API. It preserves
authored UTF-16 offsets and does not segment text or align span boundaries. The existing Rust preparation path validates
those offsets and resolves them against its grapheme boundaries before shaping. A grapheme keeps the style of its base;
boundaries advance to the grapheme end, and a range that collapses remains authored so later text edits can make it active.

Retained styles therefore keep both authored and effective offsets. When a text edit changes the grapheme grid, Rust
recomputes effective ranges from authored offsets before resolving styles. This stays in the single existing preparation
pipeline and ABI; it does not add a parallel span engine or a new public edit API. JavaScript Unicode segmentation remains
available only as an independent test oracle.

## Why

The old TypeScript normalizer duplicated grapheme analysis and tracked provenance so adapters could skip repeating it.
Making Rust authoritative removes that production segmentation path and lets it re-resolve retained style ranges using
the same Unicode state it already computed for shaping.

## Consequences

Public `txt`, `span`, and `Text.set()` authoring syntax stays the same. Observable span ranges now preserve caller-authored
offsets instead of exposing JavaScript-expanded ranges; this is an intentional contract change. Tests protect layout and
style semantics across combining-mark edits, split-cluster inputs, and Unicode conformance rather than requiring the old
normalized JavaScript representation. Release notes must call out the observable range change before publishing.

The implementation is in the [Rust style arena](../../../../packages/glyph/rust/shaper/src/engine/style_state.rs) and
[paragraph preparation](../../../../packages/glyph/rust/shaper/src/engine/state.rs). The test-only grapheme oracle lives
under `packages/glyph/tests/support/`. Performance comparison against exact main remains pending.
