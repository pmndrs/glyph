---
type: Workspace Package
title: "@pmndrs/text"
description: Implements public font loading, shaping, paragraph measurement, static discovery, and portable bitmap artifact contracts.
resource: ../../packages/text
workspace_package: "@pmndrs/text"
documentation_type: reference
source_digest: "sha256:ba06778432559e47adee28299052123c067cea939e8d898cc3b557f00a17bd02"
tags: [package, public-api, typescript, contracts]
sources:
  - id: manifest
    resource: ../../packages/text/package.json
    title: Package manifest
  - id: api-contract
    resource: ../planning/api-shapes.md
    title: Runtime and bake API V0
  - id: discovery
    resource: ../../packages/text/src/discovery.ts
    title: Static project discovery implementation
  - id: compiler-adapter
    resource: ../../packages/text/src/compiler-adapter.ts
    title: Pinned TypeScript compiler adapter
  - id: bitmap-identity
    resource: ../../packages/text/src/raster/bitmap.ts
    title: Bitmap descriptor and raster identity implementation
  - id: bitmap-baker
    resource: ../../packages/text/rust/bitmap-baker
    title: Portable bitmap generator implementation
  - id: bitmap-validator
    resource: ../../packages/text/src/bakers/bitmap-validator.ts
    title: Layered bitmap artifact validator
  - id: composition
    resource: ../../packages/text/src/internal/compose-bake.ts
    title: Generic core/raster artifact composer
  - id: node-host
    resource: ../../packages/text/src/node/bake.ts
    title: Node bake API and filesystem host
  - id: loader
    resource: ../../packages/text/src/loader.ts
    title: Baked-first loader and registry
  - id: runtime-bake
    resource: ../../packages/text/src/runtime-bake.ts
    title: Lazy module-Worker bake host
  - id: core-bake-policy
    resource: ../../packages/text/src/internal/core-bake-policy.ts
    title: Shared offline/runtime core bake policy
  - id: raster-bake-plan
    resource: ../../packages/text/src/internal/raster-bake-plan.ts
    title: Single-evaluation raster plan resolution
  - id: shaper-bridge
    resource: ../../packages/text/src/shaper.ts
    title: Direct-memory runtime shaper bridge
  - id: shaper-core
    resource: ../../packages/text/rust/shaper
    title: HarfRust Wasm shaper implementation
  - id: paragraph
    resource: ../../packages/text/src/paragraph.ts
    title: Paragraph engine implementation
  - id: unicode-analysis
    resource: ../../packages/text/src/internal/unicode.ts
    title: Unicode analysis implementation
generated:
  by: openai-codex/gpt-5.6
  at: "2026-07-26T03:50:00Z"
---

# Package reference: `@pmndrs/text`

Status: ✅ Milestone 5 paragraph reflow and CJK universality complete; Milestone 6 rendering next

This package owns the accepted public core and React contract types. Its fixtures prove literal font and raster inference, capability composition, source/baked input rules, paragraph constraints, React prop derivation, lazy raster and `useFont` inference, and invalid combinations at compile time. React and React Three Fiber remain optional peer capabilities and are not reachable from the core entry point. Public raster-baker descriptors are constrained to `JsonValue` while preserving their exact inferred shape. Plugin-produced values are still revalidated during their unavoidable RFC 8785 canonicalization pass: exotic prototypes, cycles, excessive nesting, non-finite numbers, invalid Unicode, and non-JSON values cannot collide with a valid raster identity, while repeated non-cyclic references remain legal. Project plans resolve each descriptor and `rasterKey` once, then carry that same pair through ordering, packaging, and baking so a stateful plugin cannot make identity drift within one bake.

The Node host rejects distinct source files that collapse onto one output path before any bake begins, reports mutually exclusive phase timings, and retries the lazily loaded default bitmap baker after a failed initialization instead of pinning a rejected promise. These rules keep batch publication deterministic and make measured phase totals honest. The loader also refuses URI-addressed external raster entries without SHA-256 authentication; resolver-only delivery remains explicit and hash-optional.

The browser-safe `@pmndrs/text/raster/bitmap` subpath now owns bitmap generator/format constants, the exact `1..=1022` ppem V0 range, runtime validation of the non-empty static strike tuple, ascending canonical strike order, the complete generator-versioned descriptor, RFC 8785 serialization, and SHA-256 raster-key derivation. Equivalent strike sets therefore produce one identity regardless of caller order, while duplicate, non-integral, non-finite, non-positive, or out-of-range values fail before baking. The implementation uses Web Crypto and imports no Node built-ins.[^bitmap-identity]

