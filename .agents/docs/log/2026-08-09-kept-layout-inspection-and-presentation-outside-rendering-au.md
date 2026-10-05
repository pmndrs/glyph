---
type: Log Entry
title: 'Kept layout inspection and presentation outside rendering authority'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added an explicit Rust semantic-glyph
inspection mask alongside measurement; ordinary rendering still publishes no layout arrays. First-party policy
programs now carry one stable glyph ID per renderable instance so Three can direct optional Bitmap/MTSDF/Slug origin
presentation without reconstructing glyph topology. The executor restores authoritative origins before every later
command-buffer update and retains only resource tables plus reversible overrides, eliminating any need to revive the
candidate/current target state machine. Compiled-Wasm fixtures cover semantic spaces, shared two-paragraph batching,
isolated overrides, transform-only retention, and semantic-update retirement. The refreshed canonical checkpoint is
1,089,889 raw / 414,204 gzip / 325,805 Brotli shaper bytes; legacy-path deletion and a Rust size pass remain open.
