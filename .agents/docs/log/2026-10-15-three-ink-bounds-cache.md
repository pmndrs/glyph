---
type: Log Entry
title: 'Keep unknown Three ink bounds queryable'
generated:
  by: process:docs-new
  at: '2026-10-15T12:54:46Z'
---

A public `Text.measure()` followed by `computeBoundingBox()` incorrectly returned a cached empty Three box for visible
text. The aggregate query deliberately left `inkBounds` undefined, but the Three adapter treated that unknown extent as
an authoritative empty result. This also hid desired text edits and whitespace positioning.

The adapter now leaves its ink cache untouched when a nonzero-glyph summary has not positioned ink. A subsequent bounds
query requests positioned aggregate ink once; known same-revision bounds remain reusable. A zero-glyph summary still
proves a valid empty box without another positioning query. Spaces retain their authoritative finite zero-height extent.
Desired edits continue to invalidate the cache at their existing producer boundary. The correction adds no glyph-array
inspection, new public API or extra query to ordinary layout measurement.

The separate public regression uses a Blob-backed FontFace and proves visible bounds, one-time native anchor conversion,
repeat-query counts, empty/space-only results and desired edits. Its three cases fail against the previous runtime. See
[the package bounds contract](../packages/glyph.md) and [the Three measurement reference](../planning/three-api.md#measure-desired-layout-and-inspect-positioned-glyphs).

Validation: all three new bounds regressions pass against the owning production build and fail against the exact
previous Three runtime control. The combined 71-test focused lane and owning Glyph check pass, including 1,026
package/integration Node tests and its additional Rust, fuzz/baker, type/declaration, lint and formatting gates.
