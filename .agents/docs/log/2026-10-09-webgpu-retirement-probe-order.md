---
type: Log Entry
title: 'Separate retirement observation from deferred ordering proof'
generated:
  by: openai-codex/gpt-6
  at: '2026-10-09T18:20:19Z'
---

Parent review of #285 removed the browser probe's race between observing a pending timestamp and clicking the backend switch. The maintained probe records the real retirement-boundary count and still requires the replacement renderer and absence of collected errors. Deferred timer and host tests remain the deterministic ordering proof. The earlier observed pending-count-one Chromium run is retained as scoped evidence, not a condition every browser must satisfy. Benchmark scripts typechecking and touched formatting passed after the correction; no new live browser run was performed. See the [benchmark package](../packages/benchmarks.md) and [original validation record](2026-10-09-webgpu-timestamp-retirement.md).
