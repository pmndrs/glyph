---
type: Engineering Report
title: 'Issue-ready update for #99: dynamic variable-font acceptance'
description: Provides exact issue-ready support scope and Paper Mono acceptance evidence for Glyph variable fonts.
tags: [glyph, fonts, variable-fonts, issues, paper-mono]
generated:
  by: openai-codex/gpt-5
  at: '2026-10-08T00:00:00Z'
---

# Issue-ready update for #99: dynamic variable-font acceptance

The later #244 decision changes the scope relevant to this issue: variable fonts are **in scope** for the new outline
format, superseding the older “variation deltas out of scope” text in the issue body. See
[#244 decision 8](https://github.com/pmndrs/glyph/issues/244#issuecomment-6011804243), the
[variable-font study](https://github.com/pmndrs/glyph/issues/244#issuecomment-6013252859), and the
[corrected Slug-band study](https://github.com/pmndrs/glyph/issues/244#issuecomment-6021011366).

I propose that #99 own the coherent shaping/instance half of that design, with this acceptance scope:

- Accept arbitrary variable coordinates, not only one statically pinned bake. Validate against `fvar`, normalize and
  apply `avar`, and use one canonical location for shaping, HVAR/VVAR/MVAR metrics, GDEF/GPOS item variations, GSUB
  FeatureVariations, outlines, bounds, raster products, and Slug bands.
- Pair that shaping state with #244's TrueType outline representation: one original-order base triplet stream plus
  sparse, region-major `gvar` deltas, IUP over original contour boundaries, instancing before composite expansion, and
  an instance-invariant source-point-to-GPU-slot map. Do not implement runtime axes by serializing a new static font at
  every coordinate.
- Make variation identity explicit. A coordinate change must either produce a distinct immutable instance handle or
  advance an instance/generation key used by outline, shaping-plan, raster, bounds, and band caches; it cannot leave the
  existing `(fontHandle, glyphId)` outline identity apparently unchanged.
- Use Paper Mono's OFL variable TTF pinned at
  [`e6eaecea`](https://github.com/paper-design/paper-mono/blob/e6eaeceaef02e77e3db997711e07a16378de2bd7/fonts/variable/PaperMono%5Bwght%5D.ttf)
  (SHA-256 `43369c40e211aab9dda29464b0d715c9f20d90118626a56659607108c9c03dfe`) as the first downloaded acceptance
  fixture; do not commit the font binary.

The focused Paper probe encodes the variable font once, decodes the proposed base and sparse-delta stream, and compares
dynamic instances at `wght` 100/400/650/800 plus every interior `avar` knot at the knot and ±0.01 (19 locations total).
Against HarfBuzz 14.2.0 and fontTools 4.59.2 it found:

- 0 base- or delta-stream round-trip mismatches;
- 0 own-point, decomposed-point, topology, ink/control-bound, f32-policy, or tagged-i16 slot mismatches across all 800
  glyphs and all 19 locations;
- all 310 explicit on-curve midpoint points preserved in original point numbering;
- 155 variable composite glyphs exercised, including instanced component offsets;
- all 16 `ss02` duospace alternates retained, with 608 shape/advance checks and 0 mismatches (606-unit normal advances,
  758-unit `ss02` advances);
- exact per-instance Slug rebuilding with 0 missing references and 0 sort inversions; reusing default-instance bands at
  other coordinates fails with 122,418 missing references and 7,211 inversions, consistent with the corrected #244
  early-exit analysis;
- HarfBuzz and fontTools disagree on 45 of 30,400 HVAR metric values, always by one font unit (none at min/default/max;
  three at 650), so the implementation must select and test one normative rounding policy rather than claim
  cross-library bit identity.

The reproducible workflow is:

```sh
mise exec -- pnpm scripts run glyph:paper-mono-outline-stream-check
```

Paper is sufficient to accept the core TrueType design, but not the whole format. It has no transformed, nested, or
point-matched components, CFF2, `VARC`, or `avar2`. All 544 of its component records set `ROUND_XY_TO_GRID`, while the
current proposed component record does not store that flag; Paper still matches because its tested offsets are
integral, but the flag must be represented or explicitly normalized under a proved rule before the composite gate is
closed. Fonts without HVAR also need phantom-point metric support or a precise rejection.

Acceptance criteria for Paper should be the checked counts above plus synchronized glyph IDs, advances/positions,
outlines, bounds, rasters, Slug bands, and cache identity at every tested location. GPU execution and the advanced
composite/CFF2/VARC cases should remain explicit gates, not be inferred from this CPU proof.
