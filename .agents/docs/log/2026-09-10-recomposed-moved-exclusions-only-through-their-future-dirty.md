---
type: Log Entry
title: 'Recomposed moved exclusions only through their future dirty horizon'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Retained exact-width, non-ellipsis flow now
compares committed and pending exclusion geometry, unions every changed exclusion's old/new block bounds and margins
inside one region, preserves lines before that band, and resumes the existing band composer from the retained source
cursor. It cannot certify convergence until it crosses the complete dirty horizon; afterward it retains the suffix
only when line, fragment, slot, cursor, metrics, hanging, and boundary state match exactly. Unsupported structural or
cross-region changes fall back to the cold authority. A deterministic moved-exclusion fixture recomposes three lines,
retains its prefix and suffix, and matches the cold line/fragment tables exactly; all 325 Rust unit tests and the
Unicode 17 bidi, grapheme, and line-break suites pass.
