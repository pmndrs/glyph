---
type: Log Entry
title: 'Closed the final fragment-reflow cleanup against current artifacts'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Reclassified the surviving Rust placement
modules against D-355 and their shipping callers: `placement_state` owns paragraph-local segments and f64
translations, `run_local` owns fixed break-independent local geometry, `placement_slot_arena` owns root occurrence
identity and acknowledgement-gated reuse, and `session_placement` owns the single root f32x2 renderer buffer. They are
distinct stages rather than duplicate placement pipelines. The bounded final reductions remove a repeated retained
segment-resolution pass, a duplicate glyph-advance field, fixed per-instance placement-buffer metadata, and the last
wildcard-exported host Codec assembler. Non-documentation changes in the cleanup PR are now net `−4,785` lines against
PR #175, while batches, primitives, draws, stable identity, and the renderer submission contract remain unchanged.
Rebuilt 20-warmup/101-sample 22k width updates measure `1.626 ms` ordinary Latin, `2.248 ms` justified Latin,
`3.565 ms` mixed bidi, and `2.462 ms` dense CJK, versus same-host main medians `3.725/3.281/3.953/2.995 ms`, with
unchanged `30.6/30.6/35.1/96.3 KiB` writes. A ten-window hardware WebGPU dynamic-layout rerun preserves one draw and
387 glyphs; its median window is `0.573 ms` CPU / `0.858 ms` GPU versus main's `0.655/0.853 ms`, so the CPU path is
faster and the `0.005 ms` GPU delta is noise-level parity rather than a regression claim. Direct TypeGPU's live
Bitmap/MTSDF/Slug callback, placement, update, and disposal gate passes on project Chromium.
