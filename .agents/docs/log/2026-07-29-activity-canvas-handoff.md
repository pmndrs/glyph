---
type: Log Entry
title: 'Activity canvas handoff'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Traced WebKit's `null is not an object (evaluating 'array[offset]')` to Three's WebGL state initialization: a reconnected React Activity reused the same DOM canvas after Three had deliberately lost its context, so `SCISSOR_BOX` and `VIEWPORT` were null before `Vector4.fromArray`. Mode transitions now replace the renderer subtree's canvas while preserving Activity-owned navigation state; serialized teardown still prevents overlapping live renderers.
