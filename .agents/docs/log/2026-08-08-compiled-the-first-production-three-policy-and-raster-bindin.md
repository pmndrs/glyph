---
type: Log Entry
title: 'Compiled the first production Three policy and raster bindings'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

One deterministic policy now registers Bitmap,
MTSDF, and Slug together against the retained Rust planner. Draw identity includes numeric `material_id`; storage
identity excludes it, so a renderer may share physical buffers while splitting draws by material. Production binding
compilers lower every validated first-party raster record directly into one field-major request allocation, including
every bitmap strike, and exact tests compare every emitted lane with the established renderer-parity fixtures. Public
string technique and resource identities use deterministic UTF-8 FNV-1a `u32` wire IDs with one runtime-scoped
collision registry; collisions fail registration instead of silently aliasing. This checkpoint does not yet switch
the public Three adapter from its legacy paragraph batches.
