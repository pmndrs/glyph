---
type: Log Entry
title: 'Realtime MSDF / Slug comparison'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Stopped conformance navigation from automatically entering the synchronous scalar CPU-reference loops that blocked the browser and let stale captures cross technique labels. Finite captures now begin only after an explicit run. Added an editable live comparison that renders aligned MSDF and Slug scenes into equal RGBA8 targets, samples both targets in one TSL fullscreen pass, and presents the candidates plus an 8× signed red/cyan coverage heatmap without readback or CPU composition. The permanent hardware probe commits custom text transactionally to both layouts, zooms to 4×, switches to finite conformance in under 8 milliseconds across retained runs without auto-starting it, rejects a completed run that crosses workloads, and returns to the live WebGPU comparison; forced WebGL2 also initializes without shader or validation errors.
