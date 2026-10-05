---
type: Log Entry
title: 'Three font bindings now retire at their real ownership boundary'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A disposed loaded font keeps its cached Wasm
binding and decoded renderer resources only while a registered stack still names it. The final shared stack lease
disposes the binding and then releases those resources; direct Wasm-count coverage proves the cache does not grow
across disposed-font churn, and host coverage rejects premature binding disposal while a stack is live.
