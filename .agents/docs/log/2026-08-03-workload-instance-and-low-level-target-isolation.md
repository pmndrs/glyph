---
type: Log Entry
title: 'Workload instance and low-level target isolation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved Icon Grid's active virtual window, recycle epochs, pan/autopan smoothing, refresh suspension, visibility, and metrics into one per-mount workload instance while leaving renderer, RAF, font transactions, scene attachment, and telemetry in the persistent host. Extracted Main/Presentation composition, runtime control binding, benchmark surface chrome, and bake progress into named React modules. Added a common target-owned MTSDF/Slug conformance session that forwards the borrowed renderer and abort signal while retaining renderer-private resources behind adapters. The first browser pass exposed Text Ladder's offscreen scene transform leaking into Zoom Text; explicit per-workload scene initialization corrected the black frame. The repeated 42-cell dual-backend Presentation matrix then completed with visible pixels and one renderer per lane, all 19 isolated headless conformance scenarios passed, React Doctor reported zero diagnostics, and the complete deterministic benchmark gate passed 301 tests.
