---
type: Log Entry
title: 'MTSDF generator admission'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Began roadmap item 8.1 by auditing current generator candidates before adding a dependency. Pure-Rust `klyff_msdf` 0.1.3 is the leading patch candidate, but its published core is not `no_std`, defaults to a second older Skrifa, exposes panic/assert paths, builds an unconditional per-outline diagnostic string, and documents quadratic flattening during intersecting-shape cleanup. Native Chlumsky `msdfgen` remains the test-only quality oracle. Milestone 8 now requires upstreamable hardening, Wasm/size evidence, deterministic oracle comparison, malformed-input coverage, and cargo-fuzz admission before item 8.2.
