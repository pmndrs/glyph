# Three Flatland Slug audit

Status: research snapshot  
Audited revision: [`c596ac2313e33cace825fe197a6d730269019175`](https://github.com/thejustinwalsh/three-flatland/tree/c596ac2313e33cace825fe197a6d730269019175/packages/slug)  
Audit date: 2026-07-22

This document identifies concrete prior art in `@three-flatland/slug` and assigns a migration disposition. It is not a criticism of the existing package: the current code deliberately targets a smaller problem and is valuable evidence for the new architecture.

## Executive finding

The reusable value is concentrated in the presentation pipeline and operational lessons:

- outline normalization to quadratic curves;
- band acceleration and texture packing;
- TSL shader implementation and test references;
- a compact GLB reader using typed-array views;
- baked-first loading with a lazy runtime fallback;
- real-font round-trip tests and measured Slug payload sizes.

The shaping and paragraph paths should be rewritten around HarfRust and source clusters rather than incrementally extended. The current path assumes one UTF-16 code unit maps to one glyph, disables GSUB features to preserve that assumption, stores only explicit pair kerning, and mixes shaping with wrapping/alignment.

## Current architecture

The package currently combines five responsibilities:

1. source font parsing through `opentype.js`;
2. basic cmap/advance/pair-kerning text placement;
3. word wrapping, paragraph measurement, and alignment;
4. Slug curve/band presentation generation;
5. Three.js/React rendering objects and loader integration.

The new package should split these into a font compiler, Wasm shaper, JS paragraph engine, presentation payloads, and renderer adapters.

## Findings by subsystem

### Shaping: rewrite

The baked shaper in [`textShaperBaked.ts`](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/pipeline/textShaperBaked.ts):

- iterates `text.length` and calls `charCodeAt(i)`;
- maps each UTF-16 code unit through a `Uint16Array` cmap;
- uses the JavaScript string index as `srcCharIndex`;
- emits only `{glyphId, srcCharIndex, x, y, scale}`;
- applies one explicit pair-kerning value;
- performs wrapping and alignment inside the same function.

The runtime `opentype.js` path in [`textShaper.ts`](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/pipeline/textShaper.ts) explicitly disables `liga` and `rlig`. Its comment explains that substitutions change returned glyph count and break the code's indexing back into `text[i]` for spaces and newlines. This is direct evidence that the one-character/one-glyph contract is the limiting abstraction.

Disposition:

- preserve tests that define current simple-Latin behavior as migration fixtures;
- replace the shaping implementation and output type;
- do not port its combined shape/wrap loop;
- use its baked/runtime equivalence intent, not its algorithm, as prior art.

### cmap and kerning: rewrite representation

[`baked.ts`](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/baked.ts) reconstructs two separate `Uint16Array` cmap columns and performs binary search. This excludes scalar values above U+FFFF. Kerning is stored as six-byte triples and `kernLookup` linearly scans every pair for every lookup.

[`bake.ts`](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/bake.ts) validates both cmap values and glyph IDs as `u16`, then writes explicit `[left, right, value]` triples. It does not represent class pair positioning or the other GPOS lookup families.

Disposition:

- replace source glyph IDs with dense packed IDs;
- use full scalar cmap plus variation sequences;
- benchmark paged cmap alternatives;
- preserve class positioning rather than expanding it blindly;
- use HarfRust behavior as the reference for GSUB/GPOS/GDEF.

### Paragraph layout: rewrite boundary, retain behavioral fixtures

[`wrapLinesBaked.ts`](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/pipeline/wrapLinesBaked.ts) duplicates cmap and kerning traversal, tracks ASCII space and LF explicitly, and slices JavaScript strings by code-unit indices. `shapeTextBaked`, `wrapLinesBaked`, and `textMeasureBaked` each perform related traversal.

This produces deterministic agreement between the package's rendering and measurement paths, which is valuable. It is not sufficient for UAX #14 line breaking, grapheme safety, bidi line ordering, shaped clusters, contextual boundary reshaping, soft hyphens, or ellipsis.

Disposition:

- retain existing simple wrap/measurement examples as compatibility cases;
- centralize broad shaping and measured clusters;
- move break policy and reflow caches into the JS paragraph engine;
- batch boundary-sensitive reshape requests into Wasm.

### Binary GLB reader: port concept, harden contract

[`glb.ts`](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/glb.ts) is a small specialized reader that:

- validates GLB magic/version/chunk bounds;
- parses only the JSON and BIN structures it needs;
- returns typed-array views directly over accessor bytes;
- checks accessor bounds against both buffer view and BIN chunk.

This is strong prior art for avoiding a general glTF runtime dependency. The new format needs additional validation for alignment, stride, required sections, integer overflow, overlapping ranges, capability bits, and extension-specific invariants.

Disposition:

- port the narrow-reader philosophy;
- rewrite around `PMNDRS_font` section directories and presentation references;
- keep fuzz/corrupt-input tests from the beginning;
- decide whether GPU-oriented sections remain accessors while CPU shaping sections use one custom block.

### Baked object reconstruction: remove

The baked loader reads flat accessors, then [`unpackBaked`](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/baked.ts) reconstructs:

- `Map<number, SlugGlyphData>`;
- bounds and location objects per glyph;
- horizontal and vertical band arrays;
- per-band `curveIndices` arrays;
- copied cmap code and glyph arrays.

Curve and band textures themselves are uploaded directly, so the reconstruction is mainly for the shared `SlugGlyphData` runtime model.

Disposition:

- do not port the object graph;
- register flat shared shaping sections with Wasm;
- expose only small JS font/presentation handles;
- keep presentation metadata in typed views or GPU buffers.

### Slug outline conversion: port with validation

[`fontParser.ts`](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/pipeline/fontParser.ts) and the architecture document define these useful behaviors:

- line segments represented as slightly bowed degenerate quadratics to avoid scanline dropout;
- native quadratic segments retained;
- cubics split at `t=0.5` into two quadratic approximations;
- outlines normalized to em space;
- glyph bounds and metrics extracted alongside geometry.

The cubic-to-quadratic approximation needs explicit visual/error tests at extreme scale. The shared new baker should obtain outlines once through the chosen Fontations abstraction and feed the same canonical outline to all generators.

Disposition:

- port the mathematical behavior into a renderer-independent Rust presentation generator if licensing permits;
- add approximation-error and pathological-outline fixtures;
- keep source parsing out of the TypeScript runtime path.

### Band acceleration: port and benchmark

[`bandBuilder.ts`](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/pipeline/bandBuilder.ts) partitions glyph bounds horizontally and vertically, removes curves that cannot intersect the corresponding ray, and sorts references for shader early exit.

The current architecture documents a default of 16 bands and a maximum of 40 curves per band. These are tuned implementation values rather than general format truths.

Disposition:

- preserve the algorithm and tests as the initial Slug generator candidate;
- store chosen band counts/limits in presentation metadata where necessary;
- benchmark font corpus distributions before fixing V1 limits;
- reject or adapt glyphs that exceed shader/runtime capacity instead of truncating.

### Slug texture packing: port format intent, revisit constraints

[`texturePacker.ts`](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/pipeline/texturePacker.ts) already emits GPU-native data:

- RGBA16F curve control points;
- RG32F band headers/references;
- endpoint sharing within contours;
- adjacent-band reference-list deduplication;
- no curve pair crossing a texture row;
- power-of-two texture heights;
- nearest sampling.

This is the strongest direct port candidate. The hard-coded width of 4096 and power-of-two rationale should be revalidated against target WebGPU/WebGL backends and actual compression/upload paths. Integer-valued data stored in floats is a portability tradeoff worth measuring against storage buffers or integer textures in the new renderer matrix.

Disposition:

- port the packing model and shader agreement tests;
- make texture dimensions and formats explicit presentation metadata;
- validate all counts/offsets before upload;
- benchmark alternative storage-buffer layout if renderer targets permit it.

### Slug shaders: port with attribution and renderer adapter

The TSL shader modules and CPU reference tests are valuable implementation assets. The project should preserve:

- root eligibility classification;
- quadratic solving and near-linear fallback;
- dual horizontal/vertical coverage;
- fill-rule behavior;
- coverage reference tests;
- pixel-size and dilation behavior.

Disposition:

- keep renderer code outside the shaper and paragraph packages;
- port only after the license/attribution audit is complete;
- maintain CPU reference equations and visual snapshots;
- avoid making Three.js instance layout the canonical font format.

### Loader: port product shape, rewrite fallback

[`SlugFontLoader.ts`](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/SlugFontLoader.ts) demonstrates:

- a baked-first sidecar lookup;
- cached load promises;
- dynamic imports on the runtime path;
- a narrow GLB reader without glTF-Transform in the browser bundle;
- direct `DataTexture` construction from baked texture accessors.

The current fallback fetches and parses the source font on the main thread, parses it through both `parseFont` and `opentype.parse`, then creates a distinct runtime `SlugFont` model instead of canonical baked bytes. A corrupt baked sidecar silently falls back to runtime parsing.

Disposition:

- preserve baked-first/lazy-heavy-dependency behavior;
- replace fallback with a worker baker returning canonical bytes;
- remove `forceRuntime`; a sidecar miss automatically falls back and emits one development warning with the pre-bake command;
- avoid double source parsing;
- distinguish “sidecar absent” from “sidecar corrupt/incompatible” in diagnostics and policy;
- keep the everyday/direct/preload surface aligned with the eventual pmndrs loader conventions.

The reusable structural pattern extends beyond `SlugFontLoader`: Three Flatland's browser-safe `@three-flatland/bake` root keeps Node discovery/writers behind `/node`, package-specific baker modules behind separate exports, and the standalone/unified CLIs call the same `Baker.run()` implementation. `pmndrs/text` should preserve that host separation while replacing the TypeScript font-domain core with one portable core shared by the Node host and runtime Worker.

## Format observations

The existing `FL_slug_font` format has several good ideas:

- a single GLB sidecar;
- schema version gating;
- named structure-of-arrays columns;
- standard accessors for GPU data;
- an N+1 prefix-sum band index;
- explicit texture format metadata;
- glTF-Transform extension registration for authoring tools.

Constraints to avoid inheriting:

- source rather than dense glyph IDs;
- glyph IDs encoded as `Float32` columns;
- all cmap entries limited to `u16`;
- band offsets encoded as floats;
- flat explicit kerning only;
- presentation and shaping data in one Slug-specific extension;
- `extensionsRequired` causing unaware glTF tools to reject the asset even when font data is ignorable to scene processing;
- runtime object reconstruction after reading flat data.

## Existing evidence worth preserving

The package includes valuable test categories:

- real-font pack/unpack equivalence using Inter;
- malformed GLB/accessor validation;
- band builder and texture packer tests;
- shader CPU reference tests;
- baked versus runtime shaping/measurement equivalence;
- paragraph measurement and font-stack behavior.

The README records an Inter Regular Slug-presentation baseline:

| Subset | Glyphs | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: | ---: |
| All | 2,849 | 12.78 MB | 1.0 MB | 724 KB |
| Latin | 523 | 2.15 MB | 208 KB | 208 KB |
| ASCII | 95 | 412 KB | 44 KB | 32 KB |

These numbers are useful only as a snapshot of the existing complete Slug GLB; they do not isolate shaping data from presentation data. Future benchmarks must report those sections separately.

## File disposition matrix

| Existing area | Disposition | Destination concept | First required proof |
| --- | --- | --- | --- |
| `pipeline/fontParser.ts` | Port/rewrite | Rust canonical outline + Slug generator | outline equivalence and cubic error tests |
| `pipeline/bandBuilder.ts` | Port | Slug presentation baker | corpus capacity statistics |
| `pipeline/texturePacker.ts` | Port/revise | Slug GPU payload packer | upload and shader agreement |
| `shaders/*` | Port after audit | renderer adapter | CPU reference + visual snapshots |
| `glb.ts` | Port philosophy | narrow `PMNDRS_font` reader/validator | corrupt-input suite |
| `format.ts`, `bake.ts` | Redesign | shared extension + presentation schemas | golden bytes and version rules |
| `baked.ts` object hydration | Retire | flat Wasm/GPU views | allocation/startup benchmark |
| `textShaper*.ts` | Replace | HarfRust Wasm shaper | three-way conformance |
| `wrapLines*.ts` | Replace | JS paragraph engine | UAX and reflow fixtures |
| `textMeasure*.ts` | Replace/derive | shaped-cluster measurement | measure/layout agreement |
| `SlugFontLoader.ts` | Port product shape | baked loader + worker fallback | one canonical output path |
| `SlugFontStack.ts` | Redesign | cluster-safe font fallback | mixed-script fallback fixtures |
| `SlugGeometry.ts` | Adapter-specific | Slug renderer adapter | technique-independent layout reuse |
| React components | Defer | framework binding | core API stability |

## Migration order

1. Freeze the current Slug revision used for comparison and retain its tests/fixtures.
2. Establish the new shaped output and packed glyph-ID contracts without rendering.
3. Produce a tiny `PMNDRS_font` with shared metrics plus a revised Slug presentation.
4. Compare old and new Slug GPU bytes or rendered output for the same source outlines.
5. Add MTSDF and bitmap presentations against the same glyph IDs.
6. Add the worker fallback and prove it emits the same canonical sections.
7. Integrate the JS paragraph engine and renderer adapters.
8. Migrate Three Flatland only after the standalone package has equivalent demonstrations and diagnostics.

## Audit follow-ups

- Confirm license and attribution requirements for each file proposed for porting.
- Capture exact shader/band capacity behavior for glyphs exceeding current limits.
- Measure current loader allocations and load time for ASCII, Latin, and full Inter GLBs.
- Determine whether the current cubic approximation is visually acceptable for the broader font corpus.
- Inventory Three Flatland's loader architecture separately before designing the final public loader API.
- Decide whether compatibility with the old `.slug.glb` is useful or whether an explicit one-time rebake is cleaner.
