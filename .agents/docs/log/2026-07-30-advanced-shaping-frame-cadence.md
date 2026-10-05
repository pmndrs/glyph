---
type: Log Entry
title: 'Advanced-shaping frame cadence'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed the 65 ms typewriter throttle from the live Advanced Shaping workload. Playing state now advances one grapheme per application animation frame, so a 60 Hz display continuously exercises shaping and layout at up to 60 updates per second while pause, scrub, and exact grapheme boundaries remain unchanged.
