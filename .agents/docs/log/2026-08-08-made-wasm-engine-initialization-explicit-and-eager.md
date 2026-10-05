---
type: Log Entry
title: 'Made Wasm engine initialization explicit and eager'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The compiler-derived ABI now publishes `initialize()`, and
the standard host invokes it immediately after instantiation so module state is not lazily allocated by the first
font, session, or update operation. The focused compiled-Wasm frame test exercises the export. Concrete 32,768-record
shaping/layout lanes have not landed, so this checkpoint does not claim first-shape allocation or latency evidence.
