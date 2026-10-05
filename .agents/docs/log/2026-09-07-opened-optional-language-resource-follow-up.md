---
type: Log Entry
title: 'Opened optional language-resource follow-up'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

[#163](https://github.com/pmndrs/glyph/issues/163) specifies
explicit language selection, dynamically imported dictionary/hyphenation data, a versioned bounds-checked Wasm
linear-memory ABI, deterministic baseline fallback, and package-size/hot-path gates. Baseline word wrapping remains
Unicode UAX #14 constrained by grapheme and shaping safety; it does not pretend to provide locale tailoring.
