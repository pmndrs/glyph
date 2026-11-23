---
type: Log Entry
title: 'Collapse duplicated monomorphizations in the core shaper'
generated:
  by: process:docs-new
  at: '2026-11-23T16:27:31Z'
---

Branch `experiments/sil-monos` from `sil-green-53` collapses duplicated generic instantiations in `text-shaper.wasm`
from `621,697` to `601,122` gzip bytes (`1,578,052` to `1,506,043` raw), with no behaviour change. The
[size note](../planning/wasm-size-reduction.md) has the per-cut table, the A/B and what was not taken; its generics
guideline gained the comparator kernel, vendored-sort and gzip rules.

- `retained_rope` keeps one type-erased tree core: leaves store record bytes at the type's stride in `u64` words beside a
  per-type summary function, and the ordered update's callback crosses as `&mut dyn FnMut` (`−8,816` gzip). Read paths
  stay typed. The [glyph package concept](../packages/glyph.md) describes the ordered update's leaf copy accordingly.
- Placement index edits sort through the new `sort::sort_pairs_by` comparator kernel and the splice's dirty cluster
  ranges through `sort_keys` (`−2,949`); `sort_pairs` shares that instantiation (`−1,331`).
- The HarfRust fork lowers its three plan-compile sorts to `u64` keys (`−5,751`, `−1,728`), documented in
  `vendor/harfrust/GLYPH-FORK.md`.

Checks: clippy `--features oracle --all-targets -D warnings`, `cargo test --features oracle`, native and wasm layout
oracles at the full tier with no unlisted divergence and no re-freeze, the fork parity tests, and an odd-stride rope test.
