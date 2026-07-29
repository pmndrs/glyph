---
type: Research Note
title: Language-aware font units and physical bitmap strikes
description: Defines the staged lookup and delivery model for language coverage, large fonts, and DPR-specific bitmap strikes.
status: draft
tags: [fonts, subsetting, language, cjk, bitmap, dpr, paging]
sources:
  - id: noto-cjk-download-guide
    resource: https://github.com/notofonts/noto-cjk/blob/main/Sans/README.md
    title: Noto Sans CJK download guide
  - id: pinned-noto-manifest
    resource: ../../apps/benchmarks/fixtures/fonts/noto-sans-cjk-2.004/manifest.json
    title: Pinned Noto Sans CJK JP 2.004 evidence
  - id: raster-contract
    resource: raster-data-contract.md
    title: Raster data contract V0
  - id: roadmap
    resource: ../roadmap/roadmap.md
    title: Canonical roadmap
generated:
  by: openai-codex/gpt-5.6
  at: '2026-07-27T16:01:32Z'
---

# Language-aware font units and physical bitmap strikes

Status: staged design; CSS/DPR strike selection is implemented, independently fetched strike and language units remain Milestones 13 and 17.

## Why one font URL stops scaling

The pinned Noto Sans CJK JP Regular 2.004 source is `16,467,736 B` raw, `13,629,545 B` gzip, and `12,365,597 B` Brotli for 65,535 glyphs. Its shaping-only core GLB is much smaller: `1,540,480 B` raw, `654,597 B` gzip, and `515,676 B` Brotli. Full raster coverage, especially at several bitmap strikes, dominates the transfer and GPU cost.

The Noto project itself publishes language-specific and region-specific subset formats. Japanese, Korean, Simplified Chinese, Traditional Chinese, and Hong Kong share many code points but require locale-sensitive glyph preference. A caller saying only “Japanese” is useful policy input, but it is not a sufficient correctness boundary: text can mix Latin, punctuation, emoji, Han, and another script in one paragraph.

## Selection model

Selection is coverage-first and locale-aware:

1. Segment text at grapheme-safe script and style boundaries already owned by the paragraph engine.
2. Find a font unit whose exact coverage contains every scalar needed by the segment.
3. Use locale/language preference to order units that cover the same characters, particularly unified Han.
4. Shape the complete selected run with one unit. Never split a contextual shaping run merely because another unit contains an individual code point.
5. Fall through an explicit font chain for uncovered graphemes and report unresolved coverage before drawing.

The compiler must compute shaping closure. A requested Unicode range is only the seed: GSUB substitutions, GPOS/GDEF dependencies, variation sequences, required marks, `.notdef`, and any retained vertical data must remain internally valid. Dense glyph remapping is an advanced compiler-unit concern, not a runtime shortcut.

## Proposed family directory

A small authenticated family directory should name independently loadable units without putting URL policy into the shaping ABI. Each unit needs:

- immutable family/unit identity, source identity, format version, byte length, and hash;
- exact coverage data plus script and locale preferences;
- metrics-compatibility identity for units intended to compose on one line;
- one shaping-core resource and zero or more raster directories;
- bitmap strike descriptors and logical atlas pages that may resolve independently;
- priority/fallback ordering and explicit missing-coverage diagnostics.

The directory is a lookup layer above existing font-local handles. Loaded units keep their own glyph namespace; the runtime does not pretend remapped glyph IDs from two units are one face.

## Bitmap DPR policy

Public font size is measured in logical CSS pixels. The rendering integration supplies `rasterPixelRatio`; the core does not read DOM globals or install event listeners. Bitmap selection targets:

```text
target ppem = CSS font size × raster pixel ratio
```

It chooses the nearest declared strike deterministically. A 16 CSS px label therefore targets 16 ppem at 1×, 32 ppem at 2×, and 48 ppem at 3× while preserving identical shaping and layout geometry.

Strikes remain separate grayscale textures and record sets. Packing unrelated 1×/2×/3× atlases into RGB(A) channels would couple different rectangle layouts, prevent selective residency and eviction, waste channels, and complicate filtering. One transport artifact may contain several strikes, but each strike keeps independent identity and pages. Large deployments should use one manifest with separately fetched strike payloads, retain the previous usable strike until replacement readiness, and evict unused density/language pages under the raster module's memory policy.

## Staged delivery

| Stage                                            |   Status   | Scope                                                                                                                                                                      |
| ------------------------------------------------ | :--------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS-size-stable DPR and nearest-strike selection |     ✅     | `Text.rasterPixelRatio` rebuilds raster batches while reusing the paragraph; unit tests prove 16 CSS px selects 16/32/48 ppem at 1×/2×/3×.                                 |
| Benchmark 16/32 strike evidence                  |     ⏳     | Publish representative multi-strike fixtures and show selected strike, scale ratio, transport, decoded, and GPU bytes at both DPRs.                                        |
| External strike/raster paging                    |   ⏳ M13   | Load, deduplicate, cancel, retain, and evict independently addressed logical pages without changing shaping identity.                                                      |
| Language-aware family directory                  | ⏳ M13/M17 | M13 proves coverage-directed raster delivery over the full CJK shaping core; M17 adds compiler-produced shaping units, closure, optional remapping, and normalized lookup. |

## Required evidence

- Identical CSS layout dimensions at 1× and 2× with doubled framebuffer dimensions and physical ppem.
- Exact nearest-strike selection, deterministic tie behavior, and a visible missing-strike degradation case.
- Display-density changes that retain the old strike until the new resource is ready and release superseded residency deterministically.
- Mixed Latin/CJK/complex-script paragraphs whose unit selection matches declared coverage and locale preference without splitting graphemes or contextual runs.
- Per-unit and aggregate transfer, decoded CPU, atlas page, and GPU-residency reporting in the benchmark inspector.
- Malformed directories, coverage lies, hash failures, cancellation, eviction, and concurrent request tests.
