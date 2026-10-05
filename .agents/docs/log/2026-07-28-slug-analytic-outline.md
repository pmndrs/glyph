---
type: Log Entry
title: 'Slug analytic outline'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Copied and adapted the older analytic quadratic-distance pass into one specialized fill-plus-outline material. Fill-only paint retains the original material and creates no outline buffer or pipeline; positive outline lazily adds per-instance color/width data and swaps the same mesh, while all states remain one draw. Restoring an all-zero run disposes the outlined geometry and its GPU attributes before publishing a fill-only replacement, so the steady resource cost returns to the original path and later outline paint allocates fresh instance data. A retained 128-pair same-build experiment accepts per-instance branching around analytic stroke evaluation: exact pixels and resources accompany 30.51% lower mixed-batch median paired GPU time on WebGPU and 23.96% lower time on forced WebGL2, while all-outlined guards remain below the 2% median-regression ceiling. Half-open band traversal covers every band reached by the bounded `0.05 em` width, with vertical fallback for quantized y-flat curves. A bounded `while` preserves fill's sorted-reference early exit without generated unreachable-break warnings.
