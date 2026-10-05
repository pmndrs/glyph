---
type: Log Entry
title: 'Bound Three plan consumption directly to Wasm publication memory'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A reusable package-internal reader validates
every Rust-emitted render-plan table and reads its fixed records in place. It retains one `DataView` across ordinary
A/B publications and replaces it only after `memory.grow()`, so it does not materialize per-glyph JavaScript objects.
A real compiled-Wasm Three fixture now shapes and lays out Inter in one update and observes nonempty resource, buffer,
patch, primitive, and draw tables through that reader. GPU resource realization remains the next cutover slice.
