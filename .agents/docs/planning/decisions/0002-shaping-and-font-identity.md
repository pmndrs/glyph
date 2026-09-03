---
type: Architecture Decision Record
title: Universal shaping and font identity
description: Records the accepted HarfRust, Unicode, paragraph, and registry-scoped identity architecture.
status: stable
tags: [architecture, shaping, unicode, paragraphs, identity]
sources:
  - id: decision-register
    resource: ../decision-register.md
    title: Decision register
  - id: shaping
    resource: ../shaping-data-contract.md
    title: Shaping data contract
  - id: api
    resource: ../api-shapes.md
    title: Runtime and bake API V0
generated:
  by: openai-codex/gpt-5.6
  at: '2026-07-26T19:51:43Z'
---

# ADR 0002: Universal shaping and font identity

Date: 2026-07-26  
Status: Accepted  
Decisions: D-010–015, D-020, D-024, D-040–045, D-069, D-072, D-085, D-088

## Context

Text layout depends on input text, script, language, direction, features, font data, and line context. Prebaking every possible result is unbounded, while coupling shaping to a raster makes multiple renderers disagree about glyph identity and layout.

## Decision

One `no_std + alloc` HarfRust Wasm shaper serves every raster and supported horizontal script; pinned HarfBuzz is the independent oracle. Font-scoped `u16` glyph IDs and UTF-16 cluster offsets cross a generated direct-memory ABI as structure-of-arrays output. Registry generations own font handles and cached shape plans. JavaScript owns Unicode 17 analysis, bidi, line breaking, paragraph caches, measurement, and positioning while shaping remains in Wasm. Width changes reflow and reshape only affected boundaries.

## Alternatives considered

- Fully prebaked shaping was rejected because the input/state space grows combinatorially and cannot cover editable text or contextual line changes.
- Raster-specific shapers were rejected because they duplicate semantic code and permit renderer drift.
- A hand-written OpenType parser was rejected in favor of maintained Fontations and HarfRust implementations.
- Whole-paragraph reshaping on every width change was rejected because measured boundary reshaping preserves correctness with less work.

## Consequences

- A font handle is meaningful only within its live registry generation; stale handles always reject.
- Shaping and layout tests compare exact glyph IDs, clusters, positions, flags, breaks, and policies, not only glyph counts or dimensions.
- Horizontal CJK conformance is proven before rendering, while raster paging and vertical layout remain separate milestones.
- Browser JIT, per-font compiled shapers, MLIR, and GPU shaping remain research until they beat the universal path under the full guard corpus.

## Evidence

Inter, Amiri, and Noto CJK fixtures pass source/reduced HarfRust equality, pinned HarfBuzz comparison, Unicode conformance, paragraph layout, malformed-input, fuzz, Node, Chromium, and live-GPU execution. Same-artifact re-registration proves new handles without reviving stale shaping state.
