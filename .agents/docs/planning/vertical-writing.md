---
type: Design Research
title: Vertical writing for CJK and mixed scripts
description: Defines the retained data, layout stages, renderer work, and acceptance gates for a post-v1 vertical-writing milestone.
tags: [layout, shaping, cjk, vertical-writing, typography]
sources:
  - id: unicode-vertical-orientation
    resource: https://www.unicode.org/reports/tr50/
    title: Unicode Vertical Text Layout
  - id: opentype-vmtx
    resource: https://learn.microsoft.com/en-us/typography/opentype/spec/vmtx
    title: OpenType vertical metrics table
  - id: opentype-features
    resource: https://learn.microsoft.com/en-us/typography/opentype/spec/features_uz
    title: OpenType registered vertical features
  - id: roadmap
    resource: ../roadmap/roadmap.md
    title: Canonical implementation roadmap
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-07T01:16:02Z'
---

# Vertical writing for CJK and mixed scripts

Status: accepted post-v1 direction; implementation is scheduled after complete CJK paging

## Recommendation

Treat vertical writing as a dedicated layout mode, not a transform applied to a
horizontal paragraph. Begin with one Japanese top-to-bottom paragraph whose
columns progress right-to-left. Preserve the current horizontal fast path and
reuse the same font identity, shaped-output arrays, line-break policy, and
raster modules wherever their contracts remain direction-independent.

The first slice should support upright Han, kana, and full-width punctuation;
font-provided vertical alternates; Unicode default orientation for mixed
characters; vertical metrics and origins; right-to-left column progression;
selection/hit-test coordinates; and Bitmap, MTSDF, and Slug rendering. It should
defer tate-chū-yoko, ruby, warichū, kinsoku tailoring beyond the current UAX #14
policy, Mongolian, arbitrary flow exclusions, and multi-column balancing until
the base direction is proven.

## Why this is more than rotating the canvas

OpenType vertical layout uses per-glyph advance heights and top side bearings
from `vmtx`, face-wide values from `vhea`, and CFF/CFF2 vertical origins from
`VORG` when present. Fonts may substitute different punctuation and rotated
forms through `vert` and `vrt2`. Unicode Vertical_Orientation then determines
whether each grapheme cluster stays upright, rotates, or prefers a transformed
glyph. The paragraph engine must advance glyphs down a column, move completed
columns right-to-left, and expose logical-to-visual coordinates that remain
correct for editing and hit testing.

The repository already preserves `BASE`, `VORG`, `vhea`, and `vmtx` in reduced
fonts, so baking does not discard the needed inputs. It does not yet interpret
those metrics, request top-to-bottom shaping, classify vertical orientation,
plan columns, rotate individual glyph instances, or validate vertical pixels.

## Work breakdown

| Layer            | Existing foundation                                                                | Required work                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Font data        | Required vertical tables survive reduction when present.                           | Typed vertical metrics/origin readers, variable-metric policy, and explicit unsupported-table diagnostics.                                                             |
| Shaping          | HarfRust already supplies one universal shaping engine and font-local glyph IDs.   | Top-to-bottom direction, `vert`/`vrt2` evidence, vertical advances/offsets, and HarfBuzz differential fixtures.                                                        |
| Unicode          | Grapheme, script, bidi, and line-break data are pinned.                            | Pinned Vertical_Orientation data and cluster-level upright/rotated/transformed policy.                                                                                 |
| Paragraph        | Horizontal broad shaping, safe breaks, and positioned output are allocation-light. | Inline/block axis abstraction, vertical line measurement, right-to-left column progression, vertical alignment/clipping/ellipsis, hit testing, and selection geometry. |
| Renderers        | Bitmap, MTSDF, and Slug consume shared positioned glyph identity.                  | Per-instance orientation and origin, vertical bounds, pixel snapping for native strikes, batch invariants, and backend parity.                                         |
| Product evidence | The harness already separates live benchmark and visual conformance modes.         | A vertical-reading workload, horizontal/vertical source comparisons, punctuation/orientation closeups, mixed Latin controls, and payload/frame/GPU evidence.           |

## Effort and sequencing

This is an XL milestone. A narrow Japanese-only slice is still several
cross-cutting changes because correctness spans font data, shaping, paragraph
geometry, interaction coordinates, and every renderer. It should follow
large-coverage CJK raster paging: vertical shaping without resident glyph pages
would prove layout but not deliver a usable full-font renderer. It may reuse the
editorial flow milestone's axis-neutral region vocabulary, but must not be
hidden inside that milestone or force horizontal callers to pay for vertical
state.

## Acceptance gates

- source-font and reduced-font HarfRust output agrees exactly for vertical
  Japanese cases and matches authenticated HarfBuzz fields;
- `vhea`, `vmtx`, `VORG`, `vert`, and `vrt2` behaviors are covered by positive
  fixtures plus explicit absent-table fallbacks;
- Unicode Vertical_Orientation is applied to grapheme clusters, with visual
  cases for upright Han/kana, transformed punctuation, sideways Latin, and
  combining marks;
- columns progress right-to-left with deterministic line breaks, alignment,
  clipping, ellipsis, hit testing, and selection geometry;
- Bitmap, MTSDF, and Slug consume one positioned result and preserve batching;
- WebGPU and WebGL2 conformance views expose candidate, independent reference,
  and difference pixels, while the live benchmark reports consumer costs;
- horizontal tests and package-size budgets do not regress.

## Explicitly deferred from the first slice

- tate-chū-yoko and other short horizontal runs embedded in vertical text;
- ruby, emphasis marks, warichū, and region-specific publishing refinements;
- Mongolian and scripts whose vertical conventions differ from Japanese;
- vertical flow around exclusions and balanced multi-column pagination;
- public API freezing before product and integration evidence exists.
