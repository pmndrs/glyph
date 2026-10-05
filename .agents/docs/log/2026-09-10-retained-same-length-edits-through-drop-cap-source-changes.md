---
type: Log Entry
title: 'Retained same-length edits through drop-cap source changes'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

the text-edit convergence path now rederives current
same-source cap geometry, starts again at the first body line when cap content or geometry changes, reapplies both old
and new cap influence through every affected band, and retains the suffix only after cursor and metric convergence. A
focused Rust test changes the cap glyph geometry and proves the incremental line, fragment, cap, and suffix state equals
a cold rebuild; the attached Three test changes a combining-mark cap through the public text surface and remains
cold-equivalent.
