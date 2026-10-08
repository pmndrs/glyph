---
type: Log Entry
title: 'Pending Text no-op lifecycle'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Semantic no-op `Text.setProperties` calls now preserve the active cold generation, abort signal, and readiness promise, including callback-only updates that publish to the latest `onLayout`. Failed generations clear their pending ownership so the same semantic input can retry. Deterministic delayed-decode and failure regressions prove both paths without timers.
