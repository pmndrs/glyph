---
type: Log Entry
title: 'Made packed decoration shifts explicitly unsigned'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Decoration color decoding now uses TypeGPU's unsigned right-shift operator for its `u32` packed color operand, removing deprecated signed-shift syntax while preserving the emitted WGSL bit extraction.
