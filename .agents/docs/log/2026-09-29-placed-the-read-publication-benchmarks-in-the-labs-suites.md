---
type: Log Entry
title: 'Placed the read-publication benchmarks in the Labs suites'
generated:
  by: process:docs-new
  at: '2026-10-05T20:05:21Z'
---

The workloads from `glyph-package.bench.ts` moved into
`benches/labs/package/read-publication.bench.ts` with shared helpers in `read-publication.ts`, unchanged. Cases that
repeat work on mounted labels run in the new `read-publication` suite; cases whose every call mounts new text run in
the `cold` suite, so each suite times alike. The package runner's `--suite` replaces the earlier `--filter` option.
See [benchmark ownership](../packages/benchmarks.md).
