---
type: Log Entry
title: 'measure() after a width change answers from flow and defers positioning'
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-23T00:51:34Z'
---

Built designs B (with C folded in) and D of
[measure() right after a width change](../planning/measure-after-width-change-2026-11-22.md), as
[decided](../planning/decisions/summary-only-reads-defer-positioning.md) on 2026-11-22.

- **Engine.** A read or batch without `glyphFacts` stops after flow layout. Its commit keeps the clusters, shaping runs,
  geometry, flow and boundary shape the positioned arena was built from in each stage's pending slot; publication,
  glyph, ink, copy and editing reads, a glyph-facts read and the next preparation of the paragraph restore those pairs
  and run the one positioning implementation. A measurement carries glyph facts exactly when its request asks for them
  (`GLYPHS_DEFERRED` otherwise). A read can return the prior glyph facts of the preparation it replaces
  (`priorGlyphFacts`; a batch names those paragraphs in a second trailer list), and a publication with `glyphFacts`
  alone returns them for the paragraphs prepared since the last publication.
- **TypeScript.** `ParagraphLayoutSummary` keeps its shape; `glyphCount`, `missingGlyphCount`, `inkBounds` and each
  line's `glyphStart`, `glyphCount` and `inkBounds` are computed on first read, for the preparation that summary
  measured (`internal/deferred-glyph-facts.ts`).
- **Oracle.** 56 references re-frozen; only `view.measured_first` flags, parent_id (glyph count), item_count,
  item_start and ink lanes of summary-only reads moved, every moved row checked to be a deferred glyph fact. The
  read-back after publication now asks for glyph facts. Native and wasm full tiers: 596 references equal, 0 unlisted
  divergences.
- **Timing, same-session headless Chrome, 3 loads, Latin 15k sweep step medians.** `measure()` reading a flow field:
  0.635 ms against 1.025 before and 0.560 on `main`. `measure().glyphCount` as the headline harness reads it: 1.22 ms
  against 1.01 before, because the glyph count is a second read that positions. Sweep frame totals 4.90 against 4.95
  before. Latin and 22k edit-row layout medians are 0.1 to 0.25 ms above before (the edit harness reads `glyphCount`
  every step); frame totals within 0 to 8 %.
