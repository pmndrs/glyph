---
type: Log Entry
title: 'Pipelined GPU submission is measured and size-priced'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removing the accidental per-frame queue-completion fence
reduced changed-frame `render()` from 0.760/1.585 ms median/p95 to 0.300/0.645 ms in a paired 101-sample WebGPU run
on an Apple M2 Pro with a 16-core GPU on macOS arm64.
Portable resource realization adds 17,657 raw / 2,732 gzip bytes to Three while `/core` shrinks by 51,779 / 8,426;
the reviewed Three and first-party runtime ceilings now price those measured graphs without bundling TypeGPU.
