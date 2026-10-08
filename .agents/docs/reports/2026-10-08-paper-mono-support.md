---
type: Engineering Report
title: Paper Mono validation for the variable outline stream
description: Validates the proposed dynamic outline-stream format and its variable-font design against pinned Paper Mono.
tags: [glyph, fonts, opentype, variable-fonts, outlines, paper-mono]
generated:
  by: openai-codex/gpt-5
  at: '2026-10-08T00:00:00Z'
---

# Paper Mono validation for the variable outline stream

## Decision

**Paper Mono is compatible with the proposed dynamic TrueType outline stream.** One encoded base plus sparse `gvar`
deltas reproduced all 800 glyphs at 19 locations with zero point, topology, decomposed-outline, exact-ink-bound, GPU
slot, or f32-policy mismatches against independently instantiated HarfBuzz 14.2.0 fonts. The locations include
`wght` 100, 400, 650 and 800 and the five interior `avar` knots at the knot and ±0.01 user units. This is genuinely one
reused base-and-delta stream, not 19 statically instantiated fonts serialized back into the candidate format.

The recommendation is therefore to update [#99](https://github.com/pmndrs/glyph/issues/99) to cover coherent live
variation coordinates and use Paper Mono as its first TrueType acceptance font. Do **not** narrow #99 to fixed baked
weights. The revised maintainer decision on [#244](https://github.com/pmndrs/glyph/issues/244#issuecomment-6011804243)
explicitly puts variable fonts in the outline-format scope and supersedes the issue body's older exclusion. The
[variable-font study](https://github.com/pmndrs/glyph/issues/244#issuecomment-6013252859) and
[corrected band study](https://github.com/pmndrs/glyph/issues/244#issuecomment-6021011366) are later controlling
evidence, not optional follow-up.

This is a design-feasibility and CPU correctness result, not implemented product support. The format, instancer, and
band work remain on unmerged `spike/outline-stream-gpu`; current `main` still rejects variable input. The experiment
does not execute a GPU, CFF2, `VARC`, transformed/nested components, or point-matched composites.

## Authoritative design being tested

At spike commit
[`dcd04cc`](https://github.com/pmndrs/glyph/commit/dcd04cc70e470a27110bff2602905ceb5e465092), the proposed
wire format preserves TrueType's point model and original point order, storing `hdr`, contour, component, triplet flag,
and triplet data planes
([format lines 18–51](https://github.com/pmndrs/glyph/blob/dcd04cc70e470a27110bff2602905ceb5e465092/.agents/docs/planning/decisions/outline-stream-format.md#L18-L51)).
That order is essential because `gvar` addresses stored point numbers; explicit on-curve midpoint points must not be
collapsed merely because the rendered curve would be unchanged
([format lines 105–110](https://github.com/pmndrs/glyph/blob/dcd04cc70e470a27110bff2602905ceb5e465092/.agents/docs/planning/decisions/outline-stream-format.md#L105-L110)).

The later variable-font decision specifies the operative pipeline: decode in `glyf` order, perform IUP per tuple over
the original contour boundaries, instance points, expand composites, and only then rotate/add wrap slots for the GPU.
It also keeps `fvar`, `avar`, `HVAR`/`VVAR`, `MVAR`, GDEF item variations, and GSUB feature variations in the shaping
payload rather than the outline stream
([decision lines 18–32](https://github.com/pmndrs/glyph/blob/dcd04cc70e470a27110bff2602905ceb5e465092/.agents/docs/planning/decisions/variable-font-outline-stream.md#L18-L32)).
The recommended TrueType wire is base triplets plus region-major sparse `gvar` deltas, the `0x80` zero-pair flag,
previous-delta prediction, region records, and axis/`avar` records
([decision lines 42–49](https://github.com/pmndrs/glyph/blob/dcd04cc70e470a27110bff2602905ceb5e465092/.agents/docs/planning/decisions/variable-font-outline-stream.md#L42-L49)).

The reference spike code is real experimental proof, but not a complete implementation. In particular its composite
expander says it handles one level because its fixtures have no nesting, and applies translation only
([instancer lines 718–748](https://github.com/pmndrs/glyph/blob/dcd04cc70e470a27110bff2602905ceb5e465092/spikes/outline-stream/research/varfont/instancer/src/lib.rs#L718-L748)).
The new Paper validator adapts the specified stream rather than treating prose or benchmark claims as proof.

## Reproducible Paper experiment

Run:

```sh
mise exec -- pnpm scripts run glyph:paper-mono-outline-stream-check
```

The named workflow downloads only
[`PaperMono[wght].ttf` at `e6eaecea`](https://github.com/paper-design/paper-mono/blob/e6eaeceaef02e77e3db997711e07a16378de2bd7/fonts/variable/PaperMono%5Bwght%5D.ttf),
requires SHA-256 `43369c40e211aab9dda29464b0d715c9f20d90118626a56659607108c9c03dfe`, and removes the temporary
font and oracle instances. The font is available under the project's
[SIL Open Font License 1.1](https://github.com/paper-design/paper-mono/blob/e6eaeceaef02e77e3db997711e07a16378de2bd7/OFL.txt);
no font binary is committed or redistributed. The checked-in implementation and complete deterministic result are
`spikes/outline-stream/research/paper-mono/validate.py` and
`spikes/outline-stream/research/paper-mono/results.json`.

The validator does the following:

1. Copies every simple-glyph point and tag in original stored order and every composite component record; encodes and
   decodes the proposed five base planes.
2. Extracts axes, exact F2DOT14 `avar` knots, variation regions, sparse `gvar` point sets and deltas; encodes region-major
   point-presence, triplet flag, and data planes; then decodes them.
3. Applies OpenType tuple scalars and independent IUP to untouched points, both with f64 and the accepted f32 policy.
   IUP follows the axis-wise interpolation rules in the primary [`gvar` specification](https://learn.microsoft.com/en-us/typography/opentype/otspec190/gvar),
   while user coordinates are normalized and remapped as specified by [`avar`](https://learn.microsoft.com/en-us/typography/opentype/spec/avar).
4. Expands the decoded components and derives topology, control bounds, exact quadratic ink bounds, GPU point slots,
   and Slug curves/bands. Oracle ink bounds come independently from fontTools `BoundsPen` over each instantiated font.
5. Compares each dynamic result with two independently instantiated oracles: HarfBuzz `hb-subset --variations` and
   `fontTools.varLib.instancer`. Oracle fonts are never inputs to the candidate encoder.
6. Shapes the Paper `ss02` repertoire off and on with HarfBuzz at every location and checks glyph names and advances
   against that location's HVAR-instantiated metrics.

### Quantitative result

| Check                                                   |                                                                   Result |
| ------------------------------------------------------- | -----------------------------------------------------------------------: |
| Base-stream round-trip                                  |                                        0 mismatched glyphs; 30,491 bytes |
| Variation-stream round-trip                             |        0 mismatched glyphs; 38,727 delta bytes plus 75 axis/region bytes |
| Tested locations                                        |                                                                       19 |
| Dynamic stream vs HarfBuzz, own/decomposed coordinates  |                                        0 / 0 mismatches; maximum error 0 |
| Dynamic stream vs HarfBuzz, topology/control/ink bounds |                                              0 / 0 / 0 mismatched glyphs |
| f32-policy stream vs HarfBuzz                           |                0 coordinate, topology, control-, or ink-bound mismatches |
| fontTools outlines vs HarfBuzz outlines                 |                0 coordinate, topology, control-, or ink-bound mismatches |
| Tagged-i16 GPU slots                                    |                             429,400 compared; 0 value/tag/range failures |
| Preserved explicit midpoint points                      |                                                                      310 |
| `ss02` shaping                                          | 608 glyph results checked; 304 substitutions; 0 glyph/advance mismatches |
| Exact per-instance Slug bands                           |       486,400 lists; 2,070,327 references; 0 missing; 0 order inversions |
| Reusing default bands elsewhere, negative control       |                       122,418 missing references; 7,211 order inversions |

Paper contains 800 glyphs: 509 simple, 286 composite, and 5 empty; 11,229 simple points and 1,257 contours. Its four
variation regions form 1,222 glyph tuples with 17,550 explicit and 2,539 untouched point deltas. Of 629 glyphs with
nonzero deltas, 155 are composites. None of Paper's `gvar` tuples changes the four phantom points, so dropping phantom
outline deltas while retaining HVAR is valid for this font only; fonts without HVAR remain a separate gate.

Across all locations, the tagged GPU coordinate range is x `[-1738, 768]`, y `[-265, 975]`, safely inside the proposed
`(x << 1) | offCurve` i16 restriction (`|x| < 16384`)
([format lines 57–70](https://github.com/pmndrs/glyph/blob/dcd04cc70e470a27110bff2602905ceb5e465092/.agents/docs/planning/decisions/outline-stream-format.md#L57-L70)).
Paper has no first-off-curve or all-off-curve contours, so it does not exercise the legal synthesized-start path.

### Metrics evidence and its limit

Paper's HVAR data leaves advance widths unchanged across weight while changing the left side bearing of as many as 588
glyphs at a tested location. HarfBuzz- and fontTools-instantiated metrics agree on 30,355 of 30,400 compared values.
Their 45 disagreements are all one font unit: none at min/default/max, three at `wght=650`, and the rest around the
tested `avar` knots. This report therefore does not claim bit-identical cross-library HVAR rounding. It does establish
that HarfBuzz shaping advances agree with its own instantiated HVAR metrics for all 608 `ss02` checks and that the
corresponding outline and bounds match both outline oracles. Product tests need to choose one normative rounding policy
and compare the shaping, extents, and raster paths to that same policy.

## What duospacing is

Paper's specimen presents `ss02` as “Duospace glyphs” ([Paper Mono specimen](https://paper.design/mono)). In the source,
it is an ordinary one-to-one GSUB stylistic-set substitution for 16 wide letters and accented forms—`AE`, `M`, `OE`,
`W`, lowercase equivalents, and variants—to `.ss02` glyphs
([Paper feature source](https://github.com/paper-design/paper-mono/blob/e6eaeceaef02e77e3db997711e07a16378de2bd7/sources/PaperMono.glyphspackage/fontinfo.plist#L1770-L1796)).
It is not a variation axis and requires no duospace-specific layout rule.

All 16 alternate glyphs survive the candidate stream. At all 19 locations the normal glyphs shape with advance 606 and
the `ss02` alternates with advance 758. “Duospace” means selected naturally wide glyphs use Paper's second, wider cell;
it does not mean outline width equals advance width. OpenType stores advance and left side bearing separately in `hmtx`
([`hmtx` specification](https://learn.microsoft.com/en-us/typography/opentype/spec/hmtx)); the outline may be narrower,
wider, or offset within its pen advance. GSUB chooses the alternate glyph ID, HVAR supplies instance metrics, and the
outline stream supplies that ID's instance geometry. Coherence requires all three to use the same normalized location.

## Paper-specific findings versus general format gates

| Capability or risk                            | Paper result                                                                     | Support conclusion                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Original point numbers/topology               | 11,229 points, including 310 explicit midpoints, round-trip exactly              | Supported by the format and proven for Paper                                                              |
| Sparse `gvar`, IUP, `avar`                    | 19 locations, 0 outline mismatches                                               | Supported and proven for Paper                                                                            |
| Arbitrary off-named coordinate                | `wght=650`, normalized through `avar`, 0 outline/bound mismatch                  | Supported; not merely named/static instances                                                              |
| f32 accepted policy                           | 0 Paper mismatches                                                               | Supported for Paper; the broader study's one-unit Inter/Roboto differences still define the policy        |
| Simple composite offsets and composite `gvar` | 544 components; 155 variable composite glyphs; 0 mismatches                      | Supported and proven for Paper                                                                            |
| `ROUND_XY_TO_GRID`                            | Present on all 544 Paper components; not stored by the proposed component record | Geometry happens to match because Paper's tested offsets are integral; format fidelity remains incomplete |
| Transformed, nested, point-matched components | Paper has 0 of each                                                              | Unknown; still a composite gate, not evidence of support                                                  |
| HVAR advances/side bearings                   | Coherent against HarfBuzz; 45/30,400 one-unit HarfBuzz/fontTools disagreements   | Feasible, with normative rounding still to decide                                                         |
| `ss02` duospace                               | 16 alternates retained; 608 shape checks, 0 mismatches                           | Supported by normal GSUB + metrics + outline coherence                                                    |
| Slug bands                                    | Exact rebuild has 0 misses/inversions; default reuse fails                       | CPU proof supports the corrected exact-rebuild design; no GPU claim                                       |
| CFF2 compatible cu2qu                         | Paper has no CFF2                                                                | Not tested by Paper; retain the separate CFF2 gate                                                        |
| `VARC`/`avar2`                                | Paper has neither                                                                | Not tested; retain separate gates                                                                         |
| Tagged-i16 point representation               | 429,400 slots, 0 failures                                                        | Supported for Paper; retain a range check/fallback for other fonts                                        |

The OpenType [`glyf` specification](https://learn.microsoft.com/en-us/typography/opentype/spec/glyf) defines transformed,
point-matched, nested, `ROUND_XY_TO_GRID`, and offset-scaling behavior; passing Paper cannot discharge cases it does not
contain. Likewise, the common variation formats place item variation stores and region scalars outside `gvar`
([common variation formats](https://learn.microsoft.com/en-us/typography/opentype/spec/otvarcommonformats)).

## Slug bands: corrected rule

The current shader exits when the current curve's **instanced** maximum is behind the sample; it does not compare a
stored conservative sort key. The corrected study therefore permits only an exact rebuild, a per-change re-sort, a
stored-key shader change, or removal of the early exit
([corrected study lines 18–40](https://github.com/pmndrs/glyph/blob/dcd04cc70e470a27110bff2602905ceb5e465092/.agents/docs/planning/outline-stream-variable-font-bands-study.md#L18-L40)).

Paper independently confirms the logic. Rebuilding every used glyph's horizontal and vertical bands from its instanced
curves produced zero missing references and zero adjacent order inversions. Reusing default-instance partitions/order
at other locations produced 122,418 missing references and 7,211 inversions. This is a structural CPU check against the
current early-exit precondition, not pixel output and not a GPU execution.

## Product boundary and minimum changes

Current `main` support is context, not the answer: raw variable fonts are rejected. `readGlyphs` is the borrowed,
callback-scoped path, while `glyphs().outlineAt()` is the caller-owned inspection path
([layout contract](../../../packages/glyph/src/layout.ts#L120-L171)); Three's `split()` captures only committed drawable
glyphs and excludes blanks ([implementation](../../../packages/glyph/src/three/text.ts#L863-L921)). All three consume
the same outline identity. `GlyphOutlineView` expressly promises that equal `(fontHandle, glyphId)` keys have identical
outlines ([outline contract](../../../packages/glyph/src/glyph-outline.ts#L1-L24)). The unmerged
[`johncomposed/glyph#1`](https://github.com/johncomposed/glyph/pull/1) draft passes one pinned location through shaping,
metrics, raster, and extents while deliberately excluding runtime axis changes. It is useful shaping-instance work, but
it neither implements nor disproves the live base-plus-delta stream validated here. PRs
[#221](https://github.com/pmndrs/glyph/pull/221), [#227](https://github.com/pmndrs/glyph/pull/227),
[#229](https://github.com/pmndrs/glyph/pull/229), [#230](https://github.com/pmndrs/glyph/pull/230),
[#231](https://github.com/pmndrs/glyph/pull/231), [#232](https://github.com/pmndrs/glyph/pull/232), and
[#234](https://github.com/pmndrs/glyph/pull/234) do not implement this format. No performance timing was run, so this
work does not overlap [#247](https://github.com/pmndrs/glyph/issues/247).

The minimum coherent implementation scope is:

1. **Wire fidelity:** land the base triplet and sparse region-major delta planes; preserve original point order and
   contour boundaries; store the component flags needed for `ROUND_XY_TO_GRID`, point matching, offset scaling,
   transforms, and nesting instead of silently normalizing them away.
2. **One canonical location:** validate user coordinates against `fvar`, normalize and apply `avar`, then pass the same
   canonical location to shaping, HVAR/VVAR/MVAR metrics, outline instancing, extents, every raster backend, and exact
   Slug-band rebuilds. Default coordinates and arbitrary coordinates are the same pipeline with different inputs.
3. **Shaping payload:** retain the variation tables listed by the revised decision. Resolve GSUB FeatureVariations and
   GDEF/GPOS item variations at the same location. Fonts without HVAR need phantom-point metrics or a precise rejection.
4. **Identity and invalidation:** a mutable location cannot keep the current cache promise that equal
   `(fontHandle, glyphId)` means equal outlines. Either allocate an immutable instance handle for each canonical
   coordinate or add an explicit variation-instance/generation identity to outline, raster, bounds, shaping-plan, and
   band caches. Axis changes must invalidate every coordinate-dependent product together.
5. **Acceptance gates:** make the pinned Paper workflow a network/downloaded correctness check; add separate fixtures
   for transformed, nested, point-matched and scaled-offset composites, all-off-curve contours, out-of-range tagged-i16
   coordinates, no-HVAR metrics, CFF2, `VARC`, and `avar2`. Do not infer those capabilities from Paper.
6. **GPU proof later:** run the already specified slot-map instancer and Slug path on WebGPU/WebGL2, comparing pixels or
   coverage to the CPU/oracle instance. The present result proves CPU representation and band preconditions only.

## Recommendation for #99

Update the existing issue rather than create a parallel plan. Its acceptance statement should be: a single baked
variable asset can be shaped and outlined at arbitrary canonical coordinates, with synchronized metrics, geometry,
rasters, bounds and cache identity. Paper Mono is the first TrueType acceptance fixture; CFF2 and advanced composite
forms remain explicit follow-on gates. The exact issue-ready text is in
[`2026-10-08-paper-mono-issue-99-proposal.md`](2026-10-08-paper-mono-issue-99-proposal.md).