The optional `@pmndrs/text/bakers/bitmap` subpath wraps a zero-import `no_std + alloc` Wasm generator through its Rust-generated JSON ABI and direct linear-memory shim. Fontations/Skrifa owns font and outline interpretation; a small pen bridge feeds Zeno's maintained antialiased rasterizer. A deterministic shelf packer emits one dense 20-byte record per source glyph plus lossless linear R8 KTX2 pages, either embedded in the companion GLB or emitted as hashed external artifacts. Artifact and page filenames bind both `shapingHash` and `rasterKey`, preventing two fonts with the same raster configuration from overwriting one another. Glyph masks are placed as they are rasterized instead of retaining a second full-face bitmap set, fixed buffers reserve fallibly, and the atlas-compatible ppem bound rejects structurally impossible requests before font work. Binaryen 129.0.0 `-Oz` reduces the hardened distributed module to 658,470 bytes raw, 238,750 bytes gzip, and 182,928 bytes Brotli.

The isolated `@pmndrs/text/bakers/bitmap/validate` entry reuses the core package's strict GLB framing and pinned Khronos validator, evaluates byte-identical Draft-04 bitmap/resource schemas, parses every declared page variant with `ktx-parse` 1.1.0, and enforces reciprocal identity, exact strikes, dense records, page bounds, KTX2 dimensions/format/levels, GPU-format/feature/quality mapping, external length/hash, arithmetic limits, and GPU budgets. Rust independently parses every native-test KTX2 through `ktx2` 0.5.0. Canonical Inter source/Wasm/artifact/report/record/page identities, embedded/external parity, 65,535-glyph boundaries, generated/published ABI identity, deterministic arbitrary-font Rust fuzz smoke, and fixed-seed artifact mutation fuzz smoke are executable fixtures.[^bitmap-baker]

The internal generic composer authenticates every returned artifact, checks reciprocal shaping/glyph/raster identity, retains external companions and pages, and embeds package-owned companion data without interpreting its semantics. Integer glTF buffer-view references are rebased through the shared naming convention, so multiple distinct extension types compose without a closed registry. Exact Inter goldens cover combined embedded, combined external, and the identity-neutral empty raster set; both the core and bitmap validators round-trip the combined bytes.

The Node-only `@pmndrs/text/bake` subpath closes roadmap item 2.4 around the item-2.1 TypeScript 7 AST/symbol discovery engine. `bakeFont` handles an explicit filesystem input/output pair and retains each selected raster package's exact option type. `bakeProject` finds composed tokens and statically visible core/React raw forms across TypeScript, TSX, JavaScript, and JSX; reduces immutable font/raster expressions; maps URL pathnames into canonical asset roots; groups identical sources; and dynamically imports only the exact verified raster-package ESM entry. It never executes application modules. One internal compiler adapter owns every unstable TypeScript import, project snapshot, symbol handle, alias, and declaration-resolution operation; an exact-version assertion and source-boundary test make compiler upgrades explicit.

The native-ESM `pmndrs-text-bake` command is a thin `bakeProject` adapter. The host writes exclusive same-directory temporary files, backs up existing regular-file targets, publishes only after every artifact is staged, and restores all earlier targets if a later rename fails; process termination during the multi-file swap is not claimed as a filesystem transaction. It rejects input/output overlap and unsafe package-owned filenames and cleans temporary or backup files after success, cancellation, and ordinary failure. Discovery reports are sorted by source file and lexical AST offset after concurrent analysis. Its report adds phase/total timing, before/after RSS, explicitly process-lifetime peak RSS, output paths and hashes, and raw/gzip/Brotli transport sizes to the authoritative core/raster/container byte report.[^node-host]

The public `FontLoader` and `FontRegistry` close item 3.1. They normalize every accepted input form into deterministic source/baked URLs, deduplicate request promises and validated shaping identities, and run the same hostile-input validator before registration. The large pinned Khronos/Ajv validation graph is cached behind a separate dynamic import: package import stays small, while the first actual registration still validates before publishing anything. Registration owns the bytes and retains the extracted reduced SFNT, glyph extents/availability, metrics, Unicode/source provenance, source candidates, and opaque raster directory required by later stages. Exact Inter fixtures compare those retained shaping views byte-for-byte with independent GLB validation. Embedded and external raster delivery variants merge by raster identity; companion attachment authenticates generic framing, ranges, reciprocal identity, and hashes before package-owned decoding. Streaming limits precede allocation, lifecycle handles are registry-scoped and invalidated on disposal, and a deterministic loader mutation corpus is part of the ordinary fuzz smoke.[^loader]

