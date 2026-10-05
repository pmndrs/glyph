---
type: Log Entry
title: 'Accepted the font/runtime ownership correction'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The implementation plan separates immutable, refcounted font
assets from runtime-private Wasm registrations; attaches every renderer host to one runtime owner; binds each session to
one policy and one abstract acceptance target; and retains Canvas, device, render-pass, and GPU realization ownership in
renderer packages. It records single-canvas, independent-canvas, lockstep, worker, and multi-integration topologies and
requires one canonical GLB backing with internal views. Deterministic owners reclaim every engine object, no strong
global cache owns Font lifetime, and an unreachable unused Font is collected normally, so finalizers are rejected.
