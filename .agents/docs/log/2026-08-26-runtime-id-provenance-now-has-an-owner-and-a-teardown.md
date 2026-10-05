---
type: Log Entry
title: 'Runtime ID provenance now has an owner and a teardown'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Module-authored policy and buffer constants keep the
top-level `id()` path, while `TextEngineHost.id()` owns dynamic binding, stack, session, material, paragraph, style,
flow, and region registrations. Host disposal releases those collision records after attempting every Wasm teardown,
and the renderer-neutral Paragraph context now follows `TextRuntime` disposal just as the Three coordinator already
did. The example engine no longer asks callers to invent stack or session IDs it can allocate itself; stack
registration returns the one handle text options genuinely reference.
