---
type: Log Entry
title: 'The animation API is a snapshot you can hold, and the extents were already computed'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`snapshotGlyphOrigins`/`setGlyphOrigins`/`clearGlyphOriginOverrides` is replaced by
`snapshotGlyphs`/`applyGlyphs`/`restoreGlyphs` over one `GlyphPlacements` structure that addresses
glyphs, words, and lines directly, names its coordinate space in the type, owns the identity that survives
reflow, reports every glyph it could not read, and applies totally or returns what it did not reach
(D-270). Two defects surfaced while porting the one real consumer, and both were invisible before.
First, the retained per-glyph lane holds a different thing in each technique — MSDF and Slug store the ink
box's corner, Bitmap stores the origin plus the baked strike's raster bearing — so it is now addressed as
displacement from the plan's own rest value, which is technique-free and needs no schema declaration
(D-267); a declared coordinate space was built first and rejected because it could not name Bitmap's case.
Second, `write_semantic` names every field it serializes, so the five new record fields shipped as silent
zeros until a round-trip test demanded that no four-byte window of a fully-populated record stay unwritten.
Per-glyph advance and ink extents, per-line ascent, and the paragraph ink union are carried out of
`positioning.rs`, which already computed all of them for its render records and dropped them (D-268);
advance and ink extents ship side by side under names that cannot be confused, because a flex host needs
one and visual centring needs the other (D-269). On top of the extents, `caretAt` and `selectionRects`
resolve to clusters rather than to JavaScript characters. `glyphFlags` bit names are exported from the
generated ABI, pinned to HarfRust by a test; the unreachable tatweel bit is deliberately unnamed. The React
inline props type is split into `TextSpan` (D-271), so a transform or a `ref` on a run is a type error
instead of a silently discarded prop. `commitState()` is the positive commit signal (D-272). The port lost
its hand-written identity builder, its parallel-array assertion over six public arrays, and its
double-snapshot staleness re-check: 271 lines to 204, with the three things it was compensating for now
guaranteed by construction.
