---
type: Log Entry
title: 'Stabilized retained Icon Grid recycling'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Corrected the engine host's aggregate/per-paragraph limit split so 684
paragraphs no longer each reserve line scratch for the entire batch. A deterministic 200-cycle regression replaces
the former 17-update, 4.29 GB status-7 failure. Icon Grid now scrolls through its camera, avoids layout queries in
renderer telemetry and recycling, publishes each recycled window once, and leaves Bitmap pixel snapping opt-in.
Clean Chrome samples on the 120 Hz development display held roughly 116–120 FPS across Bitmap, MSDF, and Slug.
