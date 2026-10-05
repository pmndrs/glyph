---
type: Log Entry
title: 'Removed timing instrumentation and stale-output risk from the published Three graph'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The package no longer exports
or calls its temporary phase profiler. One-crossing integration evidence now wraps the Wasm export solely in the test
harness, while benchmark workload markers and outside frame timing remain application-owned. Package builds recreate
`dist` before TypeScript emission so deleted profiler and legacy modules cannot survive in a published tarball.
