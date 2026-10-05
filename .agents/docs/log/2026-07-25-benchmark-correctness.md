---
type: Log Entry
title: 'Benchmark correctness'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Passed real sample indexes to targets, rejected invalid run counts before loading, removed the unreachable failed-summary state, and made every successful result self-describing with `schemaVersion` and `controls`; Chromium verifies the emitted envelope and stable synthetic output.
