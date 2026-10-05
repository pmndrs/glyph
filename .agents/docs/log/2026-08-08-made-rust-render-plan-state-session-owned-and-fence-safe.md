---
type: Log Entry
title: 'Made Rust render-plan state session-owned and fence-safe'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The 124-byte compiler-derived update request now carries
a monotonic renderer-fence acknowledgment distinct from consumed plan revision. Each session owns the Rust mixed-plan
dispatcher and pins its committed policy identity. Wasm prepares, validates, stages, and only then commits planner and
revision state; failure aborts the planner while preserving a valid already-completed fence acknowledgment. Host and
compiled-Wasm tests cover accepted/future fences and A/B preservation; host tests cover stale fences, abort/retry,
capability changes, and policy replacement. Post-prepare Wasm abort coverage waits on nonempty semantic input. Reachability
raises optimized Wasm from 739,909 / 272,624 / 214,395 to 822,443 / 308,033 / 242,447 raw/gzip/Brotli bytes. Mutation
sections still reject nonempty semantic input, so this publishes an empty Rust plan and makes no shaping/layout
latency claim; the shared-runtime size increase is now a measured optimization target.
