---
type: Workspace Package
title: "@pmndrs/text"
description: Implements public font loading, shaping, paragraph measurement, static discovery, and portable bitmap artifact contracts.
resource: ../../packages/text
workspace_package: "@pmndrs/text"
documentation_type: reference
source_digest: "sha256:e3bd17df30e91e037e9bfef03d820ecab02542feef6851444ad6457745564ace"
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
  by: openai-codex/gpt-5
  at: "2026-07-25T08:38:57Z"
---

# Package reference: `@pmndrs/text`

Status: 🟡 implementation slice; roadmap items 5.1–5.2 complete and item 5.3 active

This package owns the accepted public core and React contract types. Its fixtures prove literal font and raster inference, capability composition, source/baked input rules, paragraph constraints, React prop derivation, lazy raster and `useFont` inference, and invalid combinations at compile time. React and React Three Fiber remain optional peer capabilities and are not reachable from the core entry point.

The browser-safe `@pmndrs/text/raster/bitmap` subpath now owns bitmap generator/format constants, exact runtime validation of the non-empty static strike tuple, ascending canonical strike order, the complete generator-versioned descriptor, RFC 8785 serialization, and SHA-256 raster-key derivation. Equivalent strike sets therefore produce one identity regardless of caller order, while duplicate, non-integral, non-finite, non-positive, or out-of-range values fail before baking. The implementation uses Web Crypto and imports no Node built-ins.[^bitmap-identity]

The optional `@pmndrs/text/bakers/bitmap` subpath wraps a zero-import `no_std + alloc` Wasm generator through its Rust-generated JSON ABI and direct linear-memory shim. Fontations/Skrifa owns font and outline interpretation; a small pen bridge feeds Zeno's maintained antialiased rasterizer. A deterministic shelf packer emits one dense 20-byte record per source glyph plus lossless linear R8 KTX2 pages, either embedded in the companion GLB or emitted as hashed external artifacts. Binaryen 129.0.0 `-Oz` reduces the distributed module to 654,666 bytes raw, 237,352 bytes gzip, and 182,025 bytes Brotli without changing its authoritative output.

The isolated `@pmndrs/text/bakers/bitmap/validate` entry reuses the core package's strict GLB framing and pinned Khronos validator, evaluates byte-identical Draft-04 bitmap/resource schemas, parses every declared page variant with `ktx-parse` 1.1.0, and enforces reciprocal identity, exact strikes, dense records, page bounds, KTX2 dimensions/format/levels, GPU-format/feature/quality mapping, external length/hash, arithmetic limits, and GPU budgets. Rust independently parses every native-test KTX2 through `ktx2` 0.5.0. Canonical Inter source/Wasm/artifact/report/record/page identities, embedded/external parity, 65,535-glyph boundaries, generated/published ABI identity, deterministic arbitrary-font Rust fuzz smoke, and fixed-seed artifact mutation fuzz smoke are executable fixtures.[^bitmap-baker]

The internal generic composer authenticates every returned artifact, checks reciprocal shaping/glyph/raster identity, retains external companions and pages, and embeds package-owned companion data without interpreting its semantics. Integer glTF buffer-view references are rebased through the shared naming convention, so multiple distinct extension types compose without a closed registry. Exact Inter goldens cover combined embedded, combined external, and the identity-neutral empty raster set; both the core and bitmap validators round-trip the combined bytes.

The Node-only `@pmndrs/text/bake` subpath closes roadmap item 2.4 around the item-2.1 TypeScript 7 AST/symbol discovery engine. `bakeFont` handles an explicit filesystem input/output pair and retains each selected raster package's exact option type. `bakeProject` finds composed tokens and statically visible core/React raw forms across TypeScript, TSX, JavaScript, and JSX; reduces immutable font/raster expressions; maps URL pathnames into canonical asset roots; groups identical sources; and dynamically imports only the exact verified raster-package ESM entry. It never executes application modules. One internal compiler adapter owns every unstable TypeScript import, project snapshot, symbol handle, alias, and declaration-resolution operation; an exact-version assertion and source-boundary test make compiler upgrades explicit.

