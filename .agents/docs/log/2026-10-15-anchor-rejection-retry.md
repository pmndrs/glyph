---
type: Log Entry
title: 'Retry rejected output when its anchor changes'
generated:
  by: process:docs-new
  at: '2026-10-15T02:52:34Z'
---

An anchor edit now retries a previous rejected semantic publication. The first implementation reused measured layout
whenever content and box sizes matched, even when the engine had adopted output the renderer had rejected. This left
the renderer's accepted geometry at the old paragraph while the desired paragraph stayed pending.

The shortcut now requires equal engine and accepted-renderer revisions. A mismatch follows the existing normal update
and checkpoint path; ordinary accepted paragraph anchors retain their cached-layout path. Tests reproduce failure in
both Three and TypeGPU, preserve the old accepted transform during rejection, and then recover by changing only the
anchor. The regressions fail without the frontier guard. See the
[package publication contract](../packages/glyph.md#semantic-queries) and
[anchor decision](../planning/decisions/typographic-references-and-box-anchors.md).

The repository CI also identified two benchmark raster test fixtures constructing the previous `GlyphLayout` shape.
Their synthetic font/reference metrics now match the extended public result; the raster behavior and expected pixels
are unchanged.
