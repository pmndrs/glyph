---
type: Log Entry
title: 'Retained controls'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Confirmed the benchmark production graph uses the pinned React Compiler runtime, then removed a renderer-level source of flashing: non-layout controls no longer recreate and swap every `Text` object. Paint, animation, shadow, stroke, and inspection toggles now update the retained scene in place, with unit classification and a causal live paint-revision guard against batch reset.
