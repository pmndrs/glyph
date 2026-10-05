---
type: Log Entry
title: 'Made loaded R3F FontFace use synchronous'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

D-299 requires React to check `handle.isLoaded(selection)` before
conditionally calling React 19 `use(handle.load(selection))`. The graph publishes the complete decoded selection and
face lease before fulfilling the stable Promise, so the resolved render skips `use()` and pays no Promise, microtask, or
Suspense stall. Every resolved unloaded selection starts the same load; failures never publish partial readiness.
