---
type: Log Entry
title: 'Renderer integration sequencing'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Kept Three.js/TSL as the merged v0 implementation through Slug, then scheduled the renderer-neutral direct integration extraction after all three rasters had executable resource, batching, composition, and lifetime requirements. Three.js remains a supported adapter; raw WebGPU and a possible TypeGPU adapter sit above the same boundary rather than entering shaping or layout.
