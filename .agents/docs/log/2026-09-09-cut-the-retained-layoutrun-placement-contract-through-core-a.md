---
type: Log Entry
title: 'Cut the retained LayoutRun placement contract through core and renderers'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The generated ABI now carries a distinct
per-physical-glyph placement slot and one program-independent session table whose row is exactly f32x2 x/y. Planner-
scoped run and placement slots are staged, generation-checked, and acknowledgement-quarantined; fixed numeric blocks,
sparse word-root segments, dense-CJK segments, visual order, bidi, hanging spaces, and replacement runs remain core
authorities. Three and direct TypeGPU resolve placement without adding a run/slice batch key, primitive, span, or draw,
and stable glyph identity remains a separate truthful lane. This is a pre-alpha coordinate reset, not a compatibility
mode; justification and visual metadata never enter renderer rows.