The `@pmndrs/text/runtime-bake` boundary closes item 3.2. It is dynamically imported only after a missing, invalid, or incompatible baked probe; creates one named module Worker; transfers provenance-preserving owned byte ranges; and runs the exact portable `@pmndrs/text-font-baker` wrapper plus its package-owned optimized Wasm. Offline and Worker hosts share dependency-light V0 descriptor, sole-artifact, successful-promise-cache, and owned-transfer rules while keeping filesystem and fetch behavior separate. The host owns a strict FIFO with one active bake: queued cancellation removes only that job, active cancellation replaces the Worker before resuming queued work, and the Worker entry independently serializes accepted messages. This bounds active CPU/Wasm memory without relying on async message ordering. The host predicate promises only the message fields it proves and consumes instead of overclaiming the complete baker report. A failed core initialization is retryable in both hosts. Canonical Inter fixtures execute the offline host and Worker entry, compare their complete artifacts byte-for-byte with the direct portable core, and then send the Worker result through loader provenance and hostile-input validation. The current independent size lanes report a 3,861-byte minified runtime host, 9,005-byte Worker JavaScript, and one 434,251-byte Wasm artifact; reviewed ceilings prevent heavy validation, Node, discovery, composition, or raster dependencies from entering those runtime graphs.

Milestone 3 closes with browser-executed parity and cancellation. The benchmark product's public loader target first hashes the real module-Worker artifact against the canonical Node artifact, validates and registers it, then runs the complete missing-sibling fallback in Chromium. Shared loads now reference-count consumers: one abort detaches safely, the final abort reaches fetch/stream/Worker work, and an otherwise-idle Worker terminates immediately after the final success, failure, or cancellation and recreates on demand without timers. Stale events from a terminated Worker cannot settle requests owned by its replacement. The explicit queue keeps one active post under concurrent integration tests; two live Chromium evidence runs preserved the canonical hash while a three-font burst completed in 30.8–32.0 ms versus 68.3–88.6 ms for three separately initialized sequential Workers. These observations are recorded without a timing threshold. Shaping-identity deduplication retains source bytes only when their source hash matches the registered primary provenance; alternate URLs remain hash-qualified candidates.

Milestone 4 closes the package-owned HarfRust runtime. The Rust 1.97.1 module uses HarfRust 0.12.0 and matching `read-fonts` 0.41.0 under `no_std + alloc`, exports a Rust-generated JSON-described C ABI, and keeps its allocator private. Its request registry owns zero-initialized, caller-sized buffers capped at 64 MiB and accepts only exact live pointer/length pairs, eliminating reconstructed raw ownership. The TypeScript bridge releases earlier allocations if a later registration copy fails. Canonical Inter contributes 147,192 SFNT bytes, 23,496 dense-extents bytes, and 368 availability bytes, or exactly 171,056 retained bytes. Registration is registry-scoped and idempotent; font/shaper disposal releases owned data and plans.

One `shapeBatch` or `reshapeRanges` call packs validated UTF-16, run, feature, language, and range records through offsets from the generated ABI. It returns aligned borrowed SoA views with absolute UTF-16 clusters, glyph IDs, four positions, and mapped flags. Result layout and arena publication reserve fallibly before writing, so allocation exhaustion returns `RESULT_TOO_LARGE` rather than trapping after shaping. Every pinned Inter case passes bit-for-bit through the complete source → baker GLB → validator → registry extraction → Wasm chain for both calls; multi-run batching, plan reuse/disposal, surrogate boundaries, extents conversion, malformed records, forged release metadata, and deterministic raw-ABI mutation fuzzing are executable. The browser product batches all eight cases into one 97-glyph call with exact output hash `dc30c21c`. The hardened optimized module is 692,682 bytes raw, 257,931 bytes gzip, and 202,462 bytes Brotli; its JavaScript bridge is 30,669 bytes minified, 8,805 bytes gzip, and 7,833 bytes Brotli.

