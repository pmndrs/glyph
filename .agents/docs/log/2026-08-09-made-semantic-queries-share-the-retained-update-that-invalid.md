---
type: Log Entry
title: 'Made semantic queries share the retained update that invalidated them'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Three now sends only changed text, style,
or geometry sections; an empty update and cached query make no Rust call, while pending measurement or inspection rides
on the same `text_update`. A two-paragraph compiled-Wasm regression proves all-paragraph semantic retention and exact
command-buffer output. Controlled old-Rust Paragraph Stress runs isolate 14.295 ms baseline, 13.615 ms
measurement-only, and 7.450 ms semantic-tier medians; the complete candidate measures 6.885 ms at 11,510 glyphs and
one draw. Optional User Timing markers preserve phase evidence without claiming finer inlined Rust attribution.
