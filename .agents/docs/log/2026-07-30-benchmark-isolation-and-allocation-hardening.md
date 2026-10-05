---
type: Log Entry
title: 'Benchmark isolation and allocation hardening'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Made Presentation an exclusive root presentation with no hidden Main or Conformance subtree, added one-renderer lifecycle diagnostics and rapid-switch coverage, removed duplicate React live-stat ownership, eliminated common telemetry ring and empty-poll allocations, retained Paint & Effects source spans and dynamic-workload scratch storage, reused `Text` glyph-paint topology, added an MTSDF color-only update path, and made renderer teardown await outstanding WebGPU timestamps.