The native-ESM `pmndrs-text-bake` command is a thin `bakeProject` adapter. The host writes exclusive same-directory temporary files and atomically renames them only after every artifact is ready, rejects input/output overlap and unsafe package-owned filenames, and cleans temporary files on cancellation. Its report adds phase/total timing, before/after RSS, explicitly process-lifetime peak RSS, output paths and hashes, and raw/gzip/Brotli transport sizes to the authoritative core/raster/container byte report. Exact Inter goldens plus repeated mixed-raster project runs bind deterministic output. The core validator also has a Node `Buffer` purity regression so validation cannot mutate the SFNT checksum field through aliasing slice semantics.[^node-host]

The public `FontLoader` and `FontRegistry` close item 3.1. They normalize every accepted input form into deterministic source/baked URLs, deduplicate request promises and validated shaping identities, and run the same hostile-input validator before registration. The large pinned Khronos/Ajv validation graph is cached behind a separate dynamic import: package import stays small, while the first actual registration still validates before publishing anything. Registration owns the bytes and retains the extracted reduced SFNT, glyph extents/availability, metrics, Unicode/source provenance, source candidates, and opaque raster directory required by later stages. Exact Inter fixtures compare those retained shaping views byte-for-byte with independent GLB validation. Embedded and external raster delivery variants merge by raster identity; companion attachment authenticates generic framing, ranges, reciprocal identity, and hashes before package-owned decoding. Streaming limits precede allocation, lifecycle handles are registry-scoped and invalidated on disposal, and a deterministic loader mutation corpus is part of the ordinary fuzz smoke.[^loader]

The `@pmndrs/text/runtime-bake` boundary closes item 3.2. It is dynamically imported only after a missing, invalid, or incompatible baked probe; creates one named module Worker; transfers a provenance-preserving source copy and the authoritative result buffer; and runs the exact portable `@pmndrs/text-font-baker` wrapper plus optimized Wasm in that Worker. Canonical Inter fixtures execute both the public host and Worker entry, compare the Worker artifact byte-for-byte with the direct portable core, and then send the result through loader provenance and hostile-input validation. Independent package-size lanes keep the 3,371-byte minified host, 5,576-byte minified Worker JavaScript, and 430,662-byte Wasm distinct from the 22,355-byte initial browser graph.

Milestone 3 closes with browser-executed parity and cancellation. The benchmark product's public loader target first hashes the real module-Worker artifact against the canonical Node artifact, validates and registers it, then runs the complete missing-sibling fallback in Chromium. Shared loads now reference-count consumers: one abort detaches safely, the final abort reaches fetch/stream/Worker work, and an otherwise-idle Worker terminates immediately and recreates on demand without timers. This browser gate exposed and fixed native `fetch` receiver loss that Node's implementation tolerated. Static emitted-package checks and independent Rollup closures keep the runtime host, Worker, Wasm, validator, Node host, and raster bakers out of a baked-hit graph.

Milestone 4 closes the package-owned HarfRust runtime. The Rust 1.97.1 module uses HarfRust 0.12.0 and matching `read-fonts` 0.41.0 under `no_std + alloc`, exports a Rust-generated JSON-described C ABI, and keeps its allocator private. The TypeScript bridge copies only the exact validator-retained GLB views into linear memory: canonical Inter contributes 147,192 SFNT bytes, 23,496 dense-extents bytes, and 368 availability bytes, or exactly 171,056 retained bytes. Registration is registry-scoped and idempotent; font/shaper disposal releases owned data and plans. Cached shape plans distinguish direction, script, normalized language, and HarfRust-equivalent feature properties while reusing equivalent calls.

One `shapeBatch` or `reshapeRanges` call packs validated UTF-16, run, feature, language, and range records through offsets from the generated ABI. It returns aligned borrowed SoA views with absolute UTF-16 clusters, glyph IDs, four positions, and mapped flags. Every pinned Inter case passes bit-for-bit through the complete source → baker GLB → validator → registry extraction → Wasm chain for both calls; multi-run batching, plan reuse/disposal, surrogate boundaries, extents conversion, malformed records, and deterministic raw-ABI mutation fuzzing are executable. The browser product batches all eight cases into one 97-glyph call with exact output hash `dc30c21c`. The complete optimized module is 645,666 bytes raw, 239,303 bytes gzip, and 188,862 bytes Brotli; its JavaScript bridge is 27,859 bytes minified, 8,190 bytes gzip, and 7,320 bytes Brotli.

