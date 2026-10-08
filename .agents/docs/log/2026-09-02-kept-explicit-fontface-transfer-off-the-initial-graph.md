---
type: Log Entry
title: 'Kept explicit FontFace transfer off the initial graph'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved snapshot copying and transferred-graph reconstruction
behind the existing asynchronous `clone()` and serialized-load boundary while preserving the synchronous discriminator
and ownership claim. Initial Core drops by 2,888 raw / 1,050 gzip bytes and Three by 5,246 raw / 1,424 gzip bytes;
package graph assertions keep the transfer runtime lazy. The 933-test package/integration lane passed, the loader fuzz
smoke now asserts GLB-envelope safety instead of the removed validator's rejection volume, and the live 33-cell WebGPU
presentation sweep rendered every workload with zero missing glyphs and zero frames over 20 ms.
