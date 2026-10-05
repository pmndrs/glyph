---
type: Log Entry
title: 'Contributor workflow cleanup'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Limited the root command surface to `bake`, `dev`, `build`, `test`, `check`, and `scripts`; library manifests now expose only build, test, and check, while the benchmark app additionally exposes dev. Replaced duplicated command-family routers with one source-metadata index that validates and describes specialized fixture, release-evidence, fuzz, profiling, capture, and hardware-browser workflows. Removed closed-milestone probes, rejected experiment runners, and implementation-shaped benchmark tests superseded by public package integration, headless product, sequential Presentation, timed-demo, and exclusive finite-job recovery gates. Agent guidance now requires `pnpm scripts list/show` before inventing a maintenance command.
