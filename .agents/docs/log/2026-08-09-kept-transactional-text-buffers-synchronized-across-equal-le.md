---
type: Log Entry
title: 'Kept transactional text buffers synchronized across equal-length edits'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The retired UTF-16 and stable-identity
buffers now copy only the proven changed range after commit or restore on abort, so the next replacement does not
begin by cloning the paragraph. A 101-update rerun measured 7.633 ms median / 9.358 ms p95 against the preceding
7.668 / 9.620 ms, while optimized Wasm shrank 520 raw bytes to 1,137,874. This removes redundant work but is not a
latency claim; inserts and deletes still await the bounded semantic chunk gaps.
