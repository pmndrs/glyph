---
type: Log Entry
title: 'Paragraph spacing and first-line indent (11.14, layer 2)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The typography controls begin steering layout:
`spaceBefore` shifts a thread's first band exactly once where the paragraph truly starts (resumed threads and
region breaks swallow it, matching fragmentation convention), `spaceAfter` rides every block measurement so
consumers stack paragraphs from reported extents, and `firstLineIndent` narrows the paragraph's first composed
line and shifts the pen on the paragraph-direction side — LTR pens move right, RTL pens keep their origin while
the reduced available width pulls the right edge inward, so alignment and justification compose over the reduced
slot unchanged. Measurements mirror both: first-line inline extents include the indent, and the intrinsic pass
reuses the same constraint-carried values. The public `Text` gains `wordSpacing` style and the contentBox
typography fields. Proven red-green at three levels: flow-composition unit tests (band shift, resume immunity,
break narrowing), a measurement unit test (indent in inline extent, space-after in block extent), and a Three
integration segment pinning exact pen shift, baseline shift, and content extents through the real Wasm engine.
