---
type: Log Entry
title: 'Benchmark Presentation Mode'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added a canonical URL-backed `main`/`presentation` presentation axis without changing renderer ownership or live-scene keys. Presentation makes the workload canvas the fixed viewport, floats the technique/workload/font controls without a header container, stacks synchronized telemetry in a translucent right rail, exposes a collapsed Backend/DPR/workload-only controls accordion, and reports the active runtime/font/GPU payload as bottom-right pills. Main retains its existing desktop/tablet/mobile shell and gains one explicit Presentation entry action.
