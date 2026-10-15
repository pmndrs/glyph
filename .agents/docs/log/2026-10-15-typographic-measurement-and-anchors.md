---
type: Log Entry
title: 'Add typographic measurement references and box anchors'
generated:
  by: process:docs-new
  at: '2026-10-15T02:12:13Z'
---

Added primary-face line font metrics, cap-height/x-height provenance, computed alphabetic/ideographic references and
shifted cap/x-height top positions to Glyph's aggregate measurement API. Added shallow `constraints.anchor` and measured
`anchorOffset`; preserved paragraph-local measurements, default placement and stable glyph identities. The
[decision](../planning/decisions/typographic-references-and-box-anchors.md),
[core contract](../planning/core-api.md#layout-query-values),
[Three reference](../planning/three-api.md#measure-desired-layout-and-inspect-positioned-glyphs), and
[package concept](../packages/glyph.md#semantic-queries) define ownership and coordinates.

The font-height fallbacks are deterministic estimates (rounded 0.66em cap height and 0.5em x-height), not OpenType BASE
coordinates. Existing primary-face line metrics stay stable across glyph fallback; mixed authored styles aggregate
font and shifted height envelopes. The query record grows 76 to 84 bytes, with no render/Codec-record change.

Deterministic tests cover measured references, line spacing and paragraph spacing, empty text, exact/at-most sizing,
mixed authored sizes and fallback, dynamic edits, every anchor token, whole-object shallow replacement and explicit
spreading. Adapter cases inspect actual direct/indexed draw transforms, bounds, glyph measures, carets, selection,
independent copies and pending/rejected publication. React/Vue exercise the same constraints through real framework
renderers; TypeGPU records the position uniform using real engine output. A query counter proves anchor-only edits reuse
layout without another Wasm measurement crossing. Final command evidence is recorded in the source attestation.
