---
type: Log Entry
title: 'Variants, reusable raster shaders, and direct TypeGPU engine'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced the over-constrained core “submission” contract with ordered `PreparedGlyphRun` values carrying resolved opaque batch/paragraph/span variants. Core still owns shaping, fallback, source order, physical resource partitioning, slots, canonical storage, and dirty/live ranges; engine programs now explicitly own variant compatibility and final draw splitting/coalescing. Split canonical Bitmap/MTSDF/Slug GPU evaluation into reusable backend `RasterShader` values so custom gradients/effects compose over the hard technique algorithm instead of rewriting it. Kept `TextEffect` as optional Three/TSL convenience over the default variant while admitting fully custom Three programs. Added the complete direct TypeGPU engine contract: caller-owned root/device/passes/RAF, explicit sync/async updates, retained paragraphs and transforms, exact-typed shader/program/variant associations, pass encoding, Wayfare program reuse, and optional `toTSL()` adaptation. Reconciled README, core, target, raster, Three, extraction, roadmap, decisions, and navigation around the new boundary.
