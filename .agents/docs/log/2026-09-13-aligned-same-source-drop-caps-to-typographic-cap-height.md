---
type: Log Entry
title: 'Aligned same-source drop caps to typographic cap-height'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Corrected `text-top` placement to align the cap-height
of the face that actually shaped the initial with the surrounding first-available font's cap-height, rather than
aligning cap ink to the line box's leading edge. The shaper reads `sCapHeight` from its retained `OS/2` table and uses
the CSS Inline fallback of `.66em` when that metric is absent. The Editorial specimen now uses a two-line cap sized
to meet its second baseline and a slightly wider column gutter; its projected cube remains centered across both
columns and retains the same three-draw renderer topology.
