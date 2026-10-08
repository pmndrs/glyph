---
type: Engineering Report
title: Paper Mono support in the Glyph stack
description: Assesses Paper Mono, its duospace feature, and the boundary between Glyph's current static-font support and future variable-font support.
tags: [glyph, fonts, opentype, variable-fonts, outlines, paper-mono]
generated:
  by: openai-codex/gpt-5
  at: '2026-10-08T00:00:00Z'
---

# Paper Mono support in the Glyph stack

## Recommendation

Use Paper Mono's supplied static TTF or OTF files with Glyph today. Bake with outlines when outline reads are needed,
and enable the font's duospace alternates with `features: [{ tag: 'ss02', value: 1 }]`. Duospacing needs no special
layout engine: it is an ordinary OpenType substitution whose replacement glyphs carry wider advances.

For variable-font support, implement **bake-time selection of one immutable instance** before considering live axes.
That fits Glyph's existing “one asset, one fixed instance” contract and can preserve the current
`(fontHandle, glyphId)` outline-cache key. Paper Mono is a useful first acceptance font because it has one `wght` axis,
TrueType `glyf` outlines, `gvar`, `HVAR`, `avar`, and variation data on composite glyphs. It does not exercise CFF2 or
`VARC`; those need separate capability gates and fixtures. Runtime axis changes are a materially larger format, shaping,
raster, cache, and publication project and are currently unscheduled.

## Evidence boundary

