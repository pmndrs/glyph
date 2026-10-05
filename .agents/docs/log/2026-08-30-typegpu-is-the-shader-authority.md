---
type: Log Entry
title: 'TypeGPU is the shader authority'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved the remaining Slug shader modules under `/typegpu`, added canonical TypeGPU Bitmap, MTSDF, and decoration stages, and replaced native TSL formulas with `@typegpu/three` adapters. Resource operations are specialized through slots and schema-aware accessors, so direct TypeGPU hosts, procedural consumers, raw WebGPU-backed resources, and Three data textures share the same algorithms. Device-free WGSL/GLSL tests cover every first-party adapter, and direct TypeGPU resolution tests prove texture-free function sources.
