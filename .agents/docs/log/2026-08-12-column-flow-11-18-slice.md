---
type: Log Entry
title: 'Column flow (11.18 slice)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`ParagraphContentBox` gains `columns { count, gap }`, mapping the public `Text`
onto the engine's already-proven ordered multi-region flow: side-by-side region rectangles inside the exact
content-box width, filled in order without balancing. The column height is the flow signal, so columns require
an exact width and a bounded height, both rejected loudly at construction; column zero keeps the paragraph's
region id, so single-column request bytes are unchanged. The editorial workload becomes a real page — one
single-measure justified lede over a body flowing through two justified columns with indent and bounded
elasticity, batching to three draws (lede plus one clipped draw per column) over 869 glyphs at 120 FPS. The
drop-cap exclusion surface stays with 11.18 proper. One misstep recorded: the first workload rewrite was a
silent no-op — a source replace anchored on pre-formatter text matched nothing and reported success; the stale
768-glyph telemetry exposed it, and the redo asserts its anchors.
