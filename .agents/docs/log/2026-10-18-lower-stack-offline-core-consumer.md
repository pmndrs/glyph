---
type: Log Entry
title: 'Lower stack offline core consumer peer isolation'
generated:
  by: process:docs-new
  at: '2026-10-18T17:54:29Z'
---

The [benchmark owner](../packages/benchmarks.md) installs its packed core consumer offline with the required peers
explicitly pinned. Its existing pnpm invocation now disables automatic installation of optional peers, so an unrelated
optional renderer peer cannot trigger an offline resolution failure. This promotes the already verified tooling
correction to the lowest held layer; the final script matches the prior top-layer implementation byte for byte.
No package dependency, lockfile, runtime source or network fallback changed.

The coherent lower repair passes the full Glyph package check. Benchmark TypeScript, lint and format checks pass;
157 Vitest tests, 24 workflow tests, 16 Chromium conformance cases and the installed packed-consumer browser proof pass.
The enclosing benchmark check retains exit 2 because its final app build ran out of disk space. After task-owned Rust
build caches were copied to Depot with every file SHA-256 verified and original paths retained as symlinks, the
canonical benchmark package build exits 0, including runtime packages and the final app. A separate narrow build
recovery also exits 0; it is not substituted for the canonical result. No prior failed process was relabeled.
All owned Portless routes, proxy and ports were cleaned up. These are correctness and build results, not performance
measurements. The stack remains held and unmerged.
