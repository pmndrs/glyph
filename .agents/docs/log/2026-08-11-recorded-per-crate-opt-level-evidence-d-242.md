---
type: Log Entry
title: 'Recorded per-crate `opt-level` evidence (D-242)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A measured matrix over the shaper (whole-`z`, dependency-`z`,
HarfRust-family-`s`, whole-`s`) and all four bakers (`z`, `s`, `3`) proved every crate already sits at its per-crate
optimum: size-level builds shrink the shaper by 84–270 KB but regress shaping-bound benchmark lanes 22–98%, while
the parser-generic bakers inflate 26–123 KB under size levels and the font baker inflates 96–192 KB away from its
current `z`. The decision register and package concept now pin these settings and direct further size reduction to
code-shape changes.
