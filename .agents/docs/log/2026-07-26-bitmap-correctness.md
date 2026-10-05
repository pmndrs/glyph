---
type: Log Entry
title: 'Bitmap correctness'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Corrected the native strike contract after visual inspection exposed distorted thin stems: the baker now records Zeno's integer mask placement in strike-pixel units instead of mapping final texels back onto analytic outline bounds, and the shared TSL vertex graph snaps projected edges to physical framebuffer pixels. A Rust invariant proves native plane/atlas dimensions match, while a benchmark-only CPU compositor matches every normalized WebGPU/WebGL2 byte at 1× and 2× despite a deliberately fractional unsnapped origin. Both backends now share complete hashes per DPR and 3,473 half-coverage pixels. The optimized bitmap baker shrank from 657,942 to 612,472 bytes after removing the unused unscaled metrics path. A package-owned one-line `@types/three` patch fixes the `modelViewProjection` `vec4` contract; scalar TSL construction keeps TypeScript 7 checks below one second. Hinted grayscale and optional four-phase RGBA/R8 packing are documented research, and LCD/ClearType rendering is explicitly out of scope.
