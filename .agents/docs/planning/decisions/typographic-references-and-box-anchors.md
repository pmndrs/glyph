---
type: Decision
title: 'Expose typographic references and keep box anchors in constraints'
description: 'Expose measured typographic references and keep shallow box anchoring separate from text flow.'
decision_status: Accepted
decided: '2026-10-15'
generated:
  by: process:docs-new
  at: '2026-10-15T02:12:13Z'
---

# Expose typographic references and keep box anchors in constraints

## Decision

Keep typography in style, text flow and line alignment in layout, and the box reference in
`constraints.anchor: { x?, y? }`. Anchor tokens name geometric box references or the exact kebab-case public metric.
Keep first/last line selection distinct from alphabetic/ideographic baseline type. Measurement and glyph columns retain
paragraph-local coordinates; `anchorOffset` carries the host-placement translation. Composition remains shallow,
including the complete anchor object; callers spread an existing anchor to retain one axis.

## Why

Baseline layout needs font/line/paragraph metrics rather than per-glyph ink inspection. The
[SkParagraph](https://github.com/google/skia/blob/main/modules/skparagraph/src/Run.h) reference distinguishes computed
paragraph baselines from font-authored data. Glyph preserves its established primary-face stack policy and exposes
scaled font metrics plus OS/2/fallback provenance; it does not imply OpenType BASE coverage. See
[issue #307](https://github.com/pmndrs/glyph/issues/307) and the
[public contract](../../planning/core-api.md#layout-query-values).

## Consequences

The API adds computed alphabetic/ideographic baselines, cap/x-height references and placement anchors without changing
default placement or property-list merging. Hosts keep accepted geometry and anchor placement transactional while
allowing anchor-only host updates. Ordinary baseline placement uses allocation-light `measure()`. Script-specific BASE
tags and additional baseline families remain outside this change. The semantic-query wire record grows by eight bytes;
render records are unchanged. This is additive and supersedes no prior decision.
