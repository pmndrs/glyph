---
type: Log Entry
title: 'Continuous word and script handoffs'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Made Zoom Text clear an aborted preparation marker and retry the same recycled slot instead of holding one word for a complete extra cycle. Font-changing Advanced Shaping transitions deliberately blank the live line until the next authenticated generation commits, avoiding mismatched old-script frames while same-font grapheme updates remain continuous.
