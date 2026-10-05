---
type: Log Entry
title: 'Completed ordered-direct display-list compilation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Dirty retained updates now publish complete compact binding
and command tables while keeping physical payloads revision-directed. Consecutive compatible glyphs compile into one
primitive span and draw packet; interleaved `A, A, B, A` resources preserve three ordered spans over two deduplicated
resources and buffers. Material IDs split ordered draws without splitting shared physical glyph storage. Draw records
also carry numeric clip and depth identities, and the generated TypeScript ABI derives their 60-byte compiler layout
from Rust. No-op output remains empty and one changed glyph remains one four-byte payload in the focused policy fixture.
Policies independently select storage and draw keys, proving material-split draws both over shared storage and over
material-partitioned buffers. The planner remains LTO-stripped until session wiring; reachable ABI/policy growth from
the preceding checkpoint measures 266 raw / 70 gzip / 139 Brotli bytes. Stable-indirect compilation and end-to-end
timing remain open.
