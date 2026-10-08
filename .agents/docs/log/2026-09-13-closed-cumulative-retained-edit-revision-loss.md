---
type: Log Entry
title: 'Closed cumulative retained-edit revision loss'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The recomposed-range shortcut now yields to the existing full
stable-identity revision scan whenever an out-of-range retained line had to be rematerialized. This prevents a zero
content revision from committing and rejecting the following adjacent edit. A focused Rust regression, 1,024-cycle
acknowledgement/reclamation test, and end-to-end CJK replacement/splice churn prove valid revisions, two-slot reuse,
scratch-capacity stability, and no post-warmup Wasm memory growth.
