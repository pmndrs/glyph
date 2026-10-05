---
type: Log Entry
title: 'Enabled workspace source-condition development'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Every TypeScript package subpath now exposes a custom `source`
condition, and both Vite applications opt into it for build, typecheck, and hot reload. Default consumers still resolve
built ESM and declarations; Wasm remains a distribution artifact.