Roadmap item 5.1 adds synchronous paragraph preparation and measurement. Unicode 17 Script/Script_Extensions tables are generated deterministically from the pinned UCD package; `unicode-segmenter` supplies extended grapheme boundaries and `@cto.af/linebreak` supplies line-break opportunities. The ordinary suite executes all 766 official grapheme vectors and all 19,338 official line-break vectors from hash-pinned gzip fixtures. Prepared text is split only at grapheme-safe style/script boundaries, shaped once through the existing GLB-retained HarfRust path, copied immediately out of its borrowed result arena, and measured into legal break clusters with explicit baselines. Equivalent width constraints reuse frozen measurement objects and width-only reflow performs zero Wasm calls.

The canonical integration lane derives its natural width directly from the checked-in HarfRust glyph advances, then compares exact natural, 720 px, and 360 px measurements after source TTF → baker GLB → validator → registry → Wasm shaping. A second paragraph invalidates the shaper's borrowed arena before the first is measured, proving paragraph ownership rather than accidental view lifetime. Chromium repeats the same three measurements with deterministic hash `79874b9d`, one preparation shape, zero reflow calls, and no positioned glyph arrays.

Item 5.2 implements final positioned `ParagraphLayout`. It caches line plans independently from full constraint results, materializes paragraph-owned typed arrays only when requested, scales the exact HarfRust advances/offsets through retained GLB metrics, and emits parallel glyph and line SoA arrays in top-left/positive-down coordinates. Boundary-sensitive line fragments are gathered into one `reshapeRanges` call per changed width with full shaping context and line BOT/EOT flags. The canonical fixture fixes every glyph ID, UTF-16 cluster, flag, line range, baseline, advance, x/y placement, and normalized byte hash for natural, wide, and narrow layouts. The live Chromium aggregate is 3,786 bytes with hashes `bb15bbcc:4f111a3f:e8c0e9d5`, one broad shape, and two reshape calls total. Registry-scoped handles are validated separately and deliberately excluded from the portable hash.

Alignment, bidi, clipping, max-lines, and ellipsis remain item 5.3 rather than silently behaving as implemented options.

The public runtime bitmap upload/module belongs to milestone 6.1 after layout dependencies; it is not an artifact-pipeline shortcut. The [roadmap](../roadmap/roadmap.md) owns the implementation order.

## Package scripts

| Script | Purpose |
| --- | --- |
| `typecheck` | Type-check package source without emission. |
| `test` | Build, run compile-only API/Node-host fixtures, discovery and CLI tests, both Rust/Wasm cores, layered validators, goldens, deterministic project bakes, registrations, and malformed artifacts. |
| `test:types` | Compile positive and negative public-contract fixtures. |
| `test:unit` | Run focused Rust bitmap and HarfRust-shaper unit tests. |
| `test:integration` | Verify pinned Unicode fixture hashes, then run both Rust public boundaries plus Wasm/package, registration, shaping/paragraph goldens, Unicode conformance, and malformed-artifact integration tests. |
| `test:fuzz-smoke` | Run fixed-seed bitmap, loader-artifact, and raw shaper-request mutations twice and require deterministic, trap-free outcomes. |
| `build` | Emit ESM/declarations, compile the no-WASI bitmap and shaper Wasm modules, optimize them with pinned Binaryen, and publish both generated ABIs. |

The [API contract](../planning/api-shapes.md) remains authoritative for proposed public behavior; this concept explains the package that currently embodies its compile-time subset.[^api-contract]

[^api-contract]: The implementation must not be inferred to exist merely because its types compile.
[^bitmap-identity]: Raster-specific descriptor fields remain owned by this subpath and never enter a closed core union.
[^bitmap-baker]: Artifact generation, validation, and generic composition are complete; GPU resource creation is deliberately deferred to the renderer milestone.
[^node-host]: The Node host trusts selected installed baker code but authenticates every returned artifact; hostile baked assets are independently revalidated at the loader boundary.
[^loader]: Raster-package schema and payload semantics remain in each module's `decode`; the generic registry validates only package-neutral container and reciprocal identity invariants.
