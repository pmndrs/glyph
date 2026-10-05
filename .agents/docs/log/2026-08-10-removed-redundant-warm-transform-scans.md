---
type: Log Entry
title: 'Removed redundant warm transform scans'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`TextGroup` now consumes Three's completed scene traversal and tracks
transform changes below the shared draw root. Camera or group motion leaves indexed transform storage untouched;
actual text, nested-parent, visibility, reparenting, and manual-matrix changes patch only their paragraph IDs. A
compiled-Wasm integration regression proves shared-root motion performs zero forced per-text world updates and no GPU
attribute version change, while a direct child move still updates its retained slot.