This report assesses Glyph `main` at
[`2ab37fdac6b05f5fd30ce3c165168c2c21176d15`](https://github.com/pmndrs/glyph/commit/2ab37fdac6b05f5fd30ce3c165168c2c21176d15)
and Paper Mono at
[`e6eaeceaef02e77e3db997711e07a16378de2bd7`](https://github.com/paper-design/paper-mono/commit/e6eaeceaef02e77e3db997711e07a16378de2bd7),
both inspected on 2026-10-08. Merged behavior, open pull requests, and planning issues are reported separately. An open
issue or pull-request description is not counted as implemented support.

Paper Mono's repository supplies source plus eight static TTFs, eight static OTFs, a variable TTF, and webfont builds.
Its build configuration defines a single `wght` axis with named values 100 through 800 and Regular 400 as the default
([configuration](https://github.com/paper-design/paper-mono/blob/e6eaeceaef02e77e3db997711e07a16378de2bd7/sources/config.yaml#L1-L35)).
The project and font files are declared SIL Open Font License 1.1
([repository license](https://github.com/paper-design/paper-mono/blob/e6eaeceaef02e77e3db997711e07a16378de2bd7/OFL.txt#L1-L26));
this review used a temporary checkout and did not add or redistribute font binaries.

A table-level inspection of `PaperMono[wght].ttf` found 800 glyphs, `glyf`/`loca`, `fvar`, `avar`, `gvar`, and `HVAR`.
Of 800 glyphs, 286 are TrueType composites; 155 composites have `gvar` data. These counts are inspection evidence, not
a claim made by Paper. They make composite variation processing part of any Paper-compatible arbitrary-instance
implementation. The variable file contains neither CFF2 nor `VARC`.

## What Paper means by duospacing

Paper's specimen calls `ss02` “Duospace glyphs,” alongside `ss01` coding ligatures and `ss03` narrow space
([Paper Mono specimen](https://paper.design/mono)). The source makes the mechanism precise: `ss02` is a set of
one-for-one GSUB substitutions from `AE`, `M`, `OE`, `W`, their listed accented forms, and the lowercase equivalents to
`.ss02` alternates
([feature source](https://github.com/paper-design/paper-mono/blob/e6eaeceaef02e77e3db997711e07a16378de2bd7/sources/PaperMono.glyphspackage/fontinfo.plist#L1770-L1796)).
It is not a variation axis and does not require a second layout algorithm.

Paper's own QA report records a common advance of 606 font units, while the `ss02` alternates have advance 758; the
separate `ss03` spaces have advance 454
([Fontspector report](https://github.com/paper-design/paper-mono/blob/e6eaeceaef02e77e3db997711e07a16378de2bd7/out/fontspector/fontspector-report.md#L36-L78)).
A local HarfBuzz probe at weights 100, 400, and 800 confirmed that `M W` shape with 606-unit advances normally and
758-unit advances under `ss02`. Thus “duospace” here means that selected naturally wide letters may use a second,
wider advance while the font retains its principally monospaced rhythm. It should not be generalized into a guarantee
that every glyph occupies exactly one or two integer cells: 758/606 is about 1.25, and Paper also ships other deliberate
width exceptions.

Advance width and outline width are different quantities. OpenType stores horizontal advance and left side bearing in
`hmtx`; the right side bearing is derived from those values and the outline's `xMin`/`xMax`
([OpenType `hmtx`](https://learn.microsoft.com/en-us/typography/opentype/spec/hmtx)). A narrow outline can sit inside a
wide advance, and an outline can be offset from the pen origin. Glyph correctly keeps shaped pen movement in
`glyphAdvances` and ink bounds separately (`packages/glyph/src/layout.ts:91-109`), while `GlyphOutlineView` exposes
geometry in em units relative to the pen (`packages/glyph/src/glyph-outline.ts:1-24`). With `ss02`, GSUB selects another
glyph ID; that glyph's advance, ink bounds, and outline then remain coherent without duospace-specific code.

## Current support on `main`

### Static Paper Mono

Paper's static TTF and OTF builds match the formats the current baker accepts. With `font.outlines`/`--outlines`, Glyph
retains either `glyf` plus `loca` or CFF1, while explicitly rejecting CFF2
([outline baker](https://github.com/pmndrs/glyph/blob/2ab37fdac6b05f5fd30ce3c165168c2c21176d15/packages/glyph/rust/font-baker/src/outline.rs#L19-L56)).
The static Paper files have the same GSUB `ss02` feature, and Glyph already carries caller-supplied OpenType features
through `TextStyle.features` (`packages/glyph/src/text-properties.ts:133`,
`packages/glyph/src/font-feature.ts:1-14`). Therefore static Paper Mono plus duospacing and outlines is supported by the
current contracts.

The Paper-specific end-to-end bake was not completed in this review: the first invocation entered a shared Rust/Wasm
build lock while issue #247 timing work was active, so it was stopped rather than contaminating those measurements.
The conclusion above is based on the inspected font tables, the baker's format gates, and the current feature path; the
verification plan below retains a direct product test as focused follow-up.

### Outline access after #235

[PR #235](https://github.com/pmndrs/glyph/pull/235) is merged into this assessed `main`; it is not merely planned.
Current behavior is:

- `readGlyphs(callback)` gives borrowed, callback-scoped outline views for transient reads. The old `withGlyphs` name
  has been removed by merged [PR #238](https://github.com/pmndrs/glyph/pull/238).
- `glyphs()` gives an owned layout snapshot whose `outlineAt(index)` remains readable after the source text/font is
  disposed (`packages/glyph/src/layout.ts:120-135`).
- `Text.split()` produces an owned, drawable-only branch, excluding spaces and other non-render records; the old
  `breakApart` name has been removed by merged [PR #239](https://github.com/pmndrs/glyph/pull/239). This affects
  enumeration only: blank glyphs still participate in shaping and layout.
- Every outline identifies the immutable shape by `fontHandle` and `glyphId`, and the public contract explicitly permits
  caching on that pair (`packages/glyph/src/glyph-outline.ts:1-13`).

Duospace glyphs work with all three access forms. A substituted `M.ss02` is simply a different glyph ID with its own
outline and advance. A space selected by `ss03` still will not appear in drawable-only `split()` output, because its
advance affects layout but it has no render record.

### Variable Paper Mono

Raw variable input is unsupported, including its default instance. The shaping baker rejects a font containing any of
`fvar`, `avar`, `gvar`, `cvar`, `HVAR`, `VVAR`, or `MVAR` before producing the payload
([current gate](https://github.com/pmndrs/glyph/blob/2ab37fdac6b05f5fd30ce3c165168c2c21176d15/packages/glyph/rust/font-baker/src/sfnt.rs#L42-L49),
[`build_shaping_payload`](https://github.com/pmndrs/glyph/blob/2ab37fdac6b05f5fd30ce3c165168c2c21176d15/packages/glyph/rust/font-baker/src/sfnt.rs#L72-L93)).
`FontBakeDescriptor` has only face index and the outlines flag (`packages/glyph/src/font-baker/index.ts:9-18`), and the
shaping run has script, language, features, direction, cluster level, and flags but no variation coordinates
(`packages/glyph/rust/shaper/src/lib.rs:171-181`). Raster and extents paths also explicitly request
`LocationRef::default()`; that is a default-coordinate dependency, not arbitrary-axis support
(`packages/glyph/rust/font-baker/src/sfnt.rs:285-304`,
`packages/glyph/rust/bitmap-baker/src/rasterize.rs:169`,
`packages/glyph/rust/mtsdf-fontations/src/lib.rs:25,69,80`,
`packages/glyph/rust/slug-fontations/src/lib.rs:45,56`).

OpenType requires a variable font's base tables to describe the default instance, with non-default instances applying
variation deltas ([variation overview](https://learn.microsoft.com/en-us/typography/opentype/spec/otvaroverview)). That
does not make Paper's raw default instance supported by Glyph: the deliberate input rejection occurs first. Use the
supplied static Regular file for today's default appearance.

## Support matrix

| Capability                           | Current shipped/`main`                                                                              | Open work or plan                                                                                                                                 | Assessment for Paper Mono                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Static TTF shaping and layout        | Supported                                                                                           | None required                                                                                                                                     | Supported; includes `ss01`/`ss02`/`ss03` through ordinary feature settings.                            |
| Static TTF outlines                  | Supported with `--outlines`                                                                         | Packed curve stream [#244](https://github.com/pmndrs/glyph/issues/244) is a future representation, not required                                   | Supported; `glyf` and composites decode today.                                                         |
| Static OTF outlines                  | Supported with `--outlines`; CFF cubics become four quadratics                                      | None required for Paper                                                                                                                           | Supported by the CFF1 path.                                                                            |
| Paper duospacing                     | Supported as `ss02` GSUB                                                                            | No engine feature needed                                                                                                                          | Supported now; select it in `TextStyle.features`.                                                      |
| Raw variable TTF, default `wght=400` | Rejected                                                                                            | Variable-font request [#99](https://github.com/pmndrs/glyph/issues/99)                                                                            | Unsupported even though the default is representable by OpenType base tables.                          |
| Bake one chosen `wght` instance      | No coordinate input; rejected                                                                       | “Static variable-font instances” are a later horizon; [#147](https://github.com/pmndrs/glyph/issues/147) records identity/provenance consequences | Feasible and recommended next milestone; not implemented.                                              |
| Live arbitrary `wght` changes        | No public/runtime coordinate model                                                                  | Roadmap says runtime axes are not scheduled                                                                                                       | Unsupported and not implied by the static-instance plan.                                               |
| Cache identity across instances      | One handle per shaping fingerprint; `(fontHandle, glyphId)` is sufficient for current static assets | Coordinates must enter artifact identity                                                                                                          | Safe only if every selected instance receives a distinct immutable fingerprint/handle.                 |
| TrueType variable composites         | No variable instantiation                                                                           | No merged implementation                                                                                                                          | Required for Paper: 155 inspected composite glyphs carry `gvar` data.                                  |
| CFF2 / `VARC`                        | CFF2 outline bake rejected; `VARC` excluded                                                         | No merged implementation                                                                                                                          | Not needed by Paper, unknown until tested with separate fonts; must not be claimed from Paper success. |

The outline decision explicitly defers CFF2, variation axes, and runtime-bake outlines
([decision](../planning/decisions/glyph-outlines.md)). The shaping contract says one asset is one fixed instance and
rejects variable input until outlines, metrics, layout feature variations, and raster data share coordinates
([contract](../planning/shaping-data-contract.md#static-variation-policy)). The project brief places static instances in
a later horizon (`.agents/docs/planning/project-brief.md:90-97`), while the roadmap says runtime variation axes are not
scheduled (`.agents/docs/roadmap/roadmap.md:949`). No open variable-font PR was found on 2026-10-08.

The performance stack [#221](https://github.com/pmndrs/glyph/pull/221),
[#227](https://github.com/pmndrs/glyph/pull/227), [#229](https://github.com/pmndrs/glyph/pull/229),
[#230](https://github.com/pmndrs/glyph/pull/230), [#231](https://github.com/pmndrs/glyph/pull/231),
[#232](https://github.com/pmndrs/glyph/pull/232), and [#234](https://github.com/pmndrs/glyph/pull/234) was still open and
is not in this `main`. Publication-cost [issue #247](https://github.com/pmndrs/glyph/issues/247) is pertinent only to the
design risk: live axis changes could invalidate shaping, outlines, rasters, and publication repeatedly. It is not
evidence of variable-font support. Bake-time immutable instances avoid that runtime invalidation path.

## Coherence requirements for a selected variable instance

“Select weight 650” cannot mean varying outlines alone. After validating and normalizing a coordinate against `fvar`
and `avar`, the same location must govern:

1. GSUB/GPOS/GDEF feature and item variations used by shaping;
2. `HVAR`/`VVAR` glyph advances and side bearings plus global `MVAR` metrics when present;
3. `gvar` TrueType outlines, including component transforms and phantom points for composite glyphs, or CFF2/`VARC`
   when those formats are admitted; and
4. bitmap, MTSDF, Slug, retained outline, ink-extents, and shaping artifacts.

The OpenType common-formats specification describes `gvar` outline deltas, composite component point numbering,
phantom points, HVAR metrics, and CFF2 variation data
([OpenType variation common formats](https://learn.microsoft.com/en-us/typography/opentype/spec/otvarcommonformats)).
HarfBuzz likewise treats variation coordinates as font state set before normal shaping, with unspecified axes using the
default ([HarfBuzz variable fonts](https://harfbuzz.github.io/fonts-and-faces-variable.html)).

The pinned Fontations stack already exposes location-aware metadata, metrics, and outline APIs: Skrifa's
`MetadataProvider` accepts `LocationRef` for metrics
([Skrifa 0.45.1](https://docs.rs/skrifa/0.45.1/skrifa/trait.MetadataProvider.html)), and its outline API accepts a
location in `DrawSettings`
([outline module](https://docs.rs/skrifa/0.45.1/skrifa/outline/index.html)). It is therefore reasonable to infer that the
dependency can provide much of the low-level instancing work. Glyph still needs to pass one canonical location through
every producer and prove the resulting artifact contract; dependency capability is not product support.

Cache identity is the main public-contract constraint. Today the loader deduplicates and assigns `fontHandle` by
`shapingFingerprint` (`packages/glyph/src/loader.ts:285-320,359-362`), and equal `(fontHandle, glyphId)` promises equal
outlines. Two weights can have the same glyph ID but different geometry, advances, bounds, and rasters. Therefore the
normalized coordinates must participate in the prepared/source/shaping fingerprint, bake descriptor and provenance,
raster sidecar identity, and loader deduplication. The least disruptive design is one immutable handle per baked
instance. Mutating coordinates under one handle would make the current outline-cache promise false and would require a
new public identity dimension.

## Minimum changes

For **one fixed instance per asset**, the minimum coherent addition is:

1. Add validated, canonical variation coordinates to CLI and Node bake/prepare descriptors. Resolve omitted axes to
   defaults, clamp or reject out-of-range values by an explicit policy, and normalize through `avar` once.
2. Instantiate or reduce all retained shaping tables at that location, not merely strip `fvar`/`gvar`. Resolve layout
   feature variations and metrics so the emitted shaping payload is a self-contained static instance.
3. Generate extents, retained outlines, bitmap, MTSDF, and Slug data from the same location. Include composite
   variation processing in the Paper milestone.
4. Put canonical coordinates into fingerprints, provenance, artifact/sidecar compatibility checks, and cache keys.
   Preserve the existing `GlyphOutlineView` by allocating a distinct immutable `fontHandle` per instance.
5. Keep format diagnostics honest: initially admit Paper's TrueType `glyf`/`gvar` path and continue returning a specific
   unsupported-format error for CFF2/`VARC` until their own fixtures pass.

For **live axes**, additional public work would be necessary: style-level variation settings, shaping-run coordinates,
plan/cache keys, font-instance lifecycle, outline and raster regeneration/selection, renderer invalidation, and a policy
for stable glyph identity while coordinates change. That is beyond the minimum Paper support and should remain a
separate format revision.

## Feasible verification plan

Use the OFL Paper repository as an external/downloaded fixture or obtain explicit approval for any committed fixture;
do not add its binaries casually, and use LFS for a newly approved large asset.

1. **Current static acceptance:** bake Paper Regular TTF and OTF with outlines; shape without and with `ss02`; verify
   `readGlyphs`, `glyphs().outlineAt`, and drawable-only `split()` against the same glyph IDs and advances.
2. **Independent variable oracle:** for weights 100, 400, 650, and 800, compare Glyph output to HarfBuzz shaping and
   Fontations/Skrifa outlines and bounds at the same normalized coordinates. Include `M`, `W`, `AE`, `m`, `w`, accented
   `W`/`w`, and ordinary letters; run with `ss02` off and on.
3. **Composite coverage:** identify Paper composites with `gvar` data and compare their component transforms, bounds,
   and rendered pixels at a named and a non-named weight. An accented duospace letter is useful, but the oracle should
   select from actual composite-variation records rather than assume a glyph's construction.
4. **Artifact coherence:** assert identical clusters, glyph IDs, advances, positions, ink bounds, outline geometry, and
   bitmap/MTSDF/Slug instance selection for a coordinate. Reload artifacts and attach sidecars to exercise provenance.
5. **Identity:** prove two weights receive different shaping fingerprints and handles; prove repeated loads of the same
   canonical coordinate deduplicate; prove a cached `(fontHandle, glyphId)` outline never changes.
6. **Format boundaries:** add separate CFF2 and `VARC` fixtures before claiming those formats. Paper cannot verify them.
7. **Performance later:** after #247 timing is complete, measure bake cost, artifact bytes, outline decode/load memory,
   and cache cardinality for several static instances. Measure live-axis publication only if live axes become scheduled.

No local performance numbers were collected for this report, and the interrupted build is not evidence. This keeps the
recommended implementation scoped to correctness first: static Paper files now, one coherent baked variable instance
next, and no claim of live-axis, CFF2, or `VARC` support.
