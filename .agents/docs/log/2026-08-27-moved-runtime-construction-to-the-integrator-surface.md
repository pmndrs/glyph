---
type: Log Entry
title: 'Moved runtime construction to the integrator surface'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Runtime-independent root `loadFont()` means applications no
longer encounter `TextRuntime`. The accepted plan moves runtime and host construction to `/core` and uses
`runtime.createTextEngineHost()` so the owner constructs and disposes its children directly. Core keeps `bindFont()` for
engine registration and rejects a vague `realizeFont()` API; renderer helpers use `initFont()` only when they actually
initialize a pooled physical resource set.
