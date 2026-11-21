---
type: Log Entry
title: 'Paint-only preparation keeps decoration paint current'
generated:
  by: process:docs-new
  at: '2026-11-21T18:05:36Z'
---

The deferred preparation model stops a paint-only style change after the style stage and republishes retained rows
against the new styles. Glyph rows read material and colour at publication, but positioning bakes each decoration
record's material and colour and decides once per paragraph whether rows carry outline and shadow. After merging
`experiments/sil-prepare` and `experiments/sil-render`, replacing a decorated Text's material published the old
material id and the Three renderer failed with `text render plan references unknown material binding` (the
`benchmark:v1-bitmap` MTSDF distance-material stage).

Style invalidation in `rust/shaper/src/engine/style_state.rs` now classifies a material or decoration-colour change on
decorated text, and an outline or shadow colour that turns text effects on or off, as `effects`, so those changes
re-run positioning. Material on undecorated text and recolouring existing effects remain paint-only. The unit test
`invalidation_stops_at_the_first_affected_retained_stage` covers each case; the layout oracle full tier is unchanged
(423 cases equal, 0 divergences).

The benchmark Vite config now scans only the top-level benchmark pages for dependency optimization. The default
`**/*.html` scan had crawled an untracked `benches/profiles/` tree whose copied `node_modules/@pmndrs/glyph` was
pre-bundled as a second Glyph and Three instance, which survived the directory's removal in the dependency cache.
