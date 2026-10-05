---
type: Log Entry
title: 'Restored executable contract generation and compiled-ABI fuzzing'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Bidi/policy/UIKit and full CJK paragraph
contracts now regenerate through the public Rust-plan `Text` query path and run in `--check` mode from ordinary
benchmark gates. The checked fixtures stay byte-identical: a pre-f32-ABI numeric literal survives only when the current
value is exactly f32-equivalent, and the known UIKit rounding seam is recomputed independently. A new fixed-seed Wasm
smoke corpus mutates 64 policy and frame requests twice, requires identical bounded statuses with both valid and invalid
paths, and proves a fresh valid transaction succeeds after every mutation. This replaces the deleted legacy-export
fuzzing at the actual `text_update` and policy-registration boundaries; the package now passes 165 integration and
three fuzz-smoke tests in addition to 158 Rust tests.
