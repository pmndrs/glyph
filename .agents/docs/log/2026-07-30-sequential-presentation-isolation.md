---
type: Log Entry
title: 'Sequential Presentation isolation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Made workload transitions install a complete view/layout/animation/paint default snapshot, prevented the outgoing Paragraph Stress RAF from overwriting the requested workload, and atomically replaced workload-local camera and transform state without replacing the route renderer. A package-owned Playwright probe clicks all seven Presentation workloads in order, requires one canvas and renderer, validates the applied defaults and camera projection, rejects browser warnings, and measures visible foreground pixels so a telemetry-valid black frame cannot pass.
