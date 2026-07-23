---
type: Artifact Catalog
title: Roadmap artifact map
description: Defines the runtime, bake, GLB, test, and evidence artifacts produced by each implementation milestone.
status: proposed
tags: [artifacts, roadmap, testing, packaging]
---

# Roadmap artifact map

## Shipping libraries and modules

| Artifact | Import or identity | Owns | Must not own |
| --- | --- | --- | --- |
| Browser core | `@pmndrs/text` | loader, registry, shaper bridge, paragraph API | Node I/O, source parsing, presentation engines |
| Node baker | `@pmndrs/text/bake` | filesystem host, JS bake API, thin CLI | font-domain decisions duplicated from the core |
| Runtime baker library | `@pmndrs/text/runtime-bake` | dynamic Worker lifecycle and transferable protocol | eager main-bundle imports |
| Portable bake core | internal Rust/Wasm/native library | source validation, canonical transformation, packing, diagnostics | filesystem, DOM, CLI policy |
| Runtime shaper | HarfRust-based Wasm module | Unicode/OpenType shaping, plans, flat batch ABI | paragraph policy, presentation data |
| Paragraph engine | JavaScript module | constraints, breaks, line layout, caches, reshape batching | GSUB/GPOS, GPU records |
| Bitmap presentation | `@pmndrs/text/presentation/bitmap` | validation, texture upload, draw batching | measurement or shaping changes |
| MTSDF presentation | `@pmndrs/text/presentation/mtsdf` | release-required generator/decoder/shader after the bitmap proof | eager inclusion in bitmap-only apps |
| Slug presentation | `@pmndrs/text/presentation/slug` | release-required curves/bands/paint rendering after the bitmap proof | eager inclusion in other apps |

## Font artifacts

| Artifact | Required content | Packaging |
| --- | --- | --- |
| Core font GLB | `PMNDRS_font`, shaping-only static SFNT, extents, referenced contour points, metrics, provenance, presentation directory | always independently usable for shaping |
| Bitmap presentation GLB | `PMNDRS_font_bitmap`, reciprocal identity, strikes, dense 20-byte records, lossless KTX2 baseline | embedded in core or attached separately |
| Distance-field presentation GLB | `PMNDRS_font_distance_field`, reciprocal identity, dense 20-byte records, linear RGBA8 KTX2 baseline | release milestone 8; embedded or separate |
| Slug presentation GLB | `PMNDRS_font_slug`, reciprocal identity, 40-byte glyph records, RGBA16F curves, exact headers/references | release milestone 9; embedded or separate |

Embedded and split packaging must preserve identical authoritative records. A presentation attaches only after shaping hash, glyph count, glyph-ID width, ID, and extension version match.

## Fixtures

| Fixture class | Required evidence |
| --- | --- |
| Source font | authorized bytes, license, source URL, version, SHA-256 |
| Shaping | text/run inputs plus HarfBuzz, HarfRust, and runtime outputs |
| Paragraph | constraints, selected breaks, positioned glyphs, resize variants |
| GLB | golden JSON/BIN bytes, schema validation, corrupt ranges and extensions |
| Presentation | decoded records, texture pixels, GPU readback, visual goldens |
| Delivery | baked hit, missing fallback, invalid asset, cancellation, deduplication |
| Package graph | proof that unused baker and presentation modules are unreachable |

## Reports

Every milestone that creates executable behavior emits machine-readable raw evidence and a concise human summary:

- conformance result and allowlist;
- raw, gzip, Brotli, decoded, and GPU byte counts by category;
- cold/warm p50 and p95 timings;
- peak Wasm/Worker/main-thread memory;
- JS/Wasm call counts and allocations;
- rendering error images or metrics where visual output is involved;
- exact environment, source, descriptor, and implementation versions.

## Ownership by milestone

| Milestone | New authoritative artifacts |
| --- | --- |
| 0 | accepted API/data contracts and version manifest |
| 1 | source, shaping, paragraph, visual, corrupt-input, and benchmark fixtures |
| 2 | portable bake core, Node baker, core GLB, bitmap GLB, validators, bake report |
| 3 | loader, runtime baker library, Worker protocol, delivery/package-graph fixtures |
| 4 | HarfRust Wasm shaper, batch ABI fixtures, shaping report |
| 5 | JS paragraph engine, layout fixtures, reflow report |
| 6 | bitmap presentation module, WebGPU/WebGL2 scenes, GPU and quality reports |
| 7 | full integration suite, baselines, accepted ADRs, reviewed extension drafts |
| 8 | MTSDF generator/runtime, atlas and visual fixtures, GPU and payload reports |
| 9 | Slug generator/runtime, packed curve/band fixtures, visual and GPU reports |
| 10 | three-renderer integration suite, second-font smoke fixtures, release evidence |

The [canonical roadmap](ROADMAP.md) defines the order and exit gates. The detailed [tooling plan](/planning/TOOLING_FIXTURES.md), [conformance plan](/planning/CONFORMANCE_PLAN.md), and [benchmark plan](/planning/BENCHMARK_PLAN.md) define how artifacts are produced and checked.
