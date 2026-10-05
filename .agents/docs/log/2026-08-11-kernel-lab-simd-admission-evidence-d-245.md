---
type: Log Entry
title: 'Kernel-lab SIMD admission evidence (D-245)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The complete scalar/auto-vectorized/explicit kernel comparison over
real paragraph arrays is recorded as shaper evidence. Explicit break-mask, bidi-transition-mask, and chunk-summary
kernels measure 7.6×, 4.8×, and 2.2× their auto-vectorized forms and are admitted with named consumers in the 11.14
line-planner tier; the pack loop and production policy interpreter confirm their prior scalar and explicit choices.
