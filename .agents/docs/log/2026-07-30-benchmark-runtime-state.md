---
type: Log Entry
title: 'Benchmark runtime state'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved live controls and React-facing telemetry from the root harness into coherent Koota world traits while keeping Koota app-local. A dedicated world-instance module preserves identity across component Fast Refresh, the prop-free application child no longer subscribes to hot state, and typed telemetry histories remain renderer-owned while React summaries publish four times per second.
