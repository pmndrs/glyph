---
type: Log Entry
title: 'Made justification consume completed shaped words'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Editorial non-final lines now reach the exact column edge
under the same word-space shrink contract used during fitting, while final lines remain ragged. The regression covers
a shaped word whose early positive advance is canceled by a later negative adjustment instead of moving that fitting
word to the next line.