Roadmap item 5.1 adds synchronous paragraph preparation and measurement. Unicode 17 Script/Script_Extensions tables are generated deterministically from the pinned UCD package; `unicode-segmenter` supplies extended grapheme boundaries and `@cto.af/linebreak` supplies line-break opportunities. The ordinary suite executes all 766 official grapheme vectors and all 19,338 official line-break vectors from hash-pinned gzip fixtures. Prepared text is split only at grapheme-safe style/script boundaries, shaped once through the existing GLB-retained HarfRust path, copied immediately out of its borrowed result arena, and measured into legal break clusters with explicit baselines. Equivalent width constraints reuse frozen measurement objects and width-only reflow performs zero Wasm calls.

The canonical integration lane derives its natural width directly from the checked-in HarfRust glyph advances, then compares exact natural, 720 px, and 360 px measurements after source TTF → baker GLB → validator → registry → Wasm shaping. A second paragraph invalidates the shaper's borrowed arena before the first is measured, proving paragraph ownership rather than accidental view lifetime. Chromium repeats the same three measurements with deterministic hash `79874b9d`, one preparation shape, zero reflow calls, and no positioned glyph arrays.

Item 5.2 implements final positioned `ParagraphLayout`. It caches line plans independently from full constraint results, materializes paragraph-owned typed arrays only when requested, scales the exact HarfRust advances/offsets through retained GLB metrics, and emits parallel glyph and line SoA arrays in top-left/positive-down coordinates. Boundary-sensitive line fragments are gathered into one `reshapeRanges` call per changed width with full shaping context and line BOT/EOT flags. The canonical fixture fixes every glyph ID, UTF-16 cluster, flag, line range, baseline, advance, x/y placement, and normalized byte hash for natural, wide, and narrow layouts. The live Chromium aggregate is 3,786 bytes with hashes `bb15bbcc:4f111a3f:e8c0e9d5`, one broad shape, and two reshape calls total. Registry-scoped handles are validated separately and deliberately excluded from the portable hash.

Item 5.3 now has a conformant Unicode 17 bidi foundation. The package-owned shaper reuses `unicode-bidi` 0.3.18's maintained post–Unicode-15 UAX #9 algorithm under `no_std + alloc`, disables its Unicode 16 tables, and supplies generated Unicode 17 `Bidi_Class` and normalized paired-bracket data through the crate's custom data-source seam. The Rust-generated JSON ABI describes one direct-memory UTF-16 analysis call and borrowed SoA levels/classes/paragraph arrays; no browser ICU, WASI, binding generator, or ambient Unicode version participates. Hash-pinned official inputs cover `DerivedBidiClass.txt`, `BidiTest.txt`, and `BidiCharacterTest.txt`. Ordinary integration tests expand the generic corpus to all 770,241 requested paragraph-direction cases and execute all 91,707 character-specific cases, comparing paragraph level, every specified resolved level, and complete visual order. Wasm integration separately proves supplementary-plane code units and explicit/automatic paragraph directions.

Item 5.3 completes paragraph-level bidi and line policy. Preparation resolves overlapping span properties with input-order-preserving active-value sweeps, then intersects style, UAX #24 script, and precomputed UAX #9 runs in one interval pass rather than rescanning every cross-product. It shapes each run in its resolved direction, copies borrowed analysis/shaping data, applies line-specific L1 reset and L2 visual ordering, and batches only unsafe changed boundaries. Boundary validation occurs once while copying/normalizing public input; normalized shaping and layout loops do not repeat generic object checks. A pinned Amiri 1.002 fixture covers joining, combining marks, lam-alef forms, Arabic numbers, and Latin: HarfRust over the source font equals HarfRust over the reduced SFNT extracted from the validated GLB exactly, and pinned HarfBuzz 13 independently agrees on every glyph field.

The generated `paragraph-bidi-layout-v0.json` contract owns complete SoA values for two mixed-direction Amiri layouts plus exact start/center/end/justify, clip, max-lines, and width/height ellipsis policies over Inter. Alignment-only and height-only compatible layouts share cached boundary shaping; every changed boundary is reported as one batched reshape. Ellipsizing a line ending in a mandatory break removes that control cluster before inserting the ellipsis, so the visible range never crosses into the hidden line. Fixed-seed fuzzing mutates Unicode text—including expected malformed UTF-16 rejection—axis modes, widths/heights, wrapping, alignment, truncation, letter spacing, line height, and direction twice, requiring finite, internally consistent, deterministic output.

