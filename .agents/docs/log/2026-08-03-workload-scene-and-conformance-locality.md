---
type: Log Entry
title: 'Workload scene and conformance locality'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved Text Ladder, Zoom Text, Off-axis / 3D, Dynamic Layout, Paragraph Stress, and Paint & Effects layout and animation behavior beside their public `Text` constructors, leaving the retained renderer as a dispatcher and Icon Grid virtualization as the next controller extraction. Extracted the conformance React hierarchy from the root application while preserving one host-owned renderer for retained comparisons and exclusive finite captures. A deterministic delayed-peer regression proved the realtime MSDF / Slug comparison could refresh one candidate generation early; the private scene now retains the last complete target pair, defers target resize, publishes both retained objects in one task, rolls both back on failure, and drains an in-flight pair before disposal. Seven focused lifecycle cases cover renderer-state restoration, success, failure, abort, partial readiness, rollback, and delayed resize without admitting a renderer-wide grouped-publication API.
