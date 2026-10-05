---
type: Log Entry
title: 'Made Rich Text mutation load refresh-rate independent'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Its rAF hook now publishes at most one latest-state update
per 60 Hz logical tick. The tick directly derives one continuously rate-scaled emphasis/tint state, so the 0%, 50%, and
100% controls do not republish duplicate content or replay skipped intermediate states. High-refresh duplicate frames,
disabled animation, and delayed-frame catch-up add no work.
