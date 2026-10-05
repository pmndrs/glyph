---
type: Log Entry
title: 'Removed the layout profiler and moved debouncing to the controls'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The opt-in phase profiler came out once its evidence was recorded, returning 3,026 raw and 253 Brotli bytes, mostly from its call sites rather than the module; the browser-core ceilings were lowered to track what the tree now measures rather than leaving the slack it had been holding open. The comparison workload had been debouncing by discarding work inside its own update path, merging successive configurations into the pending one, so a dragged control reported the cost of the two updates that survived rather than the twenty it requested — a measurement of the queue rather than of the workload. Debouncing moved to the control a person drags, where dropping a superseded value is free, and the scene's queue became first-in-first-out. Placing that debounce in the viewport effect first was a mistake worth recording: the paragraph-stress motion drives layout width and font size through that same path, ramping the width roughly every 42ms across its first 1.76 seconds, so a 48ms window would have stalled the workload instead of settling an input.
