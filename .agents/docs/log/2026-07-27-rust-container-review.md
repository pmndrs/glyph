---
type: Log Entry
title: 'Rust container review'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Evaluated `gltf`, `gltf-json`, `ktx2`, `ktx2_writer`, and Khronos KTX-Software against the runtime baker's `no_std + alloc`, size, error, and exact-write requirements. Retained the restricted GLB and R8/RGBA8 KTX2 serializers as package policy while keeping `ktx2` as the DFD/parser authority and the pinned Khronos validators as independent evidence; general scene models and full codec stacks remain host or future lazy-module candidates.
