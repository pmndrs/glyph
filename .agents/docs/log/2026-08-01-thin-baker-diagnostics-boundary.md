---
type: Log Entry
title: 'Thin baker diagnostics boundary'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved direct Wasm timing and memory observation behind a private diagnostic-only TypeScript entry while retaining the Rust phase observer behind its non-default `profiling` feature. The production package-size build now rejects diagnostic module or symbol reachability, clock calls in thin baker hosts, and profiling/timing Wasm imports or exports; packed consumers receive no diagnostic module, and the package concept records exact thin-build, diagnostic-run, and evidence-refresh commands.