The current-uikit-shaped fixture lives in the benchmark application rather than core. It derives `CustomLayouting` intrinsics, maps Yoga Undefined/AtMost/Exactly modes, ignores the numeric `NaN` payload of undefined axes, preserves uikit's 1/100-point upward rounding, skips measurement for two definite axes, subtracts padding/border from the authoritative resolved box, and translates content-local positions into centered host coordinates. Twenty repeated measurements materialize no glyph arrays. Text and shaping-policy updates dirty layout; paint and raster updates do not. Chromium 149 fixes the twelve-layout aggregate hash at `8859ef19:8d5b98a3:e492fa7d:19a5a03e:32f8722c:0691e0de:e492fa7d:0132eed7:0ddc10b5:0ddc10b5:00f73fd9:c1a7730c`, with 8,098 output bytes, four broad shapes, and five reshape crossings; the GPU Vitexec lane repeats it with WebGPU active.

Roadmap item 5.4 completes this same bake → retained-SFNT → HarfRust → paragraph path with Noto Sans CJK JP Regular 2.004 at the 65,535-glyph V0 limit. Thirteen Simplified/Traditional Chinese, Japanese, Korean, supplementary-Han, SVS/IVS, punctuation, ideographic-space, and mixed-script cases match source/reduced HarfRust and authenticated HarfBuzz 13 field-for-field. Contextual Script_Extensions avoid assigning shared punctuation arbitrarily; valid language tags survive the Wasm boundary, malformed tags fail explicitly, and natural-width overflow uses the same Float32 geometry as final layout.

Four public-pipeline paragraphs produce twelve exact natural/wide/narrow contracts with grapheme- and UTF-16-safe runs, clusters, and lines, one broad shape per paragraph, and zero reshapes for the fixed corpus. Fixed-seed CJK mutations cover malformed surrogates, variation selectors, language tags, and constraints twice. Node, Chromium 149, and GPU-enabled Vitexec report one composite hash, 10,622 output bytes, 1,539,372 retained bytes, and 4,587,520 Wasm-memory bytes. The item adds no raster paging, rendering, fallback, or vertical layout.

With item 5.4 closed, the public runtime bitmap upload/module in milestone 6.1 is the next gate; it is not an artifact-pipeline shortcut. The [roadmap](../roadmap/roadmap.md) owns the implementation order.

## Package scripts

| Script | Purpose |
| --- | --- |
| `typecheck` | Type-check package source without emission. |
| `test` | Build, run compile-only API/Node-host fixtures, discovery and CLI tests, both Rust/Wasm cores, layered validators, goldens, deterministic project bakes, registrations, and malformed artifacts. |
| `test:types` | Compile positive and negative public-contract fixtures. |
| `test:unit` | Run focused Rust bitmap and HarfRust-shaper unit tests. |
| `test:integration` | Verify pinned Unicode fixture hashes, then run both Rust public boundaries plus Wasm/package, registration, shaping/paragraph goldens, all 861,948 Unicode 17 bidi cases, UAX #14/#29 conformance, and malformed-artifact integration tests. |
| `test:fuzz-smoke` | Run fixed-seed bitmap, loader-artifact, raw shaper-request, Unicode paragraph-policy, and CJK boundary mutations twice and require deterministic, trap-free outcomes. |
| `build` | Emit ESM/declarations, compile the no-WASI bitmap and shaper Wasm modules, optimize them with pinned Binaryen, and publish both generated ABIs. |

The [API contract](../planning/api-shapes.md) remains authoritative for public behavior; this concept explains the package that implements its current loading, baking, shaping, and paragraph surfaces. The [canonical roadmap](../roadmap/roadmap.md) alone owns program-wide completion status.

[^bitmap-identity]: Raster-specific descriptor fields remain owned by this subpath and never enter a closed core union.
[^bitmap-baker]: Artifact generation, validation, and generic composition are complete; GPU resource creation is deliberately deferred to the renderer milestone.
[^node-host]: The Node host trusts selected installed baker code but authenticates every returned artifact; hostile baked assets are independently revalidated at the loader boundary.
[^loader]: Raster-package schema and payload semantics remain in each module's `decode`; the generic registry validates only package-neutral container and reciprocal identity invariants.
