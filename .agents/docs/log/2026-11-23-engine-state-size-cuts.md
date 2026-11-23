---
type: Log Entry
title: 'Core shaper engine::state size cuts'
generated:
  by: process:docs-new
  at: '2026-11-23T17:18:30Z'
---

Branch `experiments/sil-state-size` from `sil-green-54` cuts the core shaper from `621,409` to `580,949` gzip bytes
(`1,578,343` to `1,469,151` raw) with no behaviour change, by building large default states once and keeping helpers
that were inlined at many sites out of line. The [size note](../planning/wasm-size-reduction.md) has the per-cut table,
where `prepare_upsert`, `prepare_internal` and `build_lines` got their size, and the A/B.

- `ParagraphState::empty` and `RetainedParagraph::created` replace three inlined ~10 kB defaults and a field-by-field
  box move (`−26,169` gzip).
- `with_state`'s one-time initialization, arena `clear`s, the paragraph search, `PlacementLogicalKey::cmp`, the
  allocator and five per-publication helpers are out of line; failure publication is `#[cold]`.
- After merging the monomorphization pass, the rope's ordered update runs each leaf's records through a monomorphised
  `#[inline(always)]` loop (`+1,389` gzip), restoring bidi15k `paste-middle`; the
  [glyph package concept](../packages/glyph.md) says which rope paths stay typed.

Checks: clippy `--features oracle --all-targets -D warnings`, `cargo test --features oracle`, native and wasm layout
oracles at the full tier with no unlisted divergence and no re-freeze, package tests, `pnpm check`, and the
`v1-bitmap`, TypeGPU and PixiJS 3D parity benchmarks.
