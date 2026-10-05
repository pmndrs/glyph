---
type: Log Entry
title: 'MTSDF phase attribution'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added a package-owned small, medium, complete, and combined profiler over the shared optimized native, direct-Wasm, and serial-Worker bake paths. Authenticated measurements isolate texel generation as the dominant phase while separately recording selection, outlines, packing, KTX2, GLB, transfer, and memory high-water evidence. The profiling-only TypeScript and Rust entry points stay outside production execution; the rebased Darwin arm64 production MTSDF baker measures 552,025 raw / 215,027 gzip / 169,041 Brotli bytes.
