---
type: Log Entry
title: 'Package-owned font preparation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added generated `prepare` and `inspect` Wasm exports backed by Skera and Skrifa. The optional baker alone enables `std`; the same Rust source still passes its `wasm32 --no-default-features` compatibility build, and an ASCII subset is inspected and rebaked through the packaged direct-memory bridge. Measured `opt-level = "z"` plus Binaryen `-Oz` wins for this graph at 1,097,710 raw / 391,557 gzip bytes.
