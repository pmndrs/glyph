---
type: Log Entry
title: 'Isolated the remaining LayoutRun CPU regression'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added a maintained `position-query` benchmark that includes the
break-changing flow and positioning tail but excludes gather, plan compilation, publication, and inspection copies. At
623 rendered Bitmap glyphs the frozen main baseline measured `0.061 ms`; the initial cutover measured `0.109 ms`, and
compacting the shipping run-local row recovered only `0.004 ms`. Direct row addressing for source-order runs then cut a
stable 22k positioning comparison from `2.776–2.823 ms` to `2.695–2.701 ms`; the complete 22k Latin/CJK paths improved
from `4.067/3.650 ms` to `3.893/3.607 ms`. Embedding retained local origins into the existing 64-byte `LayoutGlyph`
row removed two parallel per-glyph vectors and brought the exact rebuilt Latin/CJK paths to `3.864/3.195 ms`; the
remaining gap to frozen main is `2.5%/7.4%`. A separate unchanged-publication fast path restored no-op updates to
`0.001 ms`. Both changed-width paths remain slower than main despite reducing writes from 170.4/171.7 KiB to
39.8/101.4 KiB, so milestone 12.2 remains active and compressed placement construction remains the primary CPU gap.
