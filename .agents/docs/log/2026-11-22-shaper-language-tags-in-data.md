---
type: Log Entry
title: 'Shaper resolves OpenType language tags from data'
generated:
  by: process:docs-new
  at: '2026-11-22T14:03:24Z'
---

The vendored HarfRust fork gained a default-on `language-tags` feature that owns BCP 47 to OpenType language-system
resolution, and `ShapePlan::new_with_language_tags`, which takes the tags from the caller
(`vendor/harfrust/GLYPH-FORK.md`). The shaper builds HarfRust without the feature and resolves in
`packages/glyph/rust/shaper/src/language_tags.rs` from tables that `scripts/generate-language-tag-data.mjs` generates
out of the vendored `tag_table.rs`; a differential test proves the result equal to HarfRust's own resolution. The shipped
`text-shaper.wasm` shrinks by 17,639 raw / 4,841 gzip / 3,140 Brotli bytes. Measurements, the reason `-x-hbot` alone was
not behaviour-identical, and the speed check are in the 2026-11-22 pass of
[wasm-size-reduction](../planning/wasm-size-reduction.md).
