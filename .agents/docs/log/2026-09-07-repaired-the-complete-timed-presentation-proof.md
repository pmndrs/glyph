---
type: Log Entry
title: 'Repaired the complete timed Presentation proof'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Exact remote main and the candidate both exposed a state race:
timed playback initialized Advanced Shaping as automatic, then the location transition overwrote it with manual mode,
repeating only the first CJK case. Playback-aware initialization now preserves auto mode, and the probe records DOM
mutations across the whole scene rather than polling short cases sequentially. WebGPU and forced WebGL2 both render
every advanced case and complete the ten-scene retained-canvas sequence.
