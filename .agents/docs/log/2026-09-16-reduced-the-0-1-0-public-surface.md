---
type: Log Entry
title: 'Reduced the 0.1.0 public surface'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Trimmed 239 distinct runtime export names to 149 and 40 ESM entry points to 15.
Consolidated React components and hooks on `/react`, portable formats on `/raster`, construction helpers on `/config`,
and shaders by backend. Made raw ABIs, host helpers, legacy assembly, shader math/reference utilities, and redundant
metadata helpers private. Updated consumers and documentation without an export allowlist or migration tooling.
Preserved TypeGPU PURE annotations so unused shader stages disappear from single-function consumer bundles; the retained
functions still resolve to WGSL. Shared React, raster, and config imports retain the same implementation modules as
direct imports. React retains its existing shared Three raster support. Fifteen of sixteen JavaScript graphs stay flat
or shrink under gzip; core grows by 20 B and TypeGPU integrations shrink by 2,039 and 3,097 B. Wasm artifacts are
byte-identical and all existing size ceilings pass. See [the package contract and measured comparison](../packages/glyph.md).
