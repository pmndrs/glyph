---
type: Log Entry
title: 'Native TypeScript containment'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced the defective shim-level watchdog with a repository-owned runner that resolves and supervises the pinned native TypeScript 7 executable directly, proves hard-kill and reaping against a synthetic allocator, caps tracked RSS at 2 GiB, and routes package, application, and build-script compiler entry points through the same boundary. The TSL skill now requires narrow free-function fixtures before whole-project checks.
