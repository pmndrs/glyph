---
type: Log Entry
title: 'Locked the Rust text-engine and retained render-plan architecture'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Expanded the narrower layout-boundary proposal
into one `no_std + alloc` Rust semantic pipeline for Unicode analysis, bidi, fallback, shaping, per-line editorial
composition, typography geometry, and policy-directed incremental render-plan compilation. The steady-state host
transaction is one revisioned Wasm update with A/B synchronous publication, worker-owned transferable buffers for
retained/asynchronous consumers, explicit return-to-worker retirement, invalidation-directed patches, and
scalar-versus-SIMD admission on the target 25,515-glyph workload. The plan makes sequential regions and declarative
exclusions one-call inputs, cuts unbounded publishing solvers and second authored text channels, and puts the
Wasm/policy/display-list proof before added typography. Review of the base font-fallback implementation also exposed
that its same-technique restriction came from the old one-program/one-schema API rather than shaping or measured
performance. D-161 now makes technique and resource binding properties of each loaded font, permits heterogeneous
same-runtime stacks, removes technique from user-facing `Text` and `TextGroup`, requires every first-party engine policy
to support Bitmap, MSDF, and Slug, and lets third-party policies declare a runtime-validated subset. The render plan
partitions resolved glyphs by technique/resource/program and publishes all participating resources atomically instead
of requiring synthetic composite techniques.
