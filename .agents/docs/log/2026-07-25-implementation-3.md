---
type: Log Entry
title: 'Implementation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added item 5.3's Unicode 17 bidi foundation: `unicode-bidi` 0.3.18 under `no_std + alloc` with its older bundled data disabled, generated `Bidi_Class` and normalized paired-bracket tables from pinned Unicode 17 inputs, a Rust-generated direct-memory UTF-16 ABI, all 770,241 direction-expanded generic UAX #9 cases plus all 91,707 character-specific cases, and focused Wasm supplementary-plane/direction tests. Paragraph bidi shaping/reordering and the remaining 5.3 policies stay explicitly open.
