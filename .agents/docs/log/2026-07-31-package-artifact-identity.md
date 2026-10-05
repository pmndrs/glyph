---
type: Log Entry
title: 'Package artifact identity'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Extended the existing single-build package-size lane with SHA-256 identities for each measured minified JavaScript payload and emitted Wasm module. Refreshed the stale Darwin arm64 size evidence from a clean reproducible build without adding a second artifact build to CI.
