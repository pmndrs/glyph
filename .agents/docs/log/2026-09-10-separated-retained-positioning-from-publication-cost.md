---
type: Log Entry
title: 'Separated retained positioning from publication cost'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added the maintained `adopt-position-query` benchmark case:
it prepares the complete borrowed-layout positioning transaction, then times only adoption, retained gather, plan
compilation, and publication while requiring a nonempty changed-width patch. On the final 40-warmup/101-sample Latin
fixture, measurement is `0.220 / 0.227 ms`, measurement plus positioning is `1.222 / 1.248 ms`, and the isolated
adoption/publication tail is `1.655 / 1.688 ms`; the corresponding dense-CJK publication tail is `0.973 / 0.998 ms`.
The exact 174,440/175,824-byte outputs confirm that the next performance frontier is core publication of the aligned
per-glyph f32x2 occurrence lane, not line fitting or a missing Three subrange update.
