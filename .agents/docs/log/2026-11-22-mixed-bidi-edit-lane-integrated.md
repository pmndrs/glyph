---
type: Log Entry
title: 'Mixed-bidi edit lane integrated with sil-green-50'
generated:
  by: process:docs-new
  at: '2026-11-22T22:12:20Z'
---

`experiments/sil-exp-unicode` (run-splitting reshape and splice, and the edit-run choice by the side that holds an
edit's units) now merges `sil-green-50` cleanly.

The first merge produced 34 native differential runs where incremental failed with `InvalidRequest` and cold succeeded
(for example `layout-oracle fuzz --case doc-mount-labels-64-publish --seed 2 --steps 25`), and the devanagari
scalar-boundary script-topology test failed shrinking a paragraph to "". Cause: when an edit emptied a paragraph, the
shape stage tried the incremental paths before its empty-text check. The realigned path (several runs replaced by
the one empty run) shaped that run into an empty shaped run, which the cluster build rejects. The empty-text check now
runs first, so emptied text has no shape, as in a cold build. A Rust regression test empties one-run and three-run
paragraphs. After the fix, the native and wasm full-tier oracles report 596 equal references and 0 unlisted
divergences, with no re-freeze.

The mixed-bidi edit headline is now the committed workflow `benchmark:headline-bidi-edit`
(`benches/headline/bidi-edit.ts`). Against main (`4e25a96a5`), 3 interleaved rounds, per-step median ms of a complete
frame: type-end 12.72 → 6.56, insert-middle 8.98 → 6.93, delete-middle 8.98 → 6.85, paste-middle 13.93 → 11.29.
The out-of-git baseline harness agrees within 0.1 ms on every row.
