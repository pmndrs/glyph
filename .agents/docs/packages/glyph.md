---
type: Workspace Package
title: '@pmndrs/glyph'
description: Implements portable font loading, retained Rust shaping and layout, Codec-driven command buffers, and maintained Three.js and React Three Fiber adapters.
resource: ../../../packages/glyph
workspace_package: '@pmndrs/glyph'
documentation_type: reference
tags: [package, public-api, rust, wasm, threejs, typography]
sources:
  - id: query-first-ci
    resource: https://github.com/pmndrs/glyph/actions/runs/38093741115
    title: Exact-head query-first CI, package and glyph Labs artifacts
  - id: release-comparison
    resource: https://github.com/pmndrs/glyph/issues/253#issuecomment-6101717975
    title: Supplemental published 0.1.0 versus pre-query main comparison
  - id: manifest
    resource: ../../../packages/glyph/package.json
    title: Package manifest
  - id: changelog
    resource: ../../../packages/glyph/CHANGELOG.md
    title: User-facing release record
  - id: migration-0-2
    resource: ../../../packages/glyph/MIGRATION-0.2.md
    title: Glyph 0.1 to 0.2 migration guide
  - id: release-workflow
    resource: ../../../.github/workflows/release.yml
    title: npm stable and canary release workflow
  - id: public-api
    resource: ../../../packages/glyph/src/index.ts
    title: Renderer-neutral public exports
  - id: glyph-runtime
    resource: ../../../packages/glyph/src/glyph.ts
    title: Root Glyph runtime and named handle registry
  - id: font-face
    resource: ../../../packages/glyph/src/font-face.ts
    title: Renderer-neutral FontFace declarations and loading
  - id: glyph-config
    resource: ../../../packages/glyph/src/config/glyph.ts
    title: Reusable GlyphConfig publication contracts
  - id: glyph-engine
    resource: ../../../packages/glyph/src/glyph-engine.ts
    title: GlyphEngine and font-registration ownership
  - id: node-cli
    resource: ../../../packages/glyph/src/node/cli.ts
    title: Project-discovery and direct font-bake CLI
  - id: discovery-sources
    resource: ../../../packages/glyph/src/discovery-source.ts
    title: Compiler-free static source graph
  - id: font-baker
    resource: ../../../packages/glyph/rust/font-baker
    title: Optional portable font-baker Wasm
  - id: bake-api
    resource: ../../../packages/glyph/src/node/bake.ts
    title: Programmatic bake subpath
  - id: text-properties
    resource: ../../../packages/glyph/src/text-properties.ts
    title: Paragraph input contract
  - id: layout-query
    resource: ../../../packages/glyph/src/layout.ts
    title: Explicit layout-query values
  - id: rust-engine
    resource: ../../../packages/glyph/rust/shaper/src/engine/state.rs
    title: Retained Rust text engine
  - id: handle-state
    resource: ../../../packages/glyph/src/internal/handle-state.ts
    title: Internal Glyph handle state and Wasm command transport
  - id: native-ktx-reader
    resource: ../../../packages/glyph/src/internal/raster-ktx.ts
    title: Bounded native KTX2 reader and validation policy
  - id: native-ktx-writer
    resource: ../../../packages/glyph/rust/raster-artifact/src/ktx.rs
    title: Package-owned native KTX2 writer
  - id: native-ktx-tests
    resource: ../../../packages/glyph/tests/package/raster-ktx.test.mjs
    title: Native KTX2 reader oracle and corruption tests
  - id: native-ktx-performance
    resource: ../../../packages/glyph/scripts/benchmark-ktx-runtime.mts
    title: Native KTX2 reader CPU and allocation comparison
  - id: tsl-shaders
    resource: ../../../packages/glyph/src/shaders/tsl/index.ts
    title: Raster-format shader library layer
  - id: msdf-distance
    resource: ../../../packages/glyph/src/shaders/typegpu/msdf/distance.ts
    title: Shared TypeGPU signed-distance reconstruction
  - id: slug-shader-core
    resource: ../../../packages/glyph/src/shaders/typegpu/slug/core
    title: Host-agnostic TypeGPU Slug shader core
  - id: slug-shader-host
    resource: ../../../packages/glyph/src/three/typegpu/internal/slug-shader.ts
    title: TypeGPU-to-TSL Slug shader host
  - id: three-api
    resource: ../../../packages/glyph/src/three.ts
    title: Three.js public exports
  - id: three-text
    resource: ../../../packages/glyph/src/three/text.ts
    title: Three.js retained text lifecycle
  - id: three-plan
    resource: ../../../packages/glyph/src/three/command-buffer-renderer.ts
    title: Three.js command-buffer executor
  - id: three-config
    resource: ../../../packages/glyph/src/three/schema.ts
    title: Three bindings, schema, and config types
  - id: configured-plan-target
    resource: ../../../packages/glyph/src/internal/glyph-plan-target.ts
    title: Internal configured publication target
  - id: three-transform-sync
    resource: ../../../packages/glyph/src/three/transform-synchronizer.ts
    title: Engine-free Three transform synchronization
  - id: three-glyphs
    resource: ../../../packages/glyph/src/three/glyphs.ts
    title: Three.js detached Glyphs object
  - id: three-decorations
    resource: ../../../packages/glyph/src/three/decorations.ts
    title: Three.js detached Decorations object
  - id: three-raster-program
    resource: ../../../packages/glyph/src/three/raster-program.ts
    title: Three.js raster-program registry
  - id: react
    resource: ../../../packages/glyph/src/react.ts
    title: React Three Fiber adapter
  - id: vue
    resource: ../../../packages/glyph/src/vue.ts
    title: TresJS Vue adapter
  - id: core-api-reference
    resource: ../planning/core-api.md
    title: Glyph integration API reference
  - id: three-api-reference
    resource: ../planning/three-api.md
    title: Three.js text API reference
  - id: detached-glyph-slice
    resource: ../planning/detached-glyph-slice.md
    title: Planner-assisted detached glyph slice
  - id: mtsdf-quality-inspection
    resource: ../../../packages/glyph/scripts/inspect-mtsdf-quality.mjs
    title: Reproducible MTSDF coverage and native variant inspection
  - id: mtsdf-reference-shape
    resource: ../../../packages/glyph/rust/mtsdf-admission/src/quality.rs
    title: Outline serialization and independent reconstruction reference
  - id: msdfgen-cli
    resource: https://github.com/Chlumsky/msdfgen/blob/v1.13/main.cpp
    title: Pinned msdfgen CLI scanline and error-correction configuration
  - id: glyph-static-check
    resource: ../../../packages/glyph/scripts/check-static.mts
    title: Shared built-package static verification workflow
generated:
  by: openai-codex/gpt-6
  at: '2026-10-15T04:31:23Z'
---

# Package reference: `@pmndrs/glyph`

## Active held refactor: preparation before publication

The accepted [preparation/publication decision](../planning/decisions/retained-prepare-publish.md) is the contract for
current ropes work. Setter preparation, prepared queries/copies, and renderer publication share one Rust layout
pipeline. Publication consumes dirty ranges; it does not repeat layout. Old speculative/rollback descriptions below
are historical evidence superseded by that decision. Main query-first behavior remains the correctness control;
combined performance, size, failure-boundary, and visual gates are open in the [tracker](../planning/publication-frontier.md).

Prepared inspection retains intrinsic flow and, when clipping requires it, positioned glyphs in the existing stage
owner. Reads and explicit semantic publication reuse these results until semantic or geometry stages change. Split
uses the same owned source layout that selected its glyph identities, then reconciles origins against its independently
realized renderer records. Renderer-only publication keeps text/style/geometry mutation sections empty.

Publication request construction keeps its pending-owner snapshot and emits removals before lifecycle upserts.
One pending pass independently emits order mutations; an owner may require order work without a lifecycle change.
Nonempty mutation arrays belong to that invocation. Empty mutation outputs and the six unused semantic sections
reuse the existing frozen request list. The transport borrows these readonly lists only during its synchronous
prepare/write call and retains neither the frame nor its descriptors. This removes intermediate map/filter/spread
arrays and fresh empty lists without pooling mutable arrays or changing publication revisions and retry ownership.

Text preflight and paragraph preparation now share one candidate text, changed-range discovery and Unicode result.
Complete caller validation precedes adoption into the existing paragraph stages; queries and renderer publication
reuse the prepared revision. Request-local metadata routes existing inactive buffers, a matching reserved implicit
paragraph, or owned fallback storage when pending state must remain intact. The fallback is consumed within the call,
not retained as another text cache. The explicit reservation contract and cumulative size/performance gates remain
under validation in the tracker.
Sparse shaping uses one window discovery and execution pipeline for equal-length replacements. Length-changing edits
and unsafe boundaries use the same pipeline's complete run scope. An empty insertion or deletion endpoint may select a nonempty drawable run; unchanged old/new run identity, offset correspondence and resolved shaping dependencies must still agree. This keeps hard-break edits within the affected run without cutting an unproved concat seam. The 4,000-glyph midpoint insertion/removal fixture verifies one 351/350-unit shaping call and cold shape, flow and positioning parity. Frozen346→1e edit comparisons improve Inter edit+measure3.74→2.58ms and edit+publish4.91→3.80ms; the shaper adds234 gzip bytes. These bounded results do not clear cumulative size, final main/release comparisons or visual gates. The local insertion/deletion prototype was retired
after broader Amiri ligature-rejoining coverage exposed incomplete shaping; its narrow bounded-work result did not
establish correctness or elapsed benefit. The complete sole-run storage-transfer experiment is also retired after its common edit suite showed no classified
speedups and two slower paint-span workloads. The existing range-composition executor remains authoritative; frozen
experiments, unresolved publication work, and cumulative size/performance gates are recorded in the tracker.

Ordered and compositing-independent publication now share one draw-span reducer and emitter. Exact changed glyph
intervals authorize clean committed summaries; independent traversal maps those intervals to physical batch slots
using existing scratch, while ordered traversal uses logical intervals. Current draw heads, storage, resources and
order remain authoritative. Dense or structural work uses the same reducer. Both former mode-specific loops are
retired. The native 1,000-owner discriminator reduces10 changed glyph summaries in both modes, preserving cold-host
output. Native457 and Node1,042 tests pass. Frozen8c15 package changes only the shaper versus1e (+576raw/+337gzip bytes);
the single paired edit-sized run has0faster/2slower/53neutral, including32.376→34.123ms for1,000-label repeated edit/read/publication. This addition remains an unaccepted diagnostic draft; batching-scope attribution and cumulative size/readiness remain open in the tracker.

Each retained Text also owns its style-identity slots. The existing style compiler mints a canonical ID only when
that slot first appears, then reuses it for updates, removal and replay. Slots survive shrink/regrow and failed
candidates, share the owner's preparation state, and clear on disposal. No public identity helper or alternate
style compiler is introduced. Focused coverage checks wire identities and mint counts independently of layout
measurement parity; elapsed-time and final delivery-size evidence remain required.

Formatted input validates each authored span against the incoming text and normalizes its style before reusing an
unchanged owned slot. This single pass lazily creates a replacement array, allocates only changed span objects, and
reuses unchanged slots across text-value changes; it replaces the checked-array/second-pass helper.

Placement and gather preparation share the dirty-owner renderer order, but authorize retained ranges separately.
Gather needs unchanged source counts and compatible decoration records. Placement needs each changed owner's
placement-segment count to match its retained occurrence range; changed glyph counts alone do not require a full-root
placement walk. A changed placement topology still uses the existing complete reconciliation and refreshes ranges.
Retained gather also refreshes current cluster ordinals independently of stable Codec cluster identities. An ordinal
change invalidates derived primitive metadata even when the Codec columns and ink bounds remain unchanged; zero-mask
and position-only updates use the same gather and metadata-dirt mechanism.
Count-changing dirty owners now share one appended gather envelope. Dirty rows use the existing Codec-directed writer;
intervening clean rows extend the already-gathered columns and share source-rope ranges. One frozen old/current
correspondence ledger separates source and emitted coordinates and identifies dirty owners versus clean gaps.
The existing splice kernel applies the envelope's net delta once; owner offsets reconcile once in renderer order.
Selection changes at unchanged source count use this transaction after a retained-stream stop, including every earlier
frontier owner so its dirt is preserved. The one-owner executor and repeated per-owner suffix updates are retired;
single-owner/tail cases use the shared transaction. The ordered planner still needs correspondence to retain clean
admission and copy moved physical rows without Codec execution; gather-only work does not complete dirty publication.
Cold output/work-count proof passes; elapsed and cumulative source/binary-size gates remain open in the tracker.

Ordinary and four-wide aligned output lanes share one splice helper. When replacement rows fit the removed range,
it copies the replacement before closing the gap; growth keeps the overlap-safe rotation. This avoids a second suffix
move for shrinking replacements without allocating scratch storage. Native composition coverage passes; elapsed
validation remains open in the frontier tracker.

Status: foundation merged; stable and canary publishing configured while publishing-feature stacks continue

The release workflow publishes main-branch pushes under npm's `canary` tag. A pushed `vMAJOR.MINOR.PATCH` Git tag
publishes under `latest` only when it matches the package manifest version exactly. Both paths build and check the
package before publishing through the existing npm trusted publisher. Prepare each release's version separately,
then cut its stable tag from the reviewed commit after CI passes.
`packages/glyph/CHANGELOG.md` is the hand-authored user-facing release record; its Unreleased section declares the next
semver target and excludes CI or commit-history narration. The package-owned
[`MIGRATION-0.2.md`](../../../packages/glyph/MIGRATION-0.2.md) is the task-oriented path from 0.1 to 0.2; it links the
archived rename commands and keeps deferred API work out of shipped claims.

The `glyph:shaper-profile-artifact` diagnostic workflow builds with the same release shaper settings and Binaryen pass list, retaining function names in an isolated Cargo target. It requires a frozen package archive and refuses any difference in the ordered non-custom Wasm sections. Optional `--source-root <worktree>` selects the source checkout independently of the diagnostic tooling checkout, so main-based artifacts can be profiled without incorporating draft runtime changes. Its output must remain outside both checkouts' `dist` directories. The final diagnostic artifact consists of the original release sections plus the optimized candidate's name section; it never replaces `dist`. Its manifest records archive, release, diagnostic and executable-section hashes, tool versions, source root/revision/dirty state and final function-index names. Names identify optimized functions; merged and inlined work may not map to a single Rust source function.

The `glyph:shaper-optimizer-ablation` workflow is a frozen local experiment reproducer for authenticated checkpoint `60d3c26f` and its stored compiler input. It refuses other control archives, tool versions or flags, requires control Wasm byte equality and permits exactly one treatment archive member delta. It writes only ignored package cache artifacts, including matching named Wasm and provenance. The approved four-block experiment was rejected; production optimization is unchanged. See the [local ablation receipt](../../../benches/reports/held-ropes-local-2026-10-16/optimizer-ablation.json).

Style-boundary preflight carries the final text length already validated over its immutable committed text and mutation batch; each boundary check no longer replays mutation range/length validation. Interior boundaries still resolve mutation correspondence and classify the actual UTF-16 pair. Authored and effective style coordinates each retain numeric range checks; an effective coordinate reuses its authored counterpart’s boundary result only when equal. Distinct coordinates, features, fonts, root-style requirements and error faults retain their checks. This is private scalar evidence reuse, with no retained cache, Unicode parser, API/ABI or preparation/publication lifetime change.

Paragraph preparation creates a borrowed `PlanPublication` only when its caller supplies a synchronous semantic consumer. Ordinary setters requesting no semantic view still execute Rust preparation, validate result status/extent and adopt capacities, but retain no publication bytes or lease. Demanded summaries use the full decoder synchronously; its bytes expire at the next Wasm call and the summary reader copies owned values. Actual renderer publication and independent copies keep the same full decoder and epoch lifetime checks. The transport owns this distinction through one shared extent/capacity step; the planner controls demand from its existing measurement state.

`glyph:shaper-combination-artifacts` owns the diagnostic composition of the preserved preparation/optimizer experiments. It accepts three explicitly pinned package archives and pinned compiler provenance, verifies their full member differences, and derives cleanup-only and combined archives by replacing only the packed Wasm. Both JavaScript states share exact Wasm bytes within each compiler-policy column. It authenticates the archived named executable, reports compression methods separately and writes only ignored outputs; derived experimental archives are not production builds. It changes no runtime compiler policy, semantic executor or public call contract. The [combination receipt](../../../benches/reports/held-ropes-local-2026-10-16/preparation-compiler-combination.json) records correctness, clock-confounded timing and named preservation for future combinations.

Sparse retained gather now feeds the existing sorted dirty-owner frontier and owner-local unpublished source intervals into one ordered rope traversal. Ranges that intersect the same leaf are handled before that leaf is reconstructed, so owner boundaries no longer repeat leaf and ancestor copies. The one-owner entry point adapts to the same stream and glyph callback. Borrowed semantic column views carry no copied text/glyph data; authoritative gather ranges retain the distinction between source glyphs and emitted rows, including clean decorated owners. Topology stops identify the owner and local source offset before the existing suffix builder resumes. Source-tree errors preserve the previous root, and the existing cache-invalid publication failure path rebuilds the mutated column workspace.

The ordered compiler submits sparse coalesced dirty physical slots in one ordered rope traversal. Instance updates and per-batch patch ranges share one borrowed coalescer; the former per-range root walks are retired. Complete physical admission, state derivation, comparison and replacement now share the existing ordered updater. Changed leaves allocate once at their first replacement and copy only untouched old rows; all-Keep leaves preserve sharing. A local candidate root and existing pending dirty scratch keep accepted state intact, and the caller resets pending scratch before a retained-admission miss falls back. After successful nonempty complete traversal proves every row changed, exact leaf partitions and midpoint tree shape determine whether already-computed records need repacking through the existing exact builder. This preserves dense compaction in the same 32-record layout; fragmented roots can add O(K) node inspection and an extra candidate root at peak. Sparse, mixed and all-Keep paths do not acquire that complete shape inspection. Cached validated program counts supply full input masks; partial masks retain dependency selection. No parallel record store, semantic executor, persistent cache or API/ABI change is introduced. The frontier records exact cold-output, failure and performance gates; implementation alone does not establish parity.

The integrated stream passes 399 native unit tests and independent outline/Unicode controls, including cold output, sparse dirty islands, clean decorated gaps, recordless owners, growth/shrink Stop and failure recovery. Its first rebuilt package passes all 990 package/integration Node tests. Final formatter and Clippy cleanup passes the shared static gate and repeated native suite. These checks prove correctness at those boundaries; final artifact size, fuzz, browser and comparative performance remain separate gates for the draft frontier.

## Ownership

The package owns six runtime layers:

| Layer                    | Owner                                                                                        | Responsibility                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Root runtime and config  | TypeScript core                                                                              | Initialize one Glyph engine, construct named adapter handles, and coordinate projection/decode/commit transactions.                   |
| Font and raster loading  | TypeScript core                                                                              | Read portable GLB envelopes, register shaping payloads, decode selected raster resources, and retain font identity.                   |
| Shaping and layout       | Rust/Wasm                                                                                    | Unicode analysis, bidi, font fallback, shaping, line composition, positioning, ellipsis, and semantic query state.                    |
| Codec and command buffer | Rust/Wasm                                                                                    | Interpret a validated Codec, pack canonical raster-format records, coalesce dirty ranges, and emit a compact command buffer.          |
| Three.js integration     | `@pmndrs/glyph/three`                                                                        | Compile Codec programs, resolve font/material resources, apply command-buffer deltas, upload dirty ranges, and maintain draw proxies. |
| TypeGPU Three experiment | `@pmndrs/glyph/three/typegpu`                                                                | Experimental Three config and shader adapters backed by `/shaders/typegpu`; shares scene and lifecycle classes with `/three`.         |
| `@pmndrs/glyph/react`    | Reconcile React values into the same imperative `Text` and `TextGroup` objects.              |
| `@pmndrs/glyph/vue`      | Reconcile Vue values into the same imperative `Text` and `TextGroup` objects through TresJS. |

Runtime Rust and all shared Rust code remain `no_std + alloc` compatible with the package allocator contract. The optional
font-baker Wasm alone enables a feature-gated `std` adapter for Fontations subsetting; the same crate continues to
pass its `wasm32-unknown-unknown --no-default-features` build. The text engine uses the existing compile-time direct-memory mapping
for font registrations. Ordinary publication enters once through
`pmndrs_glyph_engine_update_batch(entriesPointer, count)`, whose entries address the already-written request slice and
one borrowed result arena for each dirty root. Paragraph-scoped semantic queries remain separate synchronous calls.
TypeScript does not independently shape, lay out, or pack paragraphs.

The root `glyph` runtime initializes one engine idempotently. `glyph.handle(name, config)` creates independent mutable
adapter state; live names are unique and become reusable after disposal. Every handle owns one anonymous root and fronts
that root's API directly. Calling `handle(name)` selects one idempotent live terminal sibling root, so roots cannot nest and
Text/TextGroup objects cannot be rootless. `glyph.shape()` stages every dirty root across all live handles and submits them
in one engine batch; unchanged roots do not cross into Wasm, and renderer-specific transform synchronization remains a
separate cheap path.

`GlyphConfig` contains `schema`, optional `fonts`, `encode`, `resolve`, `renderer`, `root`, and optional `commands`.
`encode()` selects the Codec that defines packed command-buffer data. The engine owns those internal bytes and projects
trusted data through the schema and resolver into a borrowed `CommandBufferView`; its nested `DisplayList` preserves
authoritative batch/root-instance order. `GlyphRenderer.decode(view)` stages retained host objects and returns the
transactional result/commit/discard boundary. The host renderer later traverses or submits committed objects. There is no
configurable intermediate decoder and ordinary renderer code receives no numeric IDs.

The producer boundary is the proof boundary. Application and integration inputs are validated where they enter the public
GlyphConfig services; package-owned retained state is then trusted. Rust validates raw ABI requests where memory safety
requires it and emits the canonical publication layout. JavaScript reads that package-owned publication directly rather
than rescanning every table, scalar, and registration on every frame. Private paragraph transport calls receive IDs minted by the retained planner; they retain active-root, borrow, range and Rust ownership checks without repeating the global identity-registry lookup. Caller-authored Codec and stable-glyph IDs still validate at their public boundary.
Rust encoder and transport tests pin every emitted table span and payload rebase, while multi-handle product tests prove
root, Codec, and font ownership across a shared engine batch. A failed owned invariant is a package defect covered by those
tests, not an application-facing recovery path repeated in the hot runtime.

Portable fonts are schema-validated when Glyph bakes them. The rendering loader does not ship AJV or the Khronos glTF
validator: it checks the GLB envelope, the reserved `PMNDRS_font` extension and compatible version identity, then proves
only the buffer-view ranges needed to create safe typed-array views. Generated TypeScript types preserve the checked-in
extension schema at that trust boundary. A malformed payload throws when its required data is read or decoded; runtime
does not repeat bake-time schema, SFNT, checksum, or whole-document semantic validation. Runtime OTF/TTF baking follows
the same rule for GLBs returned by Glyph's own bakers; the Node `/bake` entry explicitly retains full validation before
raster work and after composition. The size graph rejects the validator, AJV, and Khronos implementation from the
runtime Worker's initial bundle.

`defineGlyphConfig()` preserves the schema, font vocabulary, renderer result, boundary, root, and Codec as one inferred
relationship. `GlyphConfigFor<typeof Schema, Root, Result>` gives isolated declaration boundaries a nameable contract
without repeating the schema's binding tuple or boundary type. Internal handle machinery owns Codec installation, planning, projection, resource
settlement, and disposal; third-party integrations receive only constrained root services. Every FontFace and handle reaches
the same process-local, lease-counted font resource graph. Low-level loading and acquisition are internal services rather
than a second application or integrator API. A consumer loads a FontFace selection; Text then owns the
independent immutable Font lease needed by its engine binding. Portable compiled resources remain immutable payload data,
while each renderer owns physical textures, buffers, geometry, and their device-relative leases.

The `/core` entry contains only renderer-neutral integration authoring operations, including construction of placement
snapshots from package-produced inspection data and renderer-owned drawn origins. Package registries and identity maps, compiled
Codec-body authentication, system-lane normalization, and Glyph's reserved built-in raster registration path stay under
`src/internal`; they are neither root exports nor wildcard subpath APIs. Integrators can register their own portable raster
Codecs through `registerRasterCodec()` and can normalize a renderer-owned capability set explicitly when composing
config helpers.

## Public package surfaces

Browser ESM delivery uses the private `content-digest` module filename to avoid URL filters matching `fingerprint`. Public fingerprint names, hash vectors, cache headers and artifact identities remain unchanged. The installed-package browser consumer rejects matching requests and proves both Worker baking and font loading, with an explicit blocking negative control. This models a filename filter; it does not claim coverage of every browser extension.

| Subpath                         | Purpose                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@pmndrs/glyph`                 | Root runtime, built-in format selection, font/raster types, fallback stacks, text authoring, and layout results. |
| `@pmndrs/glyph/core`            | Renderer-neutral construction helpers, placement snapshots, built-in schemas/codecs, and format interpretation.  |
| `@pmndrs/glyph/three`           | Three configuration, retained text objects, materials, and renderer registration using native TSL shaders.       |
| `@pmndrs/glyph/react`           | React provider, text components, and font-loading hooks.                                                         |
| `@pmndrs/glyph/vue`             | Vue provider, text components, and reactive font-loading composables for TresJS.                                 |
| `@pmndrs/glyph/vue/*`           | Typed Bitmap, MSDF, and Slug Vue composables.                                                                    |
| `@pmndrs/glyph/typegpu`         | Direct TypeGPU configuration, retained text, and drawing into caller-owned passes.                               |
| `@pmndrs/glyph/three/typegpu`   | Experimental Three integration using TypeGPU-backed shader adapters.                                             |
| `@pmndrs/glyph/shaders/tsl`     | Standalone native TSL raster shaders.                                                                            |
| `@pmndrs/glyph/shaders/typegpu` | Standalone TypeGPU stages, schemas, slots, accessors, and composition helpers.                                   |
| `@pmndrs/glyph/bake`            | Node file/project baking, inspection, and freshness operations used by the CLI.                                  |
| `@pmndrs/glyph/baker`           | Portable raster-baker definition and bake-plan construction.                                                     |
| `@pmndrs/glyph/runtime-bake`    | Explicit browser Worker host for runtime font baking.                                                            |
| `@pmndrs/glyph/bakers/bitmap`   | Portable Bitmap baker and Wasm construction.                                                                     |
| `@pmndrs/glyph/bakers/msdf`     | Portable MSDF baker and Wasm construction.                                                                       |
| `@pmndrs/glyph/bakers/slug`     | Portable Slug baker and Wasm construction.                                                                       |

The three renderer-neutral raster implementations retain portable Codec-registration side effects when selected from the root. Built-in
Three configs select a private typed shader set carried by each handle's renderer resources, with no module-global switch. `/three` and `/shaders/tsl` preserve the native TSL implementation from `main`; `/three/typegpu` selects the migrated adapters over `/shaders/typegpu`. Both handle variants can coexist. Applications import portable formats from the root and shader builders from the shared backend entry, `/shaders/tsl` or `/shaders/typegpu`.
Every TypeScript subpath also publishes a custom `source` condition. Workspace Vite applications opt into that condition
for direct TS/TSX hot reload, while ordinary Node and package consumers continue to resolve built declarations and ESM.
Wasm and `package.json` exports remain distribution artifacts because they have no TypeScript source equivalent.

The font-baker Rust source, direct-memory wrapper, schemas, tests, build pipeline, optimized Wasm, and generated ABI are
owned by this package. There is no separately published font-baker package. The root entry has no static edge to the
baker, its `std`-enabled dependencies, Ajv, glTF Validator, or the baker Wasm; only explicit bake/runtime-bake surfaces can
load those bytes.

The TypeScript paragraph engine, paragraph batches/attachments, direct shaping exports, and the text-preparation Worker
are removed. The `/typegpu` adapter uses the Codec command buffer and public GlyphConfig services. The separate
`@pmndrs/glyph/shaders/typegpu` publishes the experimental raster-format realizations as typed functions for any WebGPU host; `typegpu` is an optional peer and the root entry
has no static edge to it.

The analytic Slug fill algorithm lives in `src/shaders/typegpu/slug/core` as TypeGPU shader functions over plain values,
and nothing in that directory imports a renderer.[^slug-shader-core] The stable q-form solver, root-eligibility table,
per-curve coverage and antialiasing weight, band header and reference bit layout, screen-space scale, thickening,
weighted blend, and row-based vertex dilation are expressed once. A vertical band is the horizontal band in the
transposed frame with the opposite winding sense, so both axes share one curve evaluator and quadratic solver.

Slug quads are the glyph's ink box. Coverage takes each em axis's pixel scale from `fwidth`, the sum of the
coordinate's absolute screen derivatives, so it reaches zero `0.5 · (|t.x| + |t.y|) / |t|` pixels past an edge whose
screen direction is `t`: half a pixel for an edge axis-aligned on screen, 0.683 px at 30°, up to 0.707 px at 45°.
Vertex dilation moves each corner exactly that far across both adjacent edges. Each axis gets its own step, solved from
the corner's screen tangents and the w row; one step shared by both axes, as Lengyel's `SlugDilate` takes along the
`(±1, ±1)` corner, falls short on a stretched, sheared, or tilted plane, and a half-pixel target falls short on a
rotated one. The solve is exact under any projective transform; towards the horizon each step is held at twice its
affine value. The TypeGPU core, the native TSL `/shaders/tsl` graph, and the CPU reference mirror use only the sign of
the outward normal they receive. `tests/package/slug-dilation.test.mjs` runs the TypeGPU functions and the mirror on the
CPU and checks both margins against that fringe for wide, short and tall, narrow quads under uniform, rotated,
stretched, sheared, stretched-and-rotated, and perspective transforms. It also evaluates the package core with
`fwidth`-derived pixel scales under every affine case and checks that no pixel with nonzero coverage falls outside the
dilated quad. The native TSL graph cannot run on the CPU, so only review keeps it in step with the TypeGPU core.

The neighboring TypeGPU modules own page texture reads, grid addressing, band traversal, and the sorted-reference
terminator. The experimental `/three/typegpu` host supplies textures and node-valued glyph fields through `@typegpu/three`, while retaining
native TSL only for the writable inter-stage varying and the matrix-compatible dilation path. A device-free package test
compiles the staged Slug graph through Three's WGSL and GLSL node builders and guards unique shared-function declarations,
both bounded band loops and terminators, and cross-backend builtin compatibility.

`typegpu`, `@typegpu/three`, and `@typegpu/gl` are optional peers because their runtime identities must be shared with the
consumer, like Three.js and React. Stable `/three` and `/shaders/tsl` consumers do not load these bridge runtimes, and
package-size measurements externalize those peer graphs while retaining the package's emitted shader metadata.

The supported peer floors are Three.js 0.185.0, React 19.0.0, R3F 9.7.0 or 10.0.0-alpha.4, TypeGPU 0.12.5,
`@typegpu/gl` 0.12.4, and `@typegpu/three` 0.12.1. Development dependencies remain pinned independently.
Shared renderer development versions come from the `renderer` catalog in `pnpm-workspace.yaml`; public peer ranges remain
explicit compatibility contracts. `@types/three` remains an independent exact pin because DefinitelyTyped patch releases
do not move in lockstep with the Three.js runtime package.
React's `use` establishes the React 19 floor; benchmark and example applications additionally use React 19.2
`Activity` and effect events. The R3F range is `>=9.7.0 <10 || >=10.0.0-alpha.4 <11`; 9.7.0 is the selected
stable v9 baseline. The adapter imports the common R3F entry. R3F v9 applications provide an initialized
`WebGPURenderer` through the async `gl` factory; v10 applications can also use `/webgpu`.
Glyph registers named host constructors because v10's root and `/webgpu` entries share a catalogue but have
separate factory-extension counters. Factory registration from both entries can otherwise replace Glyph's constructors.
Until R3F shares its runtime across entries, mixing them adds about 41 kB gzip in the example application
(verified with alpha.4 and canary.d91831d). Adapter-only package-size checks externalize peers; the production
R3F hello-world measurement includes the complete consumer graph so pull-request comparisons expose this cost.
The v10 alpha.4 baseline supports the package's Node lifecycle tests and requires Three >=0.185.0. The TypeGPU bridge's texture
overload first appears in `@typegpu/three` 0.12.1; the GLSL derivative operations require TypeGPU 0.12.5 and
`@typegpu/gl` 0.12.4.

`mise exec -- pnpm scripts run glyph:peer-check` first rebuilds Glyph, then copies that distribution, source, and focused
tests into a temporary isolated consumer. It installs the declared minimum peers (including React 19.0 declarations),
checks the example-raster package at the same Three and TypeGPU floors, and verifies the TSL regression, public
source/declaration fixtures, shader generation, and React lifecycles. V10 checks exercise both the root and `/webgpu`
entries. Add `--browser` to verify custom WebGPURenderer setup, visible text and retained updates on WebGPU and WebGL2
using Playwright Chromium. The existing lifecycle suite includes the cross-entry host registration regression.
The temporary consumer is removed on exit. Exact `--three`,
`--fiber`, `--react` and `--typegpu` overrides allow checking a candidate without changing workspace installs.
Compatibility coverage includes host registration, font leases, retained updates, and WebGPU/WebGL2 rendering
at both R3F baselines with React 19.0.0 and the other minimum peers.
Three 0.185.0 also passed the native TSL and TypeGPU-backed browser proofs for Bitmap, MTSDF, Slug, decorations, retained updates and custom material
composition on both WebGPU and WebGL2 through `benchmark:v1-bitmap` and its `--typegpu` variant.

The package-owned `glyph` executable is available through `pnpm exec`; its `bake` command supports both project discovery
and a direct known-font mode. Its stable packaged shim delegates to the built Node CLI, so workspace installs can link the
executable before `dist` exists. Direct mode accepts one input/output pair, a collection face, optional shaping-font
Unicode subsetting through the package-owned Fontations/Skera baker Wasm, and independently selected embedded Bitmap,
MSDF, and Slug rasters. The prepared source bytes feed the core shaping bake and every selected raster bake; neither the
CLI nor the programmatic `@pmndrs/glyph/bake` path invokes a platform font tool. `--check`
publishes only to temporary storage and compares the complete GLB byte-for-byte with the requested output. It calls the
same `bakeFont` host as programmatic consumers rather than maintaining an example-only composition path.

Project discovery uses Oxc Parser 0.150.0 for JS/JSX/TS/TSX syntax, Oxc Walker 1.1.1 for lexical scopes, and Oxc Resolver 11.24.2 for
module resolution, including tsconfig paths and TypeScript source extension aliases. It scans `src` by default or the
explicit entry files, then follows project-local ESM imports and re-exports. It resolves literal options and imported
constants without executing application modules or starting a TypeScript compiler. Shadowed names do not inherit an
import's meaning; cyclic constants and ambiguous exports remain dynamic diagnostics. Module-relative font URLs resolve
from their declaring file. TypeScript remains a repository development dependency only. The isolated packed consumer
bakes an actual font through the CLI with neither TypeScript nor Babel installed. These regressions run through the
existing `pnpm --filter @pmndrs/glyph test` command.
Oxc Parser declares Node `^20.19.0 || >=22.12.0`; this change is verified on the pinned Node 24.18.0, not a broader Node
support matrix. Browser entry points do not load these Node tools. Oxc Walker collects declarations before resolving
references, so hoisted and shadowed names retain their lexical identity. Reassigned constants remain dynamic.

Direct baking may add `--glyph-map <path>` to publish a deterministic JSON object mapping authored glyph names to code
points from the same `--unicodes` selection and collection face as the font artifact. The font and lookup publish as one
rollback-safe output set, while `--check` verifies both byte-for-byte. Unnamed mappings are omitted. A name with multiple
selected code points is rejected as ambiguous so the caller must narrow the Unicode set rather than accepting an
order-dependent alias.

The `glyph glyphs` command uses the same package-owned baker Wasm and Skrifa to enumerate Unicode mappings, exact glyph
IDs, and names retained in a font's `post` or CFF data. Exact repeatable `--name` filters can emit structured JSON or a
compressed `--unicode-set` accepted by `glyph bake --unicodes`. Fonts without authored names still expose exact IDs rather
than invented semantic labels. Rich vendor labels and aliases remain external catalog data.

R3F `Text` and `TextGroup` never accept handle or root props. The adapter obtains both from one immutable React context: a
provider-selected `ThreeHandle` or terminal `ThreeRoot` when present, otherwise the Canvas-local default root on one
module-owned default Three handle that calls idempotent `glyph.init()` and installs `ThreeConfig` once. `handle="surface"`
is shorthand for the idempotent `defaultHandle('surface')` named root. A provider captures its initial selection and `fontFaces` alias table and never updates
the context value; selecting another root, handle, or alias table requires remounting the provider. Context is constructor dependency
injection only: it owns no engine, runtime, scene, renderer, canvas, publication cursor, or semantic resource cache, and
it never disposes an externally owned handle or FontFace. It disposes only FontFaces it declared from shorthand table
entries. Supplying `fontFaces` or `fallback` adds a local Suspense boundary; `errorFallback(error, dismiss)` handles only
`GlyphFontError` and rethrows unrelated errors. Recovery is explicit: the caller repairs the resource, then invokes
`dismiss()` to retry the child tree. Imperative construction uses `handle.createText()` and `handle.createTextGroup()` for the
anonymous root, or `handle(name).createText()` and `handle(name).createTextGroup()` for a named root.

React font selection has three coexisting public paths. A caller-owned FontFace may be passed directly to outer or nested
Text; `useFont` and the typed `useBitmap`/`useMsdf`/`useSlug` leaves own hook-created declarations and mounted Font
leases; and `GlyphProvider.fontFaces` supplies optional subtree-local string aliases from sources, `{ src, format? }`, or
caller-owned FontFaces. All three use the same Glyph resource graph. `suspend-react` retains only stable Promise/error
identity across React retries, and is not a semantic font cache. See [React font loading](../guides/react.md).

The Vue adapter mirrors that contract for TresJS. Its `Text` and `TextGroup` are `defineComponent` render functions
that construct the same retained Three classes through the Tres catalogue under private tag names; applications never
use those tags. The paragraph style list is the `textStyle` prop rather than `style`, because Vue normalizes any
array-valued `style` prop into one merged object while creating the vnode, before setup can observe the list; `layout`
and `constraints` keep their names because Vue leaves them untouched. Nested `<Text>` slots flatten into inline spans
without mounting, constructor `args` stay referentially stable for the life of a node because Tres rebuilds an instance
when they change, and a root or `pixelSnapping` change remounts through the element key. One default Glyph root exists
per `TresCanvas`, retained by reference count with a one-microtask grace period, because a root may not span two
Scenes. Vue has no render-phase suspension: a paragraph mounts nothing until every FontFace selection is loaded, starts
missing loads together, and keeps the current paragraph while a later selection loads. `useFont` returns
`{ font, error, ready }` shallow refs plus a promise for async setup; the format leaves compose it exactly like the
React hooks. See [Vue and TresJS font loading](../guides/vue.md).

Both component adapters treat each committed prop set as complete desired state: removing style, layout, constraints,
flow, material, or raster pixel ratio restores the corresponding default. React and Vue pass that state through Three's
canonical framework-update path, which normalizes it once, reuses equal package-owned property, span, and flow snapshots,
and reports whether the desired revision changed. Neither adapter retains a caller-owned applied-state cache, so an ignored
in-place mutation cannot swallow a later valid immutable update. Vue still detaches nested reactive records before the
call so proxy mutation cannot rewrite a package-owned snapshot; Three adopts equal records without another clone.
Neither adapter mutates a render-time React ref or treats object identity as paragraph correctness. `TextGroup` material
and render order follow the same rule through one shared
imperative apply step rather than framework prop diffing, so removing either restores the Three default. Paragraph and group
updates request a frame on demand-rendered canvases only when the desired snapshot changed; a re-render with identical
props requests nothing. A pending Vue font switch keeps the current Three object and its leases until replacement fonts
are ready; constructor arguments remain valid for that mounted object's lifetime. React retains its ordinary Suspense
lifecycle.

`pnpm scripts run glyph:adapters-check` runs the shared React/Vue behavior cases and each framework's lifecycle tests
against a freshly built distribution, plus adapter formatting, lint, and source declaration checks. Shared cases cover
prop removal, nested property replacement, presentation-only changes, equivalent PropertyList shapes, malformed property
input, frame requests with an identical-snapshot negative control that also retains flow and measurement identity, flow
retention and removal, group material and render-order removal, loaded-to-pending font switches, and lease disposal. Vue
additionally proves a reuse hit followed by
in-place nested reactive updates. React additionally proves that mutating stable caller input cannot poison the accepted
state used by a later fresh update. Three's
`Text.set({ material: undefined })` explicitly clears an override.

The public `ThreeRoot` contract stops at that retained scene API: identity and disposal, Text/TextGroup construction,
counts, and mutable material presentation. The renderer draw object, discovered Three Scene, root services, command
boundary, and Font lease acquisition belong to the package-owned root host. They are unavailable through both source
conditions and built declarations; package internals recover the host through private identity rather than exposing a
second renderer/runtime object to applications.

`Text` publishes ink through Three's object-level `boundingBox` contract and carries one package-private shared empty
`BufferGeometry` marker so `Box3.setFromObject()` visits those bounds in ordinary and precise modes. The marker has no
vertex payload, child, draw, per-Text allocation, serialization, or raycast behavior. Before the first rendered frame,
Box3 consumes ink from the prepared revision. A requested summary may already contain ink; if it is still unknown,
the explicit bounds demand materializes owned prepared glyph columns and derives paragraph and line ink from those
columns. It does not repeat authored shaping or require renderer publication. Later traversal reuses the
revision-aware measurement cache. A summary with unknown ink does not mark the Three bounds cache
current or clear known same-revision ink. Zero glyphs prove a valid empty box; positioned spaces retain a finite
zero-height extent. Drei Center/Bounds can therefore consume transformed paragraph boxes without coupling
authored objects to renderer-owned batch meshes or copying the per-glyph columns.

The unbundled source graph follows the same boundary. `/three/raster-program` exposes the custom-raster
registration DSL but keeps compiled snapshots and renderer lifecycle state under the denied `/three/internal/*` tree.
Mixed implementation modules for Text, detached Glyphs/Decorations, frame translation, and measurement are exact-denied
as direct package paths; the curated `/three` entry re-exports only their supported classes, functions, and result types.
Likewise, `defineGlyphConfig()` returns inert structural data with no hidden callable factory; the config leaf exports the
declaration DSL, while only `glyph.handle(name, config)` enters package-private construction. Spreading or wrapping a
config preserves its inferred handle/root type and may override fields without depending on exact object identity.

`ThreeCodec` exposes only the ordinary `Codec` contract an application can encounter through `ThreeConfig`. The
compiled Three raster programs and renderer-resource pool are recovered through package-owned Codec identity inside the
adapter; they are not public properties and do not force `@pmndrs/glyph/three` to re-export an internal type. R3F's
implementation uses one package-private Three construction bridge because it creates the same retained Three objects;
that bridge does not create another runtime or an alternate renderer integration API.

Glyph initialization retains one settled `Promise<void>` forever, whether it fulfills or rejects: concurrent and later
`glyph.init()` calls receive the same object. Initialization failure is fatal for that module lifetime, so an error path
cannot repeatedly allocate large Wasm memories; a full page or module replacement is the retry boundary. In browsers
every default Wasm asset (the text shaper, the runtime-bake worker's font baker, and the Bitmap, MSDF and Slug bakers)
is fetched and handed to `WebAssembly.compileStreaming`, so compilation overlaps the download and HTTP compression is
decoded by the network stack. Streaming is attempted before inspecting response MIME or type. Following wasm-bindgen's
loader policy, a streaming rejection falls back to buffered compilation for a basic, CORS or default response whose
MIME is not a case-insensitive match for `application/wasm`; other streaming errors propagate. MIME parameters remain
invalid for streaming, including `application/wasm;`. A mixed-case Wasm header preserves a consumed-body compile error
instead of retrying the body. The same response is used without cloning or
refetching. Node reads the packaged files directly. Vite HMR carries
the process-local Glyph runtime through replacement data instead of instantiating a second engine. React still checks
synchronous initialized and loaded state first, so ready renders do not enter Suspense or cross a microtask. Pending font
loads use `suspend-react` only as React's stable suspension cache; Glyph's FontFace resource graph remains the semantic
cache and lease owner. Each FontFace selection retains one Promise for the lifetime of its declaration-owned load record;
disposing the face releases that record, and a rejected font operation is evicted so an explicit later load can retry.

The R3F `Text` component infers the raster-format union from a required outer font selection, including a font stack chosen
from runtime state. Callers retain that inferred union rather than widening dynamic selections to an erased catch-all. A nested `Text` is flattened into
an inline styled run and may omit `font` because it inherits from its enclosing paragraph; a rendered outer `Text`
without a font is invalid. Nested text creates no Three object and accepts only `children`, `font`, `style`, `paint`, and
`material`. Because JSX erases the generic element identity needed to reject every box-only prop statically, the
flattener validates this boundary synchronously and names any invalid property instead of silently discarding it.
`TextGroup` owns nestable hierarchy and presentation inheritance, never font inheritance or a planner boundary. Both mounted components register their Three
objects with the R3F host and are constructed during its commit rather than in a layout effect. React `Activity` can
therefore pre-render a hidden text or whole text group, while R3F retains visibility and eventual disposal ownership.

Structural `txt`/`span` values and nested React `<Text>` are the only public rich-text authoring paths. They compile one
immutable string and internal span records while preserving authored UTF-16 join offsets. Rust resolves those ranges
against its pinned grapheme boundaries during preparation, including when a text edit changes cluster boundaries
(D-265). Public `Text` and `Text.set()` inputs reject a parallel raw `spans` field; callers therefore cannot forge
offsets or maintain a separate mutable range table. TypeScript validates and snapshots caller-owned styles, while Rust
owns grapheme alignment and retained style ranges.

A frame the engine refuses names its cause and the input that caused it (D-267). Six caller-actionable statuses --
`styleRangeInvalid`, `styleSplitsCluster`, `styleNestingInvalid`, `styleRootInvalid`, `fontStackMissing`,
`fontMetricsMissing` -- are separated from `invalidRequest`, which keeps every internal invariant violation and names
nothing. Each carries the offending paragraph and style in two u32s of the result header's existing tail padding, so the
header size and every prior field offset are unchanged. `/three` re-raises them as `TextFrameError`, whose `rejection` is
a discriminated union over the cause and affected `Text`; span bookkeeping remains private to the structural compiler.

Publicly constructible frame inputs are validated where they enter `Text`, `TextGroup`, Codec assembly, or
font registration; malformed data never waits for scene traversal to fail. A residual engine rejection therefore names an
internal invariant defect through `TextFrameError` while the last committed draw state remains live. Renderer preparation is
separate: if an engine-accepted publication cannot realize its resources or material, Three discards the candidate, keeps
the last accepted draw state and fences, and retains the error. It does not retry unchanged frames. Explicit material or
other renderer-relevant invalidation requests a checkpoint from the last consumed command revision. A malformed emitted plan
is an engine defect and never enters this recovery path (D-285).

`registerThreeRasterProgram` refuses a format registered after a runtime has read the registry (D-271), naming the
raster format instead of applying to nothing. Snapshot tracking uses weak registry references, so an abandoned runtime cannot
keep its identity registry alive or permanently poison later registration after collection. `/three` also re-exports
`ParagraphLayoutSummary`, `GlyphLayoutInspection`, `BorrowedGlyphLayout`, `BorrowedGlyph`, `ParagraphLayout`,
`ParagraphMeasurement`, and `FontFeature`, so a `/three` importer can name every Three text query result.

One baked GLB may expose several raster formats without repeating its input identity. The ordinary declaration and loading
surface is `glyph.fontFace(source, { family?, format? })`; root does not export `loadFont`, `createFontLibrary`, or
`FontLibrary`, and there is no public font-library leaf. Package-owned loading services preserve custom transport and
runtime-bake support behind the FontFace declaration. The face is
its aggregate/default selection, `.default` aliases
it, and declared keys such as `.bitmap`, `.msdf`, or `.slug` are distinct inferred format selections. The declaration
owns loading: `face.load()` loads every authoritative imported format advertised by the main font plus every declared
exact format, while `face.slug.load()` loads only that exact declared format. `face.formats()` inspects the authoritative
main GLB without fetching sidecars and returns its frozen, ordered format keys. Successful calls preserve Promise and
result identity; rejected calls are evicted for retry. The consuming handle supplies its configured default key when an
undeclared face is passed to Text; imperative Three rejects an unloaded selected format before creating retained state.
`Text.measure()` and `Text.glyphs()` answer from the setter-prepared paragraph selected by their handle. Prepared reads
look up the current desired revision independently of renderer acceptance and Scene membership; they do not traverse a
scene, publish commands, realize renderer resources, or initiate another semantic preparation. A first read may establish
an absent binding through the same preparation producer. Normal rendering publishes dirty roots through `glyph.shape()`.
The former renderer-free `createParagraph()` path was removed because its private engine, handle, Codec, planner, font
bindings, and caches duplicated the GlyphConfig pipeline (D-339).

Setter preparation omits unchanged authored geometry from the same engine request. Normalized owned layout and constraint
snapshots retain identity for equivalent assignments, including Three's complete state updates; text and paint changes
therefore reuse Rust's committed geometry. Transform binding changes and explicit flow or inline-object assignments retain
geometry invalidation. Font or metric changes still reflow through the existing engine using that retained geometry.

Native test-only work attribution separates setter measurement/query serialization from final semanticViews:none publication, with cold-shape/full-gather oracles outside the counted phases. The bulk fixture distinguishes per-owner work from per-glyph work using 1,024 ten-glyph labels; it is a work-count diagnostic, not timing evidence for the Inter Labs font.

Unchanged committed style structure reuses its validated nesting/order during text-only preparation. The same validator still checks the new UTF-16 length and style/feature endpoints plus registered font stacks; changed or new styles also run structural validation and resolution. Failed preparation preserves committed text/styles and permits the next valid assignment.

Three publication revision preparation and settlement use the existing pending-measurement owners. Rejection retains those
owners for retry; detached query cache transfers preserve their pending membership. Fixed capacity uses staged UTF-16 units
maintained at successful updates and lifecycle changes, rather than summing every bound Text during publication. Hierarchy
reconciliation and transform synchronization remain separate observations of the live Three scene.

During Scene traversal, a root already present in the engine's dirty-registration Set skips the redundant presentation
preflight; its existing preparation still reconciles current hierarchy, materials and order. Unqueued roots retain the
preflight so raw Three mutations are observed without staging clean roots. Queue membership is package-private, consumed
before staging, and removed on rejection, deferral and disposal; pending measurement owners do not authorize implicit
retry. This adds no dirty flag, cache or publication executor.

Alternating reads of two detached paragraphs already prepared by their setters preserve both bindings and their cached
measurements. The regression makes 8,193 measurement reads followed by 8,193 owned glyph reads with no further preparation
or renderer publication. `Text.glyphs()` still returns freshly copied caller-owned columns. The existing owned inspection
cache retains its outline reader and font stores once per prepared layout; returned copies keep independent columns and
can read outlines after Text or Font disposal. A successful setter invalidates that cache, while a rejected setter preserves
the previous prepared inspection. Owned inspection and demand promotion copy bounded ranges of up to 32 records directly
from prepared positioning into the same typed columns; scalar reads request one record through the same private range
export. Its fixed scratch belongs to the Wasm instance and is independent of the publication output budget. Sparse
borrowing counts successful record fetches in this same inspection owner. Once demand reaches the prepared glyph count, the next callback materializes through the existing inspection-copy producer before caller entry; descriptor, invalid and expired reads contribute no demand. Promotion never occurs after a callback and preserves borrowed expiry/mutation guards. Publication membership remains
separate from semantic preparation lifetime; the older detached-query fallback has not yet been retired from every
binding transition, so this evidence does not establish completion of the setter-first integration.

`Text.readGlyphs(callback)` replaces `withGlyphs` without a compatibility alias. The
[archived migration](../../skills/codemod/codemods/2026-09-24-read-glyphs/instructions.md) preserves callback return values,
synchronous exceptions and view lifetime.

`Text.readGlyphs(callback)` is the shared core, Three, and TypeGPU demand-read alternative for callers that need only a
few glyphs. Its fixed descriptor serializes no per-glyph semantic table; each indexed access copies one retained Rust
glyph into fixed Wasm scratch, then returns one frozen scalar object in O(selected) work. Full `glyphs()` remains the
bulk caller-owned copy. The callback must finish synchronously:
thenables, engine reentry, and retained-text mutation are rejected, and the indexed view expires on return or throw.

Attached live deformation is accepted as the future D-356 design but is not shipped by either adapter. The current
`Text` surface has no `transformGlyphs()` or `clearGlyphTransforms()` methods and allocates no attached matrix sidecar.
A separately scoped follow-up must prove coordinated Three and TypeGPU storage, lifecycle, interaction geometry, and
performance before exposing that API. Existing detached `Glyphs` transforms and `copyGlyphs()`/`split()` remain
the owned, already-shaped manipulation path and intentionally stop following the source `Text`.

The FontFace source cache coalesces canonical-equivalent locators before I/O and converges different locators onto one
parsed main-font node after their complete GLB bytes have the same SHA-256 content identity. Every acquisition base is
retained on that node, so a relative sidecar may fall back across equivalent acquisitions without using its filename as
identity. Per-format variants load lazily and the shared main node retires after its last source lease. Loaded external
raster artifacts retain their authenticated complete bytes, and external raster resources converge by SHA-256 plus byte
length instead of URL or filename. Each raster records only the resource identities it actually resolved, preserving the
dependency graph without copying those resources into every format.

Cross-realm movement is deliberately outside ordinary loading and rendering. Only an explicit `clone()` copies bytes:

```ts
const Inter = glyph.fontFace('/fonts/Inter.font.glb', { format: [msdf, slug] });
const [serialized, transfer] = await Inter.slug.clone();

worker.postMessage(serialized, { transfer });
```

`face.clone()` loads and snapshots the aggregate selection; `face.slug.clone()` loads and snapshots only that exact
selection. Both return fresh full-span `ArrayBuffer`s, so transferring them may detach the clone without changing the
originating FontFace, immutable Font values, or cache. The receiving realm passes the inert, versioned
`SerializedFontFace` directly to `glyph.fontFace(serialized)`. Glyph synchronously claims its buffers into private
ownership. The versioned discriminator selects this cross-realm path; because only Glyph produces the snapshot, the
receiver does not normalize its fields, revalidate its dependency metadata, or re-hash its bytes. Ordinary GLB parsing
still fails at the operation that cannot consume malformed bytes. The lazy importer adopts the main GLB, selected raster
sidecars, and only their resolved external resources into the same content graph used by URL-string, `URL`, and `Blob`
declarations.
A complete existing graph is reused without fetching;
partial transfers may progressively add formats to that graph. No live FontFace, Font, Promise, handle, or renderer
resource crosses the realm boundary, and no normal `load()`, Text construction, `glyph.shape()`, or renderer path invokes
the snapshot code. The initial package graph retains only the synchronous serialized-value discriminator and ownership
claim needed by `glyph.fontFace(serialized)`. Copying a loaded graph and reconstructing missing transferred nodes live in
one package-private dynamic chunk reached only by explicit `clone()` or by loading a serialized declaration. A real
Worker transfer test proves every posted clone buffer detaches in the sender, the receiver reconstructs the selected
format with fetching disabled, and neither realm initializes the shaping engine.

React `<Text>` consumes the same `FontFace` declaration or selection as imperative Three. It asks the selected Three
handle which exact format the declaration denotes and enters the shared `suspend-react` resource only while that format
is unloaded. The selected Text owns an independent immutable Font lease and releases it on unmount. `useFont` and its
typed raster-format wrappers remain conveniences over `glyph.fontFace()`, with matching `.preload()` and `.clear()`;
they do not introduce another loader or resource cache.

Artifact metrics carry text decoration from bake time (D-246): required `underlinePosition`/`underlineThickness` from
`post` and `strikeoutPosition`/`strikeoutSize` from `OS/2`, with a conservative derived fallback when a source font
omits `post`. The loader decodes all four into public `FontMetrics`, and the rich-text conformance lane probes every
font it loads for finite, positive-thickness values. Decoration rendering consumes those metrics end-to-end (D-248):
spans declare `decoration` (solid underline, overline, and line-through; other line styles are rejected at the
boundary), the engine cascade stamps the CSS decorating box so one continuous line spans nested font-size changes at
the declaring span's scale, and records flow through both planners as resource-free rows of the reserved
`pmndrs.decoration` Codec technique. Codec programs carry a primitive kind in the former reserved wire field; underline and
overline rows precede the paragraph's glyphs while line-through follows them, matching CSS paint order, and Three
realizes decorations as separate ordered draw objects. The same `defineTextMaterial()` factory used by glyph formats
receives a `kind: 'glyph' | 'decoration'` discriminated context and may keep or override the default flat-quad TSL
material without mutating the glyph draw. `ThreeTextMaterialContextMap` supplies the exact built-in payloads and is the
augmentation point for a custom Three program's literal format and output types; it does not add an untyped string
fallback. Only glyph branches carry a raster `format`; `pmndrs.decoration` remains an internal Codec/command-buffer
technique identifier. Decorated command-buffer gathers rebuild their output, counting and appending each paint pass
directly from the retained contiguous decoration slice without a transient filtered allocation; the undecorated retained
fast path is unchanged.

When runtime baking is required, one Worker request normalizes the Unicode ranges, prepares the selected source once,
and feeds those exact prepared bytes to the shaping bake and every requested Bitmap, MSDF, or Slug bake. The Worker
composes and validates one canonical GLB before transferring it. Its `asset.generator` is the publishing package identity
`@pmndrs/glyph`, independent of whether the producer was the CLI, Node API, or runtime Worker.

The Worker caches only that final validated GLB in `CacheStorage`; partial preparation and raster outputs never become
cache entries. Identity covers source bytes, face, normalized ranges, ordered raster descriptors and keys, and all
relevant format/baker versions. Persistence is inherited from the source response: `no-store`, `no-cache`, missing
freshness metadata, and already-expired responses remain memory-only, while `max-age` or `Expires` supplies the exact
derived-artifact expiration. Browser quota eviction owns storage pressure. Cache absence, quota rejection, privacy
restrictions, and storage corruption are transparent misses followed by the same canonical bake.

## Retained frame transaction

Draft #292 is rebased onto main2f62d6ba, including the merged query-first copy contract. Durable paragraph
preparation retains the transaction Codec binding when commit_measure consumes the speculative transaction;
copying therefore uses that same prepared paragraph before first publication, without manufacturing another query
or publishing its source. Inspection reads do not serialize full semantic result buffers. Publication capacity
failure/growth is tested at the actual command-result boundary. The integrated native suite and focused copy/lifetime
controls pass; combined performance and binary-size gates remain open.

The current slice preflights each ordered text-mutation batch against its evolving UTF-16 length before touching pending
text storage. The same range/length checker serves preflight and application; resulting Unicode validity remains part of
the existing Unicode-analysis pass. Invalid offsets reject before the first text edit, including a bad later edit after
a valid prefix. Ordered render-plan and session-placement commits also validate all pending write ranges and buffer
generations before either mutates accepted output; batch provenance keeps ordered commit linear and checkpoint
allocation snapshots remain valid. These slices do not yet retire preparation rollback or prove the full accepted-state
failure contract in D-373. If Rust commits a measurement but TypeScript fails before adopting it, the transport marks
that root's derived state unusable; the next explicit operation resets only the Rust planner state, replays live accepted
TypeScript inputs through the same paragraph-preparation executor, and forces a renderer checkpoint. Rust reset keeps
the root transport and renderer-owned buffers intact. A real-font regression injects this boundary failure, confirms
renderer bytes stay unchanged, and checks recovery against a fresh build. This covers the cross-language non-adoption
case; preparation's internal undo lanes and the complete post-write failure contract remain open. A matched four-block
`edit-sized` package A/B measured 0 faster, 1 slower, 45 neutral and 1
clock-confounded skipped workload. Median workload p50 moved from 0.895 to 0.904 ms. The sole slower result was
1,000-label same-length engine publication, 1.75 to 1.89 ms (+0.140 ms, +8.5%; p=.029; 95% interval +2.4..+13.2%).
The 1,000-label edit/read cases were neutral. Optimized Wasm grew 1,464 bytes and the package archive 1,099 bytes.
This hardening slice establishes no performance gain; the combined publication gate remains open.

Caller style batches now receive a root-count preflight before preparation. Rust sorts and collapses duplicate style IDs
with the same last-write rule as application, then merge-walks those keys with retained styles in O(U log U + S + U)
work, reusing paragraph-owned scratch (or planner scratch for a new paragraph). This removes the prior repeated scan of
the whole mutation batch per retained style. A deterministic work-count test verifies linear merge growth and scratch
reuse. This check complements text-range preflight; performance remains gated on the exact installed-package A/B below.

`Staged<T>` keeps a committed Rust baseline beside a reusable preparation candidate so incremental stages can derive
the next value and recycle allocation capacity. That baseline is not the renderer's in-flight frame or an old-render
fallback. Renderer-owned bytes remain unchanged until acceptance; an unexpected failure after Rust writes invalidates
the derived root and the next explicit operation rebuilds accepted authored state through the same preparation path.
The candidate can still be discarded before commit when a request changes, but that is internal candidate selection,
not restoration of a previously published renderer frame.

The ordered draw compiler may consume retained, revision-authenticated changed intervals to reuse an unchanged draw
span's stored bounds, semantic summary and count. It emits every current record through the canonical emitter; changed
spans keep the same dense reduction body. Reuse requires unchanged physical storage, accepted ordered mode, disjoint
input dirt, and unchanged current split boundaries. The gather producer records changed bounds and semantic IDs even
with zero paint masks; an exact scope includes that metadata. Session buffers publish separately and do not mutate the
gathered glyph summaries. Prepared mode is separate from accepted mode; abort does not advance
it, and special reorder revokes the witness on acceptance. Complete-dirt, structural, checkpoint and independent work
use the existing compilation paths. Full draw-table output still costs proportionally to draw count. This bounded slice
is implemented but its correctness, delivery size and end-to-end performance gates are pending in the frontier tracker.

Every handle owns one anonymous root, and `handle(name)` idempotently selects named sibling roots. Each root owns one Rust
command-buffer stream and one renderer publication boundary. It may bind to at most one Three `Scene`, discovered from its attached Text
members by object identity; a root name is stable semantic/customization metadata, not a `Scene.uuid`. A second Scene
therefore uses another named root. Returned roots are terminal and cannot create deeper roots. `TextGroup` remains freely
nestable for scene hierarchy, transform/visibility inheritance, material selection, pixel snapping, and render order, but
does not create another planner or publication stream. Capacity is immutable `ThreeConfig` policy shared
by the anonymous and named roots of one handle; selecting different policy means creating another handle from
`defineThreeConfig(...)`, not mutating a live root. Per-root, group, Text, and span material selection remains retained
scene state because it describes authored presentation rather than renderer policy. A bound `Text.set()` or property
assignment synchronously prepares its current semantic/layout state in Rust before returning. A changed text assignment
uses one full existing-wire UTF-16 replacement; Rust performs packed sparse comparison for same-length candidates and
scalar-aligned prefix/suffix discovery for length changes. `measure()` reads the prepared fixed-size summary, borrowed
glyph demand addresses prepared positioning directly; explicit inspection or recurring full-record demand materializes the same owned inspection. A
traversal publishes renderer commands from that preparation. The ownership split is:

- a setter sends full changed text plus only changed compact style rows, removed style tails, and changed geometry;
- traversal does not replay text/style/geometry after setter preparation and sends only remaining renderer
  lifecycle/order demand;
- transform and visibility changes update Three's renderer-local sidecar without calling Wasm;
- an empty or normalized-equal update sends nothing.

Prepared measurement totals, glyph spans and ink use the same positioned representation. The obsolete line-only
preparation selector, repair branch and flow-level glyph-total fallback are retired; production query/update entry points
always supply a shaper and complete positioning. No-shaper fixtures remain test-only. Equivalent geometry retains the
committed flow/positioned pair, while full clipped inspection positions its intrinsic scratch before consumption.
The bounded retirement passes 330 focused engine tests, all static gates including 11 Rust fmt/Clippy gates, a fresh
package build, and 971 compiled-Wasm package/integration tests. Performance acceptance remains separate.

Formatted-text adapters snapshot caller-owned styles and preserve authored ranges through React, Vue, Three, and the
retained planner. They do not run a JavaScript grapheme pass or carry range-provenance brands. Rust stores both authored
and resolved style offsets, re-resolves retained styles when text changes, and omits collapsed ranges from cascade
resolution while retaining their source offsets for future edits. The JS grapheme implementation is test-only and
supplies an independent conformance oracle. Style values remain validated at the caller boundary; renderer adapters
bind fonts and materials without becoming a second range authority.

Three's ordinary scene traversal owns world-matrix composition. The root observes Text membership and ancestor state,
publishes semantic changes once at its renderer-owned draw node, and patches root-relative transforms through a separate
engine-free side path. Camera motion does not republish text. Text, nested `TextGroup`, and other ancestor motion,
visibility, reparenting, and manual matrix changes patch only affected renderer-local slots and do not enter Wasm.
Calling `TextGroup.updateMatrixWorld()` directly also observes a changed finite group `renderOrder` and publishes that
presentation change; an unchanged direct traversal remains a no-op. The root-level publication object is a Scene child,
so this order is compared with sibling Scene draw-mesh order rather than inheriting an authored parent `Group.groupOrder`.
Within a `TextGroup`, each child `Text.renderOrder` ranks that paragraph's instances in the shared batch while the nearest
`TextGroup.renderOrder` remains the Three draw-mesh order. Changing only a child rank publishes one transactional
16-byte `(paragraph_id, scope, rank)` sideband record and lets Rust apply the paragraph permutation without resending
text, styles, geometry, measurement, or per-glyph records. Ordinary content updates retain the 12-byte lifecycle record
and omit the sideband when scope and rank are unchanged. An ungrouped
`Text.renderOrder` retains ordinary Three draw-mesh meaning. Paragraph rank is deliberately absent from glyph storage and
draw keys: compatible spans and grouped paragraphs therefore coalesce within their authored batch boundary by resource,
material, and fixed paint layer, with under-decoration, glyph, and over-decoration layers preserving CSS paint order.
`TextGroup.batching` controls only that physical boundary; it does not create another planner, Wasm root, or publication
stream. The default `auto` makes each top-level authored group a boundary while nested automatic groups inherit it;
`group` forces a nested boundary, and `shared` joins the nearest authored boundary or the implicit root pool. Hiding a
boundary-owning group skips its compatible draws without resizing buffers, replacing meshes, or entering Wasm.
Committed draw order and batch-scope indexes are installed by the draw replacement transaction rather than replayed by
every transform synchronization. `TextGroup` traversal first checks constant-time committed scope presence, then retains
effective visibility only for an owned scope; direct transforms and groups joined to a scope-less shared pool do no batch
scope visibility work. The Three renderer updates only an observed scope's draws when visibility changes, while a
replacement stages initial visibility before commit so rejected candidates cannot publish scope state. Transform
synchronization still visits the retained transform bindings to preserve arbitrary mutable Three ancestor matrices.
The 0.2 release regression source exercises that manual contract with 1,000 retained labels partitioned across
alternating top-level `auto` and explicit `group` row boundaries in indexed and direct transform modes. It checks row
and ancestor hide/restore after initial acceptance, unrelated-row visibility, zero visibility-only Wasm updates and
renderer publications, retained mesh and buffer identity, and a hidden row edit/reflow whose current draw output appears
on restoration. This coverage does not add automatic off-screen culling; that remains deferred.
When a rank-only permutation keeps the committed Codec, capability, one-batch single-aggregate-draw storage topology,
and renderable stable-ID set, Rust copies the committed physical records into their new order and publishes write patches only. It transactionally
updates its internal aggregate primitive/draw spans but does not republish unchanged buffers, resources, primitives,
draws, or retirements. Recordless source glyphs remain in retained semantic state but are excluded from the renderable-ID
permutation exactly as they are from Codec output. Any incompatible topology falls back to ordinary retained compilation.
The packed-artifact Labs case over 1,000 labels measured 6.62 ms to 3.85 ms p50 (-41.8%, p=.002) with the other 18 matched
benchmarks neutral.
An active paragraph with no authored text, style, constraint, or inline-object span skips redundant paragraph
preparation when it has no pending setter transaction. Successful setter preparation commits independently of renderer
plan revision and acknowledgement; a later ordinary frame gathers the newer preparation without replaying semantic
input, even when another paragraph triggered publication. Codec and font-binding invalidation remain gather concerns;
this preparation skip adds no alternate gather or publication path. Preparation transactions retain a fallibly reserved,
sorted frontier of stable paragraph IDs. A measurement commit adopts only those touched paragraphs through the shared
paragraph commit operation; lifecycle adoption remains independent, and renderer publication still owns its existing
revision fence. A separate compact unpublished-owner frontier carries successful preparations to publication, using
the paragraph's existing dirty flag for membership; measurement settles only staged owners and publication settles their
union once. Abort preserves previously committed owners, while lifecycle removal retires their IDs before reuse.
Admission reserves frontier growth before mutation, so settlement adds no allocation or failure boundary.
The existing gather cursor reuses exact cached source/output ranges for unchanged paragraphs. A compact journal clears
only prior nonzero mask ranges at retained begin; clean ranges only advance cursors. One mask writer owns journal updates,
with capacity reserved before rows mutate and suffix truncation retiring the matching journal tail.
Dirty/placement/lifecycle changes and shifted endpoints retain the same gather/suffix-rebuild
algorithm. Semantic preparation indexes authored mutation owners and already-staged IDs only, preserving authored order
through existing sort scratch; duplicate semantic-order vectors are retired. With an exact gather cache key and unchanged
source counts, undecorated publication sorts only changed owners by lifecycle-owned renderer index and joins clean cached
ranges in the same gather loop. Measurement-time lifecycle changes invalidate that authorization. Count, decoration or
cache changes use the existing broad gather and suffix rebuild. Placement occurrence order and its sorted key index
now use slot-ID records in the existing retained rope, with keys owned by dense slots and staged roots adopted only
at Rust commit. Canonical index comparisons resolve dense occupants; pending indices are not searched. Full and dirty scopes merge sorted
old/new key streams through one reconciliation body; the former sorted/indexed structural executors are removed.
Changed logical keys allocate fresh physical slots through the same dense allocator and acknowledgement quarantine.
Unchanged-count dirty owners supply only their binding rows; actual buffer replacement and checkpoints require complete
rows through the existing session compiler. Lifecycle adoption invalidates cached occurrence ranges. Abort retains
canonical roots and restores the exact free-slot stack. Native cold/seeded tests pass, including nonzero clean-row
preservation across capacity growth and checkpoint retry. The first optimized artifact passes 971 package tests but
grows Wasm by 21,419 raw / 6,714 gzip bytes. Slot-ID consolidation reduces that growth to 16,072 raw / 6,103 gzip
bytes; 971 Node tests and static gates pass. Exact installed-package Labs reports 12 faster, 33 neutral and two excluded
cases, with no comparable slowdown: the 1,000-label 100-edit immediate-read/publication case falls from 102.01 to
73.25 ms. This is a publication win against the frozen local control, not release-0.1.0 parity or complete #247 acceptance.
The cumulative size gate remains open. Matched-ABI visuals pass MTSDF dynamic layout on WebGPU/WebGL2 and Slug rich text
on WebGPU. Exact artifact identities and exclusions live in the retained assignment design.
The next ordered-consumer slice replaces canonical/pending instance vectors with the existing retained rope and removes
the retained semantic-mask field and full dirty-record rediscovery. Gather's emitted-record intervals carry a private
committed-owner revision proof; rebuilds, decorations and shifted selections revoke it. Generic callers use complete
scope through the same executor. Complete admission traverses physical batches sequentially; sparse scope maps only
changed input intervals. Borrowed draw/writer iterators avoid per-record tree queries. Commit adopts the proof and abort
preserves the prior owner. Full native verification passes 360 unit tests, six outline oracles and Unicode conformance,
including mixed-batch multileaf and seeded cold-output oracles. Source review, static gates, optimized build and 971
Node tests pass. Shaper growth is now 28,663 raw / 10,281 gzip bytes over control, including another 4,178 gzip bytes
over compact placement; the size gate remains open. Exact installed `edit-sized` Labs finishes with 13 faster, six slower,
27 neutral and one timing-mode exclusion. Immediate read/publication improves 102.14→68.75 ms, but 1,000-label
first length-changing scene publication regresses 5.71→6.47 ms. This cut is not merge-ready. The subsequent correction
reuses admission-validated instances from existing dirty scratch and uses shared packed-leaf construction for full layout
and rank reorder. It retires both per-record instance construction loops and the duplicate test-only chunk builder.
Append adopts its candidate root only after every chunk succeeds. Review, 361 native tests, outline/Unicode oracles and
static gates, optimized build and 971 Node tests pass. Correction shaper is 1,551,366 raw / 571,239 gzip bytes,
+11,738 gzip versus control. Growth profile median improves 3.84→3.55 ms but control is 3.16 ms; no corrected Labs
verdict is claimed. Size and performance gates remain open. Compact dirty scratch is restored while retaining bulk
construction; independent review, static/native checks and build pass. This isolation is 1,547,984 raw / 570,028 gzip,
recovering 1,211 gzip bytes from the combined correction but remaining +10,527 over control. All 971 Node tests pass; growth profile median 3.91 ms versus control 3.16 ms. Separate profiles do not prove
scratch causality; neither performance nor cumulative size gate passes. Single-paragraph
scattered edits remain a separate integration gate.
The trailing-owner count-change spike extends the existing private producer proof with a clean emitted prefix.
The shared complete admission/layout retains each accepted physical batch prefix and rebuilds only the tail, then uses
the same batch preparation/writer. Initial eligibility requires every batch retain a clean record and stable membership;
other cases use full scope. Mapping scratch has Invalid/Current/RebuiltPending ownership, preventing aborted full
rebuilds or empty commits from authorizing stale prefix mappings. Successful tail replacement marks existing binding
dirt conservatively even at unchanged emitted counts, preserving draw identity/bounds. Independent review, static checks,
three focused regressions, 363 native tests, outline/Unicode, optimized build and 971 Node tests pass.
Frozen shaper is 1,551,337 raw / 570,621 gzip bytes (+11,120 gzip versus prepared control); cumulative size gate fails.
Last-label growth/publication profile median is 1.557→1.450 ms and p95 2.320→2.172 ms.
Four-block exact installed edit-sized Labs completes: 14 faster / one slower / 32 neutral, all comparable.
1,000-label 100-edit immediate read/publication improves 99.97→68.63 ms and interleaved publication
143.03→108.00 ms. Small color-only scene regresses 432.10→469.08 µs; first growth is neutral 5.87→6.07 ms.
Prepared control is neither current main nor released 0.1.0; release parity and the cumulative size gate remain open.
Draw/resource/binding walks and count-changing placement reconciliation remain broad. This does not clear #247
or prove the single-paragraph ASCII case. Shaper formatting is a package-owned named maintenance workflow.
The [compact frontier tracker](../planning/publication-frontier.md) records the current validation checkpoint.
The following shared draw aggregation cleanup fuses bounds and semantic-ID reduction into the existing draw acceptance
traversal. It retires repeated physical rope span walks and shares a concrete accumulator with unchanged public bounds
helper signatures. Independent review, static checks, explicit expected bounds/semantic/nonfinite/abort regression and
364 native tests plus outline/Unicode and optimized build pass. Frozen shaper is 1,550,403 raw / 570,198 gzip,
recovering 423 gzip bytes but remaining +10,697 over prepared control. Compiled JS and four other Wasm modules are
unchanged. All 971 Node tests pass; causally settled exact-artifact MTSDF dynamic layout on WebGPU/WebGL2 and Slug
rich text on WebGPU render successfully and captures are inspected. Cleanup-versus-prefix exact Labs completes:
46 neutral, zero classified faster/slower, one incompatible timing-mode exclusion. Immediate read/publication
68.71→67.91 ms and interleaved 108.88→107.45 ms are neutral. No FPS or release-readiness claim.
The next slice replaces the flow and positioned single-envelope fields with reusable coalesced interval scratch on
their existing owners. One current-preparation/style proof gates retained line copying and revision comparison. A concrete
run-correspondence check preserves source anchors, owners, glyph counts and numeric blocks through the shared placement
executor; failed proof positions the line normally. Its existing monotone validator is bounded by the segment endpoint.
The authentic 192-line/2,304-glyph full-assignment fixture positions/revision-compares 60 then 24 glyphs, copying 2,244 then
2,280 clean rows. These are work counters, not time savings. Paint/effects and numeric-prefix changes match complete cold
output. A 16-run local-edit fixture retains most rows with zero global lookup visits; distant edits across differently sized
runs still require complete flow. Global lookup preparation remains at most once per retained-line call for reordered runs.
The same gather updater always refreshes structural placement slots, including codecs without u32 operands. Regression
and full-gather checks cover this existing main defect. Independent source review closes all accepted findings; focused
and multiline seeded cold/gather/abort tests pass. Full native/outline/Unicode passed before the final local lookup bound;
the final bound has focused/static validation. Optimized build and all 971 Node tests pass. Shaper is 1,552,801 raw /
571,224 gzip (+1,026 gzip versus draw cleanup, +11,723 prepared control); size remains held. Shipped JavaScript and four
other Wasm modules are unchanged. Exact artifact MTSDF WebGPU/WebGL2 dynamic-layout and Slug WebGPU rich-text probes
pass and captures are inspected. Four-block assignment Labs versus draw cleanup: six neutral, no exclusions or classified
speedups/regressions. Scattered preparation 24.64→24.82 ms; scattered SET/publication 27.97→28.17 ms. This does not
demonstrate a speedup in the 8,192-paint-span Inter workload; size and downstream interval publication remain open.
No second rope, shaper or positioning executor; paragraph-wide gather/binding snapshots remain explicit integration work.
The following cleanup consolidates four endpoints into one range only after existing endpoint equality/count admission,
and shares base/effect semantic-copy loops with current-only effect zero filling. Production shrinks 27 lines; focused,
static/build/971 Node and independent source review pass. Shaper shrinks 761 raw / 198 gzip to 1,552,040 / 571,026;
still +11,525 gzip over prepared control. JS/other Wasm unchanged; scoped cleanup Labs completes with six neutral and
no skips. Scattered preparation 24.42→24.78 ms and SET/publication 27.50→27.92 ms; no measured speedup.
The next publication slice removes the duplicate whole-paragraph output journal and borrows the existing nonzero emitted
mask ranges for ordered admission. Existing source/record cache, identity/topology, decoration, abort and checkpoint
authority remains. Four focused regressions and independent source review pass, including successive measured SETs and
pure structural placement dirt without codec operands. Gather still scans source rows. Static/all 370 native + outline/
Unicode/build/971 Node tests pass. Shaper saves another 258 raw / 206 gzip bytes: 1,551,782 / 570,820, still +11,319 gzip
prepared control. JS/other Wasm unchanged; installed assignment Labs is six neutral/no skips, scattered SET/publication
27.71→28.12 ms; no measured speedup. Exact-artifact dynamic MTSDF WebGPU/WebGL2 and rich-text Slug WebGPU pass;
all captures inspected. An exact Inter discriminator locates whole-run
shaping extent reused as flow dirt: 85 state-equal earlier
lines cannot stop, all 308 lines recompose, and placement remap is never attempted. Detailed next-slice constraints and
cold oracles remain in the assignment design; no wall-time or release-parity claim follows from these counters.
The following test-only Inter proof retains 18,415/18,432 complete local snapshots after scattered full-run shaping;
only 17 source units differ in 13 islands. Formatter, focused cold/gather/abort oracle and static checks pass. This
establishes sparse local evidence, not production flow or placement authority; no production code changed in that slice.
The publication consumer checkpoint builds successfully and passes 971 package/integration Node tests. Its added
seeded gather oracle runs four fixed seeds with 64 edits each, comparing glyphs, sources, masks, placement slots and
all field columns against a fresh gather through length changes, recordless rows, no-ops and discarded-candidate retry.
This tests gather/cache transitions; separate lifecycle cold oracles remain the authority for paragraph rollback.
The isolated rope consumer integration
replaces flow-line/fragment vectors and absolute fragment-start bookkeeping with one COW tree representation, retained
fragment/source summaries and ordered leaf cursors. Proven shaping windows bound wrapping/reconvergence through the
existing line composer. Native engine tests pass; current Wasm/browser/Labs/size gates remain pending, and no rope
speedup is claimed. Whole-root publication discovery remains follow-up work. Cursor extraction now skips leaves/subtrees by record summaries and
returns the same node-relative range type as ordinary rope ranges. It no longer clones iterator stacks or walks records
before range consumers; retained-line lookahead uses that cursor's peek/advance operations. Retained record ropes keep a logical32-record leaf limit while physical Vec capacity grows with demand. Clearing a uniquely owned root leaf reuses its node and buffer as logically empty scratch; shared leaves and branch roots are released normally, and empty scratch roots never become branch children. Placement reconciliation feeds existing packed appends through32-slot stack chunks, flushing before retained key gaps to preserve index and occurrence order. These are storage policies in the same rope and placement executors, not another pool or publication representation. Exact-artifact timing and cumulative size acceptance remain separate gates.
Test-only counters now distinguish new positioning, completed retained payload copies, gather visits and publication
settlement. Real shaping fonts with controlled render rectangles and cold preparation oracles confirm one-label edits
position one glyph at 10/100/1,000 labels. Range reuse reduces publication to one glyph walk and one settlement, while
paragraph traversal remains root-wide. The later sparse-owner/mask-journal native checkpoint passes 337 engine tests;
fresh package/browser/Labs verification remains pending. A 200-character sparse
assignment still positions all 200 glyphs; geometry-only reflow copies 200 records and 34,000 counted native bytes.
These counts exclude placement/run-local storage, metadata, UTF-16 and failed partial copies; they are neither timings
nor total memory traffic. The attribution checkpoint passes 331 native engine tests, static checks and docs validation.
Core preflights uniqueness only when a paragraph is created or its base lifecycle order changes, and validates the final
nonremoved desired set rather than each update in isolation. Atomic base-order swaps therefore remain valid, duplicate
final slots fail before serialization, and rank-only Billboard frames avoid the scan entirely; Rust retains the same
authoritative validation at the ABI boundary. Eager semantic preparation does not install an existing paragraph's
pending renderer order: it prepares against the paragraph's last Rust-installed order and carries the desired order to
the complete publication. A new binding whose final slot is still occupied selects a creation-only free preparation
order; reads cannot observe it, and publication installs the complete adapter base order and explicit sibling ranks. An accepted rank-only
frame commits revisions without repeating cached paragraph measurement calls or bounding-box publication.
The JavaScript planner indexes successfully prepared owners awaiting publication. Lifecycle/order serialization and
desired-state settlement consume that index rather than scanning unchanged Text states. Rust adoption retires each
settled owner; renderer rejection retains the existing acknowledgment/checkpoint contract. Removal deletes the live
pending owner and queues its existing lifecycle retirement; empty publication retains the publisher until disposal.
The same planner retains one frozen complete transform table. Successful membership changes and root or ordered flow
transform handle changes invalidate it before binding release; ordinary edits and renderer retries reuse it. Existing
desired and committed leases protect those handles, and removal invalidates membership before ordinal recycling.
Each traversed Text reports only its own current Scene. When that Scene and the renderer-owned draw object are unchanged,
that individual observation returns without allocating or scanning sibling Text instances. Root traversal still
authenticates active membership, including raw ancestor removal/reparenting, and reconciles presentation before
publication. Reconciliation iterates the entries Map directly, deleting removed entries before staging new ones;
it no longer allocates a copied keys array. The existing desired-membership Set remains authoritative for this pass.
Presentation resolution observes the same ancestry and validates order before cache reuse. Its shared field comparison
returns the existing frozen presentation when unchanged, allocating a new object only on a miss or field change.
Scene transitions and detached draw objects also trigger observation, including recovery after a host clears and
reattaches the authored tree.

Rust publishes one revision containing:

- engine and command revision headers;
- physical-buffer allocation and retirement commands;
- coalesced per-buffer dirty byte ranges;
- resource bindings;
- ordered draw commands with raster-format/program, resource, material, transform, and clip identity;
- optional semantic measurement or inspection sections only when explicitly demanded.

The root-scoped placement table uses the same capability-selected alignment, coalescing, fragmentation, and whole-buffer
upload policy as retained Codec buffers; it does not carry a separate fixed range-packing heuristic.

Metric-only style changes refresh retained shaping-run typography before cluster aggregation but reuse the HarfRust glyph
result. Font size, letter spacing, word spacing, line height, and baseline changes therefore rebuild advances and
positioning without treating glyph identities as newly shaped content. A public optimized-Wasm regression doubles a
paragraph's font size and proves its retained inline advance doubles; the live Paragraph Stress scene additionally keeps
correct spacing through intermediate animated sizes for Bitmap, MSDF, and Slug.
Line boxes resolve vertical metrics from the font stack's primary face rather than the fallback face selected for an
individual cluster. Natural line height retains nonnegative font leading; an explicit `lineHeight` is authoritative and
may produce negative half-leading, so values below one em remain effective and mixed-script fallback cannot introduce
line-to-line leading jitter.

The Three executor does not infer paragraph layout from GPU records and does not maintain a parallel candidate/current
target state machine. It applies the Rust command buffer transactionally and retains only renderer resources required by
future deltas. Portable payload bytes are already shared by immutable `Font` values; Three's current GPU texture realization remains
root-local. Pooling those immutable device objects above roots is a Three implementation follow-up, not a core scene,
device, render-pass, or implicit-standalone-batch API.

Three retained storage uses `StreamDrawUsage` so its common attribute manager follows the attribute version instead of
unconditionally uploading every `DynamicDrawUsage` resource on every render. Accepted buffer and transform mutations
still merge update ranges, advance the storage version, and invalidate Three's WebGL2 PBO texture view. When a backend
replaces a three-component attribute view with four-component padded storage, publication repacks every affected record
into that detached view before advancing the version. Transform-table growth disposes the superseded attribute only after
the candidate publishes; rejection disposes only the candidate, and root teardown disposes the final table.

Three preparation remains the rejection boundary: a material factory or other realization failure leaves the last
accepted renderer branch and core revision live. Once commit starts retiring the old host branch, publication is
irreversible. A caller-owned `dispose` or final matrix-update callback that throws after that point is therefore reported
only after Three and the retained planner accept the same candidate. The public shaping call still throws that callback
error and the affected Text/TextGroup records it, while `commitState()` reports the newly accepted revision; later
visibility, transforms, and render order continue from that publication rather than from a rejected-core split state.
The commit installs the candidate resource, transform, draw, and batch-scope authority before invoking any host add,
remove, geometry-disposal, or resource-disposal callback; it retains the previous draw array only as the local retirement
source. Reused draw metadata still updates before transform commit. An accepted hook commits the exact revision captured
for engine preparation, not a callback-mutable staged revision, so a different Text update authored by an earlier root's
notification remains pending and publishes through the ordinary next shape call.
Public Text, root, and handle disposal first use the engine's existing mutation gate, so a disposal attempted from a
borrowed publication callback rejects before changing lifecycle flags, root membership, or shape participation. Text
preflights at the root-membership boundary even when it is detached and has no publication entry. The same gate remains
closed until every shape participant captured for settlement has consumed its outcome, so an earlier root's `onError`
cannot dispose a later root or handle and suppress its accepted-publication failure. Error attribution snapshots the
publication's Text and live-group ownership, carries the accepted/rejected classification to both, installs every internal
state, and only then invokes guarded notifications. The root retains only that error-path group ownership: replacement
updates it, successful publication clears current Text state plus the retained group set directly without copying
participants or rediscovering ancestry, and group disposal releases the group from the same set and clears its terminal
error state after lifecycle preflight. The root admits only the outermost attribution through state installation and user
notifications, so callback-driven scene traversal cannot replace that in-flight failure with a secondary reconciliation
or transform error. One bounded root publication-cycle flag extends that ownership from preparation, before any captured
root can consume renderer commands, through accepted or rejected settlement. A traversal failure raised while that cycle
is active is retained in one explicit-value wrapper. The renderer's existing retirement wrapper remains the primary when
present; otherwise the deferred traversal failure enters the same accepted hook and public throw instead of being lost.
This root ownership covers cross-root callbacks both before a later root commits and after it commits but before its hook,
and clears on every adapter skip, rejection, acceptance, throw settlement, or disposal exit. Nested traversal and ordinary
Text edits remain allowed throughout, and the successful hot path allocates no participant or ancestry snapshot. Disposed
groups cannot be reacquired by later attribution. Arbitrary callback throws, including
`undefined`, `null`, and `0`, retain their identity through `onError` and the public shaping throw. The
accepted hook also preserves that retirement value if reentrant notification changes hierarchy and the following initial
transform synchronization throws: synchronization errors surface when no earlier publication failure exists, and failed
initial synchronization remains pending for a later publication retry. The historical `Text.error`/`TextGroup.error`
getters still return `undefined` for both no error and a thrown `undefined`; internal presence state keeps `commitState()`
and later replacement/clearing deterministic without expanding that public API. Final renderer teardown after a throwing
Three disposal listener remains an inherited total-cleanup limitation owned by a separate follow-up; this publication
correction does not broaden into it.

A paragraph's public content box may declare `columns: { count, gap }`, flowing text through side-by-side ordered columns
inside the exact content-box width. Columns fill in order without balancing, so the final column may run short, and an
exact `width` is required because the column advance is derived from it. Internally, Rust already retains bounded rectangle
or polygon regions and exclusions, subtracts them into multiple slots, and composes fragments through sequential regions.
The shared public `TextFlow` surface now admits ordered keyed rectangle or simple-polygon regions, keyed rectangle or
simple-polygon exclusions, margins, and every existing wrap side in paragraph-local inline/block coordinates. Admission
normalizes coordinates to their exact finite f32 wire values, rejects duplicate keys, degenerate or self-intersecting
rings, and freezes normalized state before it reaches the retained planner. Stable keys mint entity IDs independently of
array order, and unchanged entities retain their own geometry revisions when one sibling moves or the flow order changes.
The Three integration binds this renderer-neutral description to the paragraph transform; React forwards the same model.
Exclusion membership is explicitly authored per region. Projection helpers return normalized exclusion values but never
attach them globally: an application may add one projected object to selected columns, omit it so another column renders
behind the object, or project separate copies into different Text-local frames.
The retained Rust geometry authority remains unchanged, zero-exclusion paragraphs allocate no exclusion arena, and the
first nonempty exclusion set reserves 16 retained entries before ordinary geometric growth. Three's former one-exclusion
feature cap is removed without coupling entity capacity to the separate slot-output limit.

For retained exact-width, non-ellipsis flow with stable region/exclusion topology, moving any number of exclusions in one
region now unions their old/new block bounds and margins into one dirty band. Rust retains every preceding line, resumes
the existing band composer at the retained source cursor, and waits until it crosses the complete future dirty horizon
before accepting an exact line/fragment/slot suffix certificate. Structural, cross-region, flexible-width, and ellipsis
changes fall back to the cold authority. Edit-driven and exclusion-driven convergence share one eligibility check, flow and
drop-cap context builder, retained-suffix publisher, and font-resolution input; their stopping rules remain explicit because
an edit follows prior line slots while a dirty exclusion must cross its future block horizon. Drop-cap paragraphs use the same
path: the core rederives the cap from current
run geometry, reapplies its cut while recomposing the dirty band, realigns baseline-aligned caps from the retained or new
first body line, and accepts the suffix only when it matches the cold authority. The remaining projected-object and
drop-cap matrix belongs to
[Milestone 12's fragment-relative reflow plan](../planning/fragment-relative-reflow.md); balanced columns remain deferred.

The Three subpath exposes `projectTextFlowBounds` and `projectTextFlowSilhouette` for projected-object flow. The bounds
helper computes the exact convex intersection of a conservative transformed `Box3` with the camera-side text-plane and
camera-frustum half-spaces. The silhouette helper accepts an ordered finite object-local `Vector3` ring, clips its edges
through the same half-spaces, and preserves a validated simple concavity when projection inflation is zero. Both helpers
ray-project their surviving geometry onto paragraph-local inline/block coordinates, clip and f32-normalize the result,
and return an ordinary keyed `TextFlowExclusion`; declared projection error conservatively expands the result through a
convex hull. Geometry wholly behind the text plane produces no exclusion. Neither helper reads depth/GPU pixels nor
claims hidden-surface or material-coverage exactness.

The shared paragraph layout surface also admits a same-source `dropCap` with a bounded line span, cap-height text-top or
baseline alignment, logical side, inline/block margins, and an optional caller-authored simple contour normalized over
the generated cap exclusion box. Text-top alignment uses the shaping face's retained OpenType `sCapHeight` against the
surrounding stack's first available font and synthesizes `.66em` when the metric is absent; line-box leading therefore
does not lift the initial above the body cap line. Rust selects the first complete extended grapheme and extends through
the first shaping-safe cluster edge within the bounded search; when no safe edge exists it disables the cap rather than
splitting shaped content. The selected prefix keeps its authored shaping/style/raster data, is positioned by the same
glyph authority as the body, and becomes an additional conservative glyph/design-bounds cut before body composition.
Body flow resumes at the exact retained cluster edge, while measurement, inspection, and Three realization merge the cap
into the first logical line without duplicating source glyphs. Focused evidence covers a combining-mark cap, RTL logical
side mapping, safe-edge refusal, an explicit multi-line region with another exclusion, and incremental exclusion movement
matching a cold rebuild for both text-top and baseline alignment. Same-length edits inside the cap source now rederive
the cap, recompose through every cap-affected band, and retain the exact cold-equivalent suffix once the line state
converges. When a contour is present, Rust intersects it with each body-line band and conservatively reduces the result
to the logical-side inline cut while preserving cap placement and source ownership. The refreshed live Editorial contour
matrix passes all twelve raster/backend/shader cells with three retained draws; the complete caret/selection interaction
matrix remains Milestone 12.4 work.

## Renderer Codec

Each portable raster format registers a schema, Codec-body factory, and cold font compiler through the root package. Three
registers only the renderer half—resource realization and material creation—then assembles the complete Three Codec
program from the portable body. Rust validates and interprets the compiled Codec; it never invokes a JavaScript callback in
shaping, layout, or packing. Cold resource selection receives explicit `(glyphIndex, strikeIndex)` coordinates; the
compiler alone lowers them into the strike-major wire table. Three validates declared reserved supplied-geometry
semantics when a variant registers, then validates every retained payload attribute when a font is bound, before device
realization. Material contexts retain the discriminated `PortableResource` union rather than erasing typed payloads
to `unknown`.

The existing scalar and SIMD Codec loops own initialized register/output scratch for one invocation, reusing it
across records or four-record groups. Validated def-before-use, complete store coverage and reverse dependency masks
ensure every active read observes a definition from the current record/group; inactive scratch is not emitted.
The scalar helper owns its loop and is called only for a nonempty tail; SIMD scratch is initialized only when a group
exists. No scratch crosses calls or programs. The current finite predicate, preflight, output ordering, error prefix,
padding and partial-buffer rules remain. This changes repeated initialization work, not the executor, wire format or
semantic authority. Candidate shipping byte/error oracles and package/downstream/browser checks pass. Optimized scratch clears sit
outside all executor loops, and the compiled frame remains1536 bytes. Memory observations and same-method size
checks are recorded; elapsed acceptance remains open for the
[current wave](../log/2026-10-20-held-codec-scratch-request-wave.md).

CPU reference renderers and allocation diagnostics may pair `compileRasterFont()` with `readCompiledRasterFont()`.
The authenticated read-only view resolves schema field names, strike rows, selected resources, and portable payloads
directly from the compiled binding. It does not expose raster-format-private decoded font data, perform another raster
decode, or copy the binding's scalar value tables; ordinary renderers continue through their bound command-buffer view.

Portable resource declarations select `one` or `many` cardinality. Fixed-member groups carry synchronized leaf buffers
and textures under one retained identity; groups cannot nest, geometry cannot repeat, and every resourceful schema names
the primary render resource used by the command-buffer primitive. Bitmap repeated strikes, MSDF atlas/range companions, and Slug
repeated page groups all compile through this contract. Capability profiles contain capabilities only;
`compileCodec()` assigns their nonzero wire IDs by descriptor order, and ordinary single-profile frames omit the
selector. Codec registration rejects a selected program when its declared buffers exceed the capability set's
`maxBuffersPerDraw`: glyph selection prefers an exact set binding over the wildcard for the same technique and variant,
while decoration selection retains declaration-order first-match behavior. Raster program assembly reports the same
limit as a `RangeError` and names the system buffers included in the count.

`RasterResourceId` is the authoritative identity of one renderer resource realization. Reusing an ID means the format,
schema role, companion set, metadata, and bytes are unchanged; a Codec must mint a new ID when any of those change. The
handle retains and reference-counts the first payload under that ID without rescanning immutable bytes. Distinct authored
strings that collide after compact wire hashing are rejected once by the handle's `CodecIdScope` before retention.

Codec-authored wire identities are hashed domain/name pairs returned as branded numbers. Module-level Codec and buffer
constants use `id(kind, stableName)`. Handle construction supplies collision-checked identities to `encode()` and keeps
their provenance private. Invalid names or observed collisions throw at the authoring call. Buffer IDs are folded into
the nonzero `u16` ABI range; registration and Codec compilation still reject conflicts. Dense renderer slots such as
`transformIndex` remain explicit compact indices rather than application identities.

The first-party Codec can select indexed transform batching, direct per-draw transforms, or a hybrid. Indexed mode adds a
stable transform-table ID to each rendered glyph so compatible paragraphs may collapse into one draw. Direct mode splits
draws by transform for integrations that prefer ordinary object matrices. Physical glyph records use direct logical order;
the pre-alpha stable-indirect allocation experiment and its renderer order buffer are retired under D-362. Stable glyph
identity and placement generations remain independent CPU authorities. A paragraph always batches its own spans, so no
root policy states draw order.

`materialId` is explicit through the frame ABI and command buffer. Three maps it to a `defineTextMaterial()` factory. Material
identity may split draws without forcing a second copy of the canonical glyph buffers.

MSDF material shaders publish `fillDistance`, `trueDistance`, and `pixelRange` alongside their coverage outputs (D-365).
Both Three configurations use the same `TslMsdfShaderOutput` type; raw TypeGPU `msdfFragment()` and
`msdfRenderDetailed()` return the corresponding numeric fields. The private TypeGPU reconstruction supplies one set of
distances to coverage and custom effects. `msdfCoverage()` retains its coverage-vector return contract. The
[material reference](../planning/three-api.md#msdf-distance-fields) defines units, sign, and effect limits.

Slug material shaders publish `coverageAt(coordinate)` beside `coverage`: the same analytic integral at an em-space
coordinate the material chooses, so a material can bend the letterform by integrating at the inverse of a warp.
`coverage` is `coverageAt(renderCoordinate)`, and both Three configurations publish the same `TslSlugShaderOutput` type.
The [material reference](../planning/three-api.md#slug-coverage-at-a-coordinate) states its footprint, quad, and cost
limits. The compose stage of `benchmark:v1-bitmap` proves on WebGPU and WebGL2, in both configurations, that
`coverageAt(renderCoordinate)` matches the default draw byte for byte and that a coordinate past every outline draws
nothing. Its nonlinear Inter rectangle case also checks a changing coordinate footprint against an independent
pixel-area oracle; a control that keeps warped roots but evaluates original-coordinate derivatives fails that assertion
in all four backend/configuration cases. The material reference scopes derivative AA as a local approximation for
smooth mappings, with the usual derivative control-flow restrictions.

Bitmap atlas pages within one strike are renderer layers, not independent draw resources. The font binding exposes one
strike resource, the Rust Codec program writes the selected page as one u32 instance lane, and Three uploads the strike as one
R8 texture array. This preserves authored glyph order while preventing page transitions inside ordinary prose from
splitting a paragraph into hundreds of draws. The multi-page integration fixture asserts one ordered draw and a live
Chrome run reduced the sampled Paragraph Stress CPU frame from roughly 80 ms before the correction to 0.47–1.3 ms after
it; the sampled GPU frame remained a separate 1–5 ms concern.

## Font fallback and raster formats

`createFontStack()` accepts fonts from one runtime in explicit fallback order. Members may use different raster formats.
The font carries both shaping identity and raster binding, so `Text` has no redundant format property. Rust resolves the
font for each cluster and partitions the command buffer according to the active renderer's supported Codec programs.

This permits an MSDF or Bitmap prose font to fall back to a Slug emoji font while keeping third-party renderers safe: an
unregistered raster format fails at the Codec boundary instead of producing an unsupported draw.
A public compiled-Wasm integration loads Bitmap Inter plus Slug Font Awesome, shapes one paragraph through that ordered
fallback stack, and observes two Rust-planned draws with exact Bitmap `vec2` and Slug `vec4` physical records. The
selected font binding—not a `Text` format selector—carries the renderer program and resource.

Raster formats explicitly declare the text effects their portable Codec and shader implement. MSDF supports outline and
shadow; Bitmap and Slug currently support neither. Three and root-configured integrations validate
the selected font formats at the call that accepts a style, so an unsupported effect cannot become a malformed or
silently degraded command buffer. The semantic ABI carries effect color, width, offset, and inherited opacity only for
raster programs that opt in.

Built-in raster pages use a package-owned KTX2 reader limited to the native formats the Bitmap, MSDF, and Slug contracts
admit. One pass over the external bytes checks the identifier and restricted header before reading the single admitted
level index, then validates safe 64-bit section coordinates, declared byte ranges, one basic data-format descriptor in
place, exact dimensions and payload size, channel semantics, and the absence of supercompression or auxiliary metadata.
An unsupported level count fails at that variant gate without parsing unused mip indexes. The reader constructs no
general container, level array, descriptor object, or sample arrays; its only result is a zero-copy view of the validated
base payload. The general `ktx-parse` package is a development-only independent oracle for these checks; it is not a
production dependency or a shipped runtime module.

The first native-reader pass at `ee2af476f`, measured at the corrected same source path against baseline `2ab37fdac`,
moved the focused reader graph from 12,109 raw / 8,791 minified / 2,668 gzip bytes to 6,611 / 6,501 / 2,233, reductions
of 5,498 (45.40%), 2,290 (26.05%), and 435 (16.30%) bytes. The complete peer-externalized Three Bitmap and MSDF graphs
each removed 5,422 raw / 2,184 minified / 592 gzip bytes; Slug removed the same raw and minified bytes and 593 gzip
bytes. The core root entry is byte-identical and does not reach a KTX reader in either its initial or complete graph.
These JavaScript measurements compile revisions with identical pinned configurations at the same stable path, include
every selected dynamic chunk in the complete graph, and exclude Wasm and optional peers; they are measured production
closures, not install size or a Bundlephobia estimate.

The in-place payload-reader pass at `e03de5a4f` reduces that first native reader from 6,611 raw / 6,501 minified / 2,233
gzip / 1,929 Brotli bytes to 4,409 / 4,303 / 1,577 / 1,370: another 2,202 (33.31%), 2,198 (33.81%), 656
(29.38%), and 559 (28.98%) bytes. Relative to `2ab37fdac`, the focused closure is 63.59% smaller raw and 40.89%
smaller gzip. Complete Three Bitmap, MSDF, and Slug graphs each remove another 2,438 raw / 2,402 minified / 705 gzip
bytes; their Brotli reductions are 516, 422, and 626 bytes. The root graph remains byte-identical. Initial Three graph
raw and minified lengths are unchanged because the KTX reader is lazy; compression can move slightly when dynamic-chunk
references change, so the complete graph is the application-facing comparison.

The package-owned `glyph:ktx-runtime-performance` workflow compares the successful path of `ktx-parse` 1.1.0 plus the
exact Glyph native-image policy from `f97d17be5` with the bounded reader at `1959e9982`. It authenticates and extracts
all twelve KTX2 pages from the checked-in Inter Bitmap, MSDF, and Slug LFS artifacts before timing. Its six-format suite
uses one real R8, RGBA8, and RGBA16F page plus independently serialized BC4, EAC R11, and ASTC containers because the
repository has no compressed KTX2 fixture. Both implementations must return the same payload bytes, buffer, and byte
offset. On Node 24.18.0 and Apple M2 Pro, fresh-process module load plus one real R8 validation measured 2.024 ms for
`ktx-parse` and 1.033 ms for the native reader, a 1.96× speedup excluding process launch, fixture work, and I/O. Warm
medians were 545.7 versus 120.9 ns/validation across six formats (4.51×) and 595.8 versus 133.1 ns across the twelve
real pages (4.48×). V8 allocation sampling over 120,000 six-format validations observed 2,443.3 versus 196.7 sampled
bytes/validation, a 91.95% reduction; this is statistical profiler evidence, not an exact language-level allocation
count. The workflow serializes its complete measurement through `/private/tmp/glyph-perf-measurement.lock`.

## Glyph outlines

Glyph geometry for colliders, extrusion, or other CPU consumers is core-font data, not raster data ([glyph outlines](../planning/decisions/glyph-outlines.md)).
`glyph bake --outlines` and Node `bakeFont({ font: { outlines: true } })` keep the face's own outline tables, `glyf`
with `loca` or `CFF `, unchanged in a small SFNT beside `head` and `maxp`, stored as one optional `PMNDRS_font.outlines`
buffer view. The object's presence is the flag, and the CLI's up-to-date check treats a change of flag as stale. The view
is outside `shaping.fingerprint`, so outlines change no raster's compatibility. Only an outlined bake writes
`PMNDRS_font` version 1; a bake without outlines still writes version 0, byte-identical to earlier bakes. A face without
outline tables, such as a bitmap-only face, fails an outline bake with `MISSING_TABLE`, and a CFF2 face fails with
`UNSUPPORTED_OUTLINE_FORMAT`. Outlines cost about the face's own outline tables: 0.46 to 0.94 times the source file
across the fixture faces (Inter adds 226 KB to 412 KB; Noto Sans CJK JP adds 15.5 MB to 16.5 MB).

An outline describes a glyph ID of a font, not one placement, in em units (1 is the font size) with y down and the
origin at the pen position on the baseline, like every box the layout publishes. A caller places a point at
`glyph.x + ex * glyph.fontSize`, `glyph.y + ey * glyph.fontSize`; equal `fontHandle` and `glyphId` mean equal outlines, so
a caller can cache one shape per key. A fallback glyph reads from the font that shaped it. Every read path throws a
`TypeError` for a glyph whose font has no outlines; outlines are optional today and planned to become required.

- **Borrowed:** `text.readGlyphs((glyphs) => glyphs.outlineAt(index, target?))` returns a `GlyphOutlineView` of
  `fontHandle`, `glyphId`, and typed-array views over the font's decoded store: endpoint-shared `points` (segment `s` of
  contour `c` uses points `2s + c` through `2s + c + 2`), `contourEnds` (exclusive end of each contour, as a segment
  index), and `segmentLines` (`1` for a line, `0` for a quadratic). A `target` is refilled and returned, which saves only
  the holder. The views are documented as valid only inside the callback, which keeps the freedom to back them with engine
  memory again.
- **Owned:** `text.glyphs().outlineAt(index)` returns caller-owned `GlyphOutlineContour[]` of
  `[x0, y0, cx, cy, x1, y1, isLine]` tuples built from the same store, so both paths agree. It is a non-enumerable method
  on the copied inspection, so the columns still spread, compare, and structured-clone as plain data. The copy keeps its
  fonts' stores, so a read makes no engine call and survives the font's and the handle's disposal. A glyph's frozen tuples
  are built on first read and shared by every later one.
- **Detached:** `Glyphs.outlineAt(index)` answers `text.glyphs().outlineAt(index)` from the inspection `split()`
  retained ([detached glyph copies](#root-assisted-detached-glyph-copies)).

A line keeps its midpoint as its control point, so code that ignores the flag still draws it. Contours keep the source
order and winding for nonzero filling, and blank glyphs return no contours.

**Decoding.** The shaper decodes with read-fonts, which HarfRust already links: TrueType simple and composite glyphs
follow Skrifa's FreeType-style unscaled loader, and CFF uses read-fonts' charstring evaluator. A TrueType glyph nests
composites at most 32 levels deep and places at most 65,535 components and 65,535 points, so a crafted font cannot make a
decode unbounded. TrueType outlines are exact; each CFF cubic becomes Slug's `DEFAULT_CUBIC_SUBDIVISIONS` (four)
equal-parameter quadratics through its shared split, within about 1.15 font units on the CFF fixtures. The decoder writes
em-space `f32` points with the contour ends and line flags into one word-aligned result. The decoder adds 64,956 raw bytes
(24,677 gzip) to `text-shaper.wasm`; Skrifa's outline drawing measured 97 KB gzip in the same shaper and cannot be
trimmed by feature. `font-baker.wasm` draws no outlines: the bake validator decodes every glyph with the runtime decoder,
so a bake cannot ship an outline the runtime would refuse. Variation axes and a runtime-bake outline option are not
implemented.

**Loading.** The loader decodes every glyph behind the load promise, where the artifact fetch already dominates, into one
store the font owns: the columns of every glyph's view back to back plus a per-glyph offset table. A read is then plain
data with no engine memory, and a later outlined bake of a font that first loaded without outlines adds its store to the
deduplicated font. The decode runs in a fresh shaper instance compiled from the module the engine shared, so a
caller-supplied `glyph.init({ wasm })` decodes too, or from the default module when a font loads before the engine
starts. Natively over every glyph: Inter 2,937 glyphs in 3.6 ms to 1.37 MB, Source Serif 4 2.1 ms to 0.85 MB, Font
Awesome 3.9 ms to 1.62 MB, Amiri 6,710 glyphs in 13.3 ms to 5.06 MB, and Noto Sans CJK JP 65,535 glyphs in 757 ms to
129 MB. The planned triplet stream (#244) replaces this with a faster decode into a smaller i16 store.

**Evidence.** Rust tests compare every glyph of all nine fixture faces, TrueType and CFF, segment for segment with
Skrifa, including composites rewritten to matched-point anchors and scaled offsets and contours that start off-curve, and
check the endpoint-shared layout, contour ends, line flags, midpoint controls, and em-space y-down points of Inter, Font
Awesome, and Dancing Script. Composites that multiply their components or points past the bounds are refused, and
corrupted `glyf`, `loca`, and `CFF ` tables fail without panicking. The validator rejects an outline SFNT that is out of
profile, misidentified, or undecodable. Three Text tests place every TrueType glyph's outline at its pen position and
size against the layout's ink box, check every CFF on-curve point against it, check the baseline at two font sizes and the
view's layout invariants, compare owned tuples with borrowed views, read a font-stack fallback glyph from its own font,
survive Wasm memory growth, and read identical outlines from Bitmap and Slug. A detached `Glyphs` object's outlines equal
the source's at every index, survive a re-layout and the font's disposal, and reject indices outside the object.

## Semantic queries

`ParagraphLayoutSummary` now carries primary-face line font metrics (including cap height/x-height and explicit
font/fallback provenance), computed alphabetic/ideographic references and cap/x-height top positions. Paragraph-level
references select the first line; first/last baseline fields retain their independent line-selection meaning. The
[layout-query contract](../planning/core-api.md#layout-query-values) defines spacing, mixed-style aggregation, deterministic
missing-OS/2 fallbacks and the distinction from OpenType BASE. These bounded aggregate values do not require glyph
positioning or ink inspection.

`constraints.anchor: { x?, y? }` and the measured `anchorOffset` establish renderer-neutral box placement while retaining
unshifted paragraph coordinates. Property composition stays shallow; the caller spreads a prior nested anchor when
retaining an axis. The core resolver and cache metadata own reference arithmetic. Three, React and Vue apply the offset
through host transforms and interaction geometry; TypeGPU composes it with the existing position uniform. Both hosts
preserve accepted placement during pending/rejected semantic updates. Three permits its host-only placement shortcut
only while the resolved material, presentation and order match the last accepted publication, with no pending material
invalidation or renderer rejection. Root/group presentation changes do not advance Text's desired revision, so that
revision alone cannot authorize an anchor commit. Live host/group transforms still apply to accepted geometry.
Ordinary paragraph anchor-only changes reuse line records
and avoid a layout engine query; explicit flow bindings retain their geometry-invalidation path, and explicit
invalidation/retry semantics are unchanged.

The [Three coordinate contract](../planning/three-api.md#measure-desired-layout-and-inspect-positioned-glyphs) separates
raw paragraph queries from anchored Text-local queries and detached Glyphs-local snapshots. Split siblings preserve
per-glyph world transforms and the source local transform/pivot under transformed ancestors and matching later group
motion. Captured anchoring belongs to local content, not the copied container transform. `Glyphs.measurements` records
original owner-local geometry, while matrix accessors report subsequent animated transforms. Desired
queries remain distinct from accepted draws during pending/rejected publication.

The semantic reader bounds its native `DataView` to the publication once, retaining native scalar bounds checks and
whole-table range validation without repeating JavaScript range validation for every metric field. Adjacent lines with
identical font metrics share one immutable strut value; mixed authored metrics remain independent. Three rejects the
anchor-only shortcut immediately when the anchor identity is unchanged, before comparing accepted presentation.

The compiler-owned query record grows from 76 to 84 bytes for two shifted height references. Four spare line-record
fields carry font ascent/descent/cap height/x-height and line flags carry fallback provenance. Render/Codec records and
default publications do not grow. Explicit glyph inspection also pays the eight-byte record increase; ordinary
`measure()` remains proportional to line count and copies no per-glyph arrays. This incompatible semantic query change
uses [shaper ABI 1](../planning/decisions/shaper-abi-1.md), with an exact version bootstrap before module initialization;
unversioned modules and mismatched revisions are rejected. Failed public initialization retains its existing fatal module-lifetime contract.

Same-source dropped initials contribute cap/x-height dimensions, provenance and absolute top references to the first
logical measurement line, while the body strut continues to own ascent, descent, leading and baselines. Baseline and
text-top alignment are covered independently with authored Inter/Amiri fonts.

Caller-authored styles enter one validating snapshot producer. The existing property ownership registry distinguishes
ordinary frozen snapshots from validated immutable styles; the existing span registry records feature-scope validation
only after cluster alignment and feature validation succeed. Font/material mapping inherits that authority only when
bounds and style identity remain unchanged. Three and planner consumers reuse that producer authority rather than
walking the same feature schemas again. Changed text length or scope still validates absolute feature ranges synchronously;
a defaulted end before an explicit start is rejected before mutation. No end-to-end speedup is established yet.

Disposed text retains its desired binding leases in the existing removed-state entry until publication consumes its Rust
paragraph removal, or root teardown destroys the Rust root. Public disposal is terminal before this internal retirement
fence. A later setter can consume pending Rust removals without releasing bindings still protected by the publication
lifetime. An empty Three host retains its existing publication adapter until explicit root teardown; it can settle
pending Rust removals and publish later additions through the same executor. All four last-label retirement cases pass.
The [assignment plan](../planning/retained-text-assignment.md#lifetime-state-machine-and-ownership-fences)
records the ownership claims and separate preparation, compilation and renderer-acceptance transitions. The earlier
expanded authoring/framework/Three lane passed 178/184 before the publication correction below; its six failures were
indexed/direct patch-only width reflow and multi-set cold-renderer equivalence, including their parent tests.

The subsequent local Rust publication correction retains gather-cache ownership across semantic preparation and carries
placement identities plus unpublished semantic masks through the same positioned arena. Masks clear at publication
commit; order-only reuse requires no pending prepared changes. All 331 Rust unit tests, the full Wasm build and the
184-test authoring/framework/Three lane pass, including retained width-only draws, multi-set cold-renderer equivalence
and prepared paint/metrics plus sibling reordering. Labs remain pending. This does not clear the branch for landing.

Integration of main `9cbee175` retains its accepted-error attribution and retirement flow. A failed root recipe preserves
its error before planner creation; 152 focused Three/engine tests pass. The broader diagnostic run passed 967/970 Node
tests. Terminal cleanup after throwing renderer disposal is now corrected and all 16 FontFace/controller tests pass on
the rebuilt package. The clipped-inspection correction replaces the unversioned intrinsic positioned scratch with an
ordinary accepted/pending inspection stage: measurement and borrowed glyph demand select the same prepared revision;
abort restores its previous selection and glyph records. Its real-shaper commit/abort/retry regression passes. The full
package build succeeds and all 28 focused FontFace/unsafe-break tests pass, including retained-versus-cold clipping,
ellipsis, changed text, max-lines and empty text. The fresh integrated run passes all 971 package/integration tests,
all deterministic fuzz and font-baker lanes, strict TypeScript checks and TypeScript linting. After formatting and
Clippy corrections, the final full built-package check on `dd937d3b` exits successfully, including all 11 Rust crate
Clippy gates. An unused production measurement wrapper is test-only; production retains one encoder. All 34
placement-filtered Rust tests pass. The expanded multiline indexed/direct cold-renderer sequence also passes within
the 131-test Three lane. Scoped review finds no introduced actionable correctness defects. Diagnostic paired profiles
still show root-size-dependent preparation and publication work; see the [stable checkpoint](../planning/retained-text-assignment.md#stable-checkpoint-and-xi-integration-boundary--2026-10-09).
Focused Labs remains pending. This does not clear #247 or justify landing the preparation branch.

Publication emits no semantic readback by default. Creation and every changed bound setter synchronously commit the
current Rust preparation and a fixed-size measurement sidecar before returning; renderer-plan revision, publication
generation, and acknowledgement do not advance. `Text.measure()` and `measureInk()` read that cache.
`Text.readGlyphs()` borrows selected records directly from the same prepared positioned arena. Repeated dense demand promotes the existing inspection storage before the next callback; sparse demand remains sparse. `Text.glyphs()` returns independent caller-owned columns from the shared inspection producer. Reads do not reconstruct text/style/geometry input, prepare
another semantic candidate, traverse matrices, realize renderer resources, or publish.

Three's private placement queries use this same core-owned inspection, rather than a separate revision-keyed cache.
Core readiness also requires the accepted publication checkpoint to match the current checkpoint: a derived-root
rebuild can replace glyph identities without editing an unchanged sibling. Outline readers are attached once to owned
columns; public inspections still copy those columns, and split copies its layout into independent storage. The
unchanged-sibling regression covers direct split before and after recovery publication following a fault after real
preparation; the pre-correction package fails both sequences with stale selection identities.

The profiled assignment cleanup keeps the existing property-equality walker but allocates graph correspondence only
for nested objects, preserving cycles and alias topology. ID hashing streams the same UTF-8 bytes through bounded
synchronous scratch instead of allocating a byte array per identity; seeded malformed-surrogate/boundary tests and
existing collision fixtures preserve the wire contract. Resolved text ownership adopts the producer's acquisition
ledger directly, retiring a second full span walk and its temporary arrays. The same ledger handles partial cleanup
and lifetime release; no second owner or rollback representation is introduced.

Integration authors can pass one package-produced `GlyphLayoutInspection`, its source text, and renderer-owned drawn
origins to `/core`'s `createGlyphPlacements()`. The resulting read-only placement view exposes cluster-aware carets and
selection geometry without making private modules public or creating a second layout engine. `caretForOffset()` maps a
UTF-16 selection-collapse offset to the leading edge of its owning shaped cluster: interior surrogate and combining
offsets pin to the cluster start, and an ambiguous bidi boundary chooses that cluster's leading affinity. A soft-wrap
boundary starts the following line; offsets in an LF or CRLF gap remain at the preceding line end. Three mirrors the
same query on `Text`.

A same-build isolation over one 21,805-glyph paragraph measured 0.002 ms for an unchanged publication, 0.174 ms for the
aggregate measurement sidecar, and 0.582 ms for full glyph inspection. Three requests only aggregate measurement and
only while it has changed text to publish; an idle synchronization does not enter the engine. Default renderer-neutral
publication therefore pays no semantic-sidecar cost, while renderers that need same-frame bounds pay the explicit
per-publication cost instead of making a second Wasm query.

[#299](https://github.com/pmndrs/glyph/pull/299) supersedes
[#240](https://github.com/pmndrs/glyph/pull/240)'s publish-on-read implementation. Three's existing measurement, glyph,
placement, caret, and selection methods answer from current desired layout through the shared paragraph query/cache.
`split()` copies that desired layout into independently owned renderer objects. These calls leave source publication
pending, preserve public signatures and ABI, and do not publish unrelated labels. Matching prepared results are reused
by the next ordinary publication; this change does not resolve the remaining whole-root publication work in #247.
Unchanged semantic reads reuse their bound controller without resolving renderer presentation. Placement and copy reads
resolve desired presentation before using renderer geometry. Pending copies apply desired draw order while retaining
the accepted draw offset within a shared batch.
Each successful query accepts its prepared identities in Rust before returning. The glyph-ID high-water mark advances
with that accepted preparation, so an ID exposed by measurement or inspection cannot later be assigned to a sibling.
Independent copies resolve selections from the same accepted positioned records. Pending placement reads use the
shared inspection cache; committed placement reads retain their Three cache. Query and copy operations do not publish
renderer state or release an in-flight renderer-owned frame.

Queries carry pending paragraph creations and ordering changes even when the queried paragraph is already committed
in Rust. A rejected first renderer publication followed by an over-budget sibling therefore remains queryable: reads
and independent copies do not acknowledge the rejected source or publish the sibling. Canceling an unqueried creation
clears the structural flag when the existing pending-paragraph/removal counters prove the root is clean, so later
copy queries do not resend neutral lifecycle rows.

Every `measureParagraph` call is one synchronous preparation and acceptance. Rust validates the complete request before
mutating candidate stage storage, applies the desired lifecycle, and prepares only the queried paragraph through the
same retained executor used by publication. After the result sidecar encodes successfully, `commit_measure` accepts the
prepared stage values and advances the preparation revision before Wasm returns. It does not advance renderer-plan
revision, publication generation, gather state, or renderer acknowledgement. The host copies the result from the
borrowed transport before its next Wasm call.

There is no cross-call speculative transaction, input-fingerprint adoption path, or later publication handoff. A
subsequent query starts from the accepted Rust preparation and reuses unchanged text, style, shaping, flow, and
positioning state; the unpublished-owner frontier carries accepted changes to a later publication. Pending sibling
creation, removal, and ordering are prepared and accepted with the query's lifecycle, while only the requested
paragraph's semantic mutation is prepared. `copy_glyphs` and `copy_decorations` read these accepted positioned records.

If an unexpected failure occurs after preparation writes begin or the result cannot be delivered, Wasm invalidates the
derived Rust root and surfaces that call's error. It does not restore an undo snapshot, retry the mutation, or return a
stale measurement. TypeScript retains its accepted authored state; the next explicit operation rebuilds the derived
root through the same executor, and the next explicit renderer publication is a checkpoint. Tests verify that this
recovery matches a cold build and leaves renderer-owned bytes unchanged across the failed publication. The paired
`Staged<T>` arenas remain because the candidate is built beside prior input needed for incremental comparison and
reused allocation; discarding a candidate is not a rollback of accepted state.

The semantic values preserve information useful to callers:

- resolved box dimensions remain distinct from intrinsic content extents;
- clipping does not discard off-viewport semantic layout;
- semantic truncation retains visible positioned lines while reporting intrinsic overflow;
- glyph/font identity, UTF-16 clusters, stable IDs, flags, line membership, and positioned origins remain available on
  explicit inspection;
- detached copy requests never mutate authoritative Rust layout or the source planner's acceptance frontier.

## Root-assisted detached glyph copies

`Text.split()` replaces `Text.breakApart()` without a deprecated alias. Existing callers can use the
[archived migration](../../skills/codemod/codemods/2026-09-24-text-split/instructions.md).
The rename preserves the tuple result, source independence, and disposal ownership.

The existing engine borrow gate rejects reentrant setters before planner mutation. A material callback that catches
that rejection leaves the pending split tuple and subsequent publication unchanged.

Placement queries reconcile changed inherited group/root materials before reusing an entry. Copies realize that desired
presentation independently while the source retains its accepted draws. Placement reads after root disposal retain their
existing `undefined` result; `split()` throws when no layout is available.

Public `Text.split()` queries the desired paragraph synchronously and requests independent glyph and decoration subsets
through its owning root, including before the first renderer publication. Rust compacts the
selected paragraph records through the installed Codec into complete checkpoints; it does not expose buffer offsets or
private planning objects for each renderer to reconstruct. Root services synchronously decode each detached copy into its
destination renderer. The query does not advance the source root's revision or publication generation or publish unrelated Texts.
The copy compiler reads the existing prepared positioning stage, uses paragraph-local placement segments for its own
compact slots, and retains the queried Codec identity until ordinary publication adopts the matching preparation.
Placement/caret/selection reads use this same desired inspection cache, retaining it through matching publication;
accepted renderer origins and supplied geometry are used when available. A split derives drawable membership and
geometry from its independently realized target, so spaces remain excluded before source publication too.

Three's `Text.split()` uses both planner requests and returns the frozen tuple
`[Glyphs, Decorations | undefined]`. It preserves the source transform, Codec-defined batching, fallback raster formats,
shared immutable atlas/page leases, and supplied geometry while adding one full affine matrix per drawable record. Its
local methods mirror `InstancedMesh`; world methods bridge physics state to root-relative storage. Bulk world-space
callers update the detached root once, invert its world matrix once, convert each body matrix with
`worldToLocalMatrix()`, and use `setMatrixAt()` so traversal and inversion stay outside the per-glyph loop. Materials and
root-relative resource leases belong to each detached object,
so the pair may outlive the source `Text`, font, and loader without sharing mutable presentation state. The source `Text`
stays live and may continue publishing while detached objects remain unchanged.
`Glyphs` contains only glyphs with render records; blank glyphs such as spaces are excluded. `count`, `glyphAt`,
`measurements`, `outlineAt`, and matrix methods use dense drawable indices, throwing `RangeError` outside
`0 <= index < count`. These indices need not match `text.glyphs()` layout indices. A private source-index column
preserves the relationship for outline reads, while matrices and pivots remain flat per-drawable arrays (`count * 16`
and `count * 2`). Each drawable maps to its physical render record. A `DetachedGlyph` carries three identities: `index` is its position in this detached object, `key` is the
same occurrence across a reflow (the shipped contract, unchanged), and `fontHandle` plus `glyphId` are the same shape: the
plain-number id of the font that shaped it (never reused and not a lease) and its index in that font. Because the
corresponding full-layout index is private, callers must not use a detached index with `text.glyphs()` columns. Equal
pairs mean an equal outline, so a shape built once serves every occurrence. There is no public lookup of a font by id.
`Glyphs.outlineAt(index)` ([Glyph outlines](#glyph-outlines)) reads from the owned inspection
`split()` retained, so like `glyphAt` it is data: it reads after the source re-lays out and after the font or the
`Glyphs` object is disposed. Its origin is the pivot of `setMatrixAt`'s matrix; scale by `DetachedGlyph.fontSize` and
negate y to get the local frame that matrix places.

Decoration passes are not glyph records and retain an independent object and lifetime; tuple slot two is `undefined`
when the committed paragraph has no decoration draws. Three coordinates both roots' draw ranges so underline/overline
remain below glyphs and line-through remains above them without assigning a group-level render order. If either import
fails, `split()` releases everything it created before throwing. Neither path reconstructs child `Text` objects,
installs mutable presentation overrides, creates physics bodies, or infers collision shapes. The detailed ownership and
evidence contract is in
[Planner-assisted detached glyph slices](../planning/detached-glyph-slice.md).

## Wasm memory and copying

The host pins request/result staging views and re-pins after any `memory.grow()`, because growth detaches existing views.
Growth is permitted only at the `pmndrs_glyph_engine_update` boundary. Result capacity is negotiated and retried without publishing a
partial revision.

Batch and paragraph capacities are intentionally separate. Request/result arenas scale with aggregate `TextGroup`
content, while Rust line and text scratch are bounded by the longest paragraph. Feeding aggregate text length into the
per-paragraph line bound multiplied retained scratch by paragraph count: a 684-paragraph recycling regression grew Wasm
memory from roughly 2.07 GB to the 4.29 GB address ceiling in 17 updates. The corrected bound completes 200 update cycles
and settles near 105 MB for that deliberately larger 8,000-glyph fixture. This regression also guards against forwarding
aggregate glyph capacity as one paragraph's text reservation.

The configured-root text prewarm is 64 UTF-16 units and applies to one reusable spare paragraph, not every retained Text.
Active paragraph lanes grow from their actual content and retain their high-water capacity; publication therefore does
not rescan every Text or attempt to resize an already-consumed spare. A 100-root cold probe measured 224.00 KiB per root
at 64 units versus 686.08 KiB at the former 256-unit default, excluding the equal command buffers. The smaller default
keeps more than four times the observed 9–14-unit label headroom while preserving unbounded correctness through ordinary
arena growth.

Retained publication tracks lifecycle, text, style, and geometry invalidation independently. The shared configured Text
controller derives partial updates from each adapter's complete desired state; adapters and renderers do not implement
wire diffing. The shared controller retains the accepted caller identities beside cycle-safe, deeply frozen style,
layout, and constraint snapshots. Reusing the same readonly outer record is an O(1) unchanged signal; supplying a new
outer record compares it with the accepted snapshot and clones only a material change. A nested edit submitted through a
new outer style, layout, or constraint record therefore cannot rewrite history or disappear through `/typegpu` or a
custom `GlyphConfig`. Three's retained authoring model uses the same snapshot utility, and its package-owned records cross
the controller seam without a second clone. Equivalent normalized Three text updates preserve the desired revision and
cached measurements without staging another publication. Explicit font or material assignments still invalidate
publication, including renderer retries after a rejected frame. A plain string replacement reuses its normalized font, transform, material,
style, layout, and constraint ownership. When those accepted input identities return through a content-only update,
normalization skips recursive comparison and cloning; a new outer property record still takes the validating path.
Equal-length content emits only the minimal scalar-aligned text record; length changes additionally republish
root-style coverage. A font-size or paint-only update emits only its style record while Rust remains authoritative for
shaping and layout invalidation. These cases do not republish paragraph membership, scoped order, constraints, regions,
exclusions, or inline-object records; assigning an already-plain string to itself does not advance desired state or cross
the Wasm boundary. Pending style-limit accounting follows the same style-dirty predicate as wire emission. Rust limits
implicit paragraph inference to an empty planner, so a content batch may address several existing paragraphs without
dummy lifecycle upserts. Rust indexes each populated semantic input table by paragraph ID before visiting retained
semantic order, so valid atomic content batches do not depend on the adapter's Set insertion order. The reusable compact
span index is empty on ordinary clean frames and retains its capacity after the first populated batch; glyph, cluster,
and plan record layouts remain unchanged. An omitted authored `maxLines` is encoded with Rust's existing zero sentinel for the root limit,
so ordinary geometry no longer depends on string length. In the 684-label workload this reduces the request from 209,448
to 23,400 bytes and the fresh
same-machine remote-main A/B from 24.24–25.87 ms to final post-review medians of 11.39–11.89 ms while retaining one draw
and 5,362 glyphs.

Bitmap vertex pixel snapping is an explicit immutable Three/R3F option and defaults off. The unsnapped graph uses the
ordinary model-view-projection position so shared-root or camera animation preserves subpixel movement; callers targeting
a pixel-art presentation can opt in without changing shaping, layout, or render-plan records.

WebGPU may alias compatible Wasm-backed typed arrays. Three's WebGL2 PBO path owns a padded array and therefore requires
one retained copy. The architecture does not add complexity to pretend WebGL2 can preserve a Wasm alias it replaces.

Each raster baker's Rust contract generator emits both published JSON and an exact typed TypeScript constant. Bitmap,
MTSDF, and Slug may own different internal ABI shapes—MTSDF exposes both its glyph generator and artifact baker—but their
TypeScript hosts consume those generated constants directly and validate the declared exports once during construction.
There are no instance-ignoring runtime ABI readers. Package builds isolate the distributable MTSDF and Slug
`artifact-baker` feature sets from kernel-only test targets and reject an optimized module missing any contract-declared
artifact export, preventing Cargo's shared top-level artifact path from silently publishing a smaller test variant.

Renderer-facing types that applications can encounter publish from root `@pmndrs/glyph`, including `GlyphConfig`,
`CommandBufferView`/`DisplayList`, constrained root services, and `GlyphRenderer.decode`. Runtime construction helpers
such as `defineGlyphConfig`, Codec authoring, schema binding, raster-format definition, and resource leases live on
`@pmndrs/glyph/core`. D-306 and D-308 retired D-249's engine-driving layer; the current `/core` contains only the
integration construction and renderer-neutral placement-query contract. Internal projection,
identity mapping, planning, settlement, and Wasm transport are package machinery rather than an application or integrator
API. The explicit `/shaders/tsl` and `/shaders/typegpu` subpaths own raster-format shader realizations and no scene, runtime, or root.

The raw borrowed Rust publication and its typed command tree never cross the integration boundary. The engine projects
that trusted wire data through the integration's schema and resource resolver, then calls
`GlyphRenderer.decode(CommandBufferView)`. The bound view is the only renderer input: it preserves authoritative ordered
display-list children and exposes the closed semantic `GlyphInstanceKind` union, while numeric wire identities,
projection state, and publication settlement remain private. An integration therefore implements one host-realization
step rather than selecting or invoking a second decoder.

Projection retains renderer-accepted buffer generations separately from Rust-canonical publication state. When a new
generation replaces an accepted binding, projection emits that accepted binding's retirement through the existing
command list, deduplicating any matching Rust retirement. This also covers recovery after a renderer rejects a resize;
discarded candidate bindings never enter accepted ownership. Candidate maps settle only on acceptance.

Codec authoring similarly exposes only the identity vocabulary an integration can legitimately declare:
`id.buffer`, `id.technique`, `id.program`, and `id.resource`. Numeric identities for installed Codecs, font bindings,
root publications, paragraphs, styles, materials, regions, exclusions, inline objects, and live resources are minted and
validated by package-owned handle state. Their scopes and the capability-set wire selection are unavailable from
`/core`, so a custom renderer cannot accidentally become a second engine-state owner.

Three and `packages/glyph-example-renderer` consume the same public root types and `/core` helpers available to third-party integrations. The
example is the standing second-engine proof: its Codec describes storage, the trusted internal projection supplies one
borrowed ordered view, its renderer stages and commits host objects synchronously, exact identities govern retirement,
and its caller-owned TypeGPU/WebGPU host later submits work. Portable font compilation retains only validated buffer,
texture, grouped-resource, and GLB-like geometry payloads, never renderer objects.

The same reasoning withdrew the `*-abi` and `bakers/*/validate` subpaths. Raw struct offsets and enum numbers remain
package-private implementation data; applications receive semantic values at root and integrations author Codecs through `/core`.
The validator subpaths likewise had no consumer outside this package. Both sets of modules remain reachable by relative
path from package-owned tests and scripts where wire-level verification is legitimate.

The 0.1.0 surface has 14 explicit ESM entry points and 150 distinct runtime export names, down from 40 and 239. There are no positive wildcard exports: adding a source file never
publishes it. Renderer construction shares `/core`, portable format values and their options/data types live at the root, and React components and hooks share `/react`; Three helpers have one home on `/three`.
Shader composition uses one entry per backend, `/shaders/tsl` and `/shaders/typegpu`, with complete stages, their input
schemas, and resource slots/accessors. TypeGPU also retains MSDF coverage/compositing and Slug dilation for custom
materials. Polynomial solvers, band addressing, texel loaders, CPU references, and Three bridge shaders stay private.

The root retains the built-in format objects and public options/data types. `/core` retains their schemas, codecs,
and the few constants/helpers needed to interpret decoded data in custom integrations. Format metadata and descriptor construction are available on the format object. Baker factories remain public;
raw generated ABI objects, validator implementation steps, Worker routing tables, preprojection identities, and legacy
manual-register assembly do not. Explicit config barrels separate supported construction from host-only program
assembly, resource normalization, and schema authentication. The existing packed consumer tests import every supported entry and prove retired paths are inaccessible.

Configured rendering has one publication contract: `glyph.shape()` stages every dirty root, crosses the Wasm boundary
once, and synchronously offers each root's borrowed command-buffer view to its renderer. `CommandBufferView.revision`
is the monotonic revision of that root's Codec-produced command state; `engineRevision` independently identifies the
engine transaction that produced it. The view expires when decode
returns; renderer commit/discard settles the corresponding publication before the batch closes. The removed owned-target
branch copied every publication, resolved a second payload manifest, awaited a separate target, and pooled returned buffers, but
no GlyphConfig integration could use it and it could not participate in the engine-wide shape batch. Cross-realm font
movement remains the explicit lazy `FontFace.clone()` operation; render-plan transfer is not a parallel publication API.
The former direct planner/transport update path is also gone: it had no production caller and would have restored one
Wasm crossing per root beside the staged batch. The example renderer proves TypeGPU and WebGPU realization directly
against the same borrowed Rust command buffer.

The `glyph:static-check` workflow runs the same static implementation used by the full package `check`: strict
TypeScript and emitted declarations, TypeScript lint/format, and Rust format/Clippy for every maintained crate. It requires
a current built distribution and does not rebuild or run tests. The full `check` still runs its complete build and test
lane before invoking these shared static gates.[^glyph-static-check]

## Current correctness evidence

The foundation currently has:

- 237 passing Rust engine tests, including exact retained-cluster, revision-range, immediate line-convergence, and
  later cursor-convergence regressions;
- the package JavaScript/integration gate passing through the single-path public exports;
- exact retained Amiri bidi, policy, ellipsis, clipping, UIKit-layout, and CJK contracts exercised by the browser
  `paragraph-contracts` target through the shared Glyph font graph, public `Text`, `TextGroup`, `measure()`, and `glyphs()`;
- 32/32 pixel-exact public Bitmap WebGL2 frames against the independent CPU oracle, including resize and clipping, with
  zero differing channel bytes and pinned SHA-256 `a47930d3…15e893`;
- source-font SHA-256, registered shaping hashes, and HarfRust/HarfBuzz oracle identities authenticated independently of
  the browser behavior check;
- byte-identical Bitmap, MSDF, and Slug packing/consumer gates retained elsewhere in the benchmark suite;
- a sequence-level property gate (`engine-sequence-property.test.mjs`) driving randomized-but-seeded interactive
  sequences through the public Three surface — text edits, resizes, metric and paint restyles, direction, language and
  feature flips, font swaps, and lifecycle churn, with measure queries interleaved so speculative transactions are opened
  and then adopted or dropped — asserting per step that valid input publishes, that a repeated measurement agrees with
  itself, and that the per-glyph inspection lane and the line-level measurement lane report the same glyph and line
  totals. Determinism is part of the contract: a fixed seed list, no wall clock, no retry, and a failure names the seed
  and operation journal that reproduce it. Reverting the three status-6 fixes (D-255) turns it red at seed 1;
- React paragraph lease accounting under StrictMode and react-three-fiber's idle-deferred disposal, with a positive
  control proving a lease is genuinely held so the silence in the other cases is not vacuous;
- total teardown: repeated group and runtime disposal neither throws nor leaves a font half-disposed, and teardown in the
  wrong order — runtime first, paragraphs after — completes, which is the ordering r3f actually produces.

The browser paragraph target is fully green under the explicit f32 frame contract. The former UIKit mismatch came from a
fixture generated by the deleted TypeScript path, where authored JavaScript-double line height survived until final array
publication. The retained engine deliberately receives that style scalar as f32, accumulates line positions in f64, and
narrows published values once. An independent calculation from the f32 line box reproduces the corrected final baseline,
centered glyph row, content height, and complete layout hash exactly; no runtime precision or tolerance changed.

### MTSDF reference correction and remaining pinch artifacts (issue #145)

The original 63-versus-32 Inter `8` comparison was not a comparison of equivalent edge lists. `ShapePen` always
emitted `#` at contour closure, which tells msdfgen to add a straight closing edge even when Fontations had already
returned to the start. That gave native 44 edges versus Glyph's 41. The three zero-length edges changed corner
detection and coloring. The non-shipping serializer now adds only missing closing edges, with focused tests for
explicit curve/line closure and implicit closure across contours. The native request also carries the CFF contour
reversal applied by `OutlineSource::emit`; omitting it caused the earlier Dancing Script sign failures in
no-scanline experiments. These corrections supersede the earlier native counts and coloring conclusions.[^mtsdf-reference-shape]

With corrected input, both Simple-coloring implementations reconstruct Inter `8` with 63 samples whose absolute
coverage error exceeds 0.25, at 64 px/em, range 8, and 8× magnification. Their reconstruction images are byte-identical.
Its waist artifact is shared by native Simple coloring. The corrected comparison gives:[^mtsdf-quality-inspection]

| Sample             | Glyph | Native Simple | Native Distance | Native InkTrap |
| ------------------ | ----: | ------------: | --------------: | -------------: |
| Inter `8`          |    63 |            63 |              20 |             20 |
| Inter `4`          |    25 |            25 |              25 |             25 |
| Inter `&`          |     3 |             3 |               3 |              3 |
| Source Serif `g`   |    32 |            23 |              20 |             23 |
| Dancing Script `w` |   193 |           193 |             197 |            197 |
| Dancing Script `g` |   201 |           199 |             199 |            194 |

The corrected 26-case corpus totals are 956 for Glyph, 1,032 for native Simple, 988 for native Distance, and 989
for native InkTrap. The 63-to-20 improvement is a measured coloring opportunity, with tradeoffs: both alternatives
regress Dancing Script `w` by four samples and `M` by one. These are native experiments, not a production coloring
change. The CLI's default scanline path disables geometric distance checks; correctly oriented Inter, Source Serif,
and Dancing Script samples have equal auto-fast and auto-mixed counts in this corpus.[^msdfgen-cli]

Separate diagnostic experiments identified two remaining baker differences. Increasing curve-winding subdivision
from 16/24 to 1,024 removed a one-texel inside/outside classification error in Source Serif `g`, changing 32 error
samples to 27. Allowing inversion correction on protected texels changed Dancing Script `g` from 201 to 199;
combined with denser winding, Source Serif `g` reached 23. These outputs matched native reconstruction.
These are investigation findings for future fixes; the temporary instrumentation is not retained, and 1,024
subdivisions are not an accepted production implementation.

Run `mise exec cmake@4.4.3 -- pnpm scripts run glyph:mtsdf-quality:inspect -- --all` for the complete corpus,
or omit `--all` for the reported Inter/Dancing Script samples. Optional `--font <fixture-relative path> --chars <text>`
selects another sample. The workflow writes measurements, PPM comparisons, and a self-contained HTML report under
ignored `packages/glyph/.cache/mtsdf-quality-inspect`. Chrome screenshots display CPU reconstructions, not GPU-renderer
verification. Once the native oracle is provisioned, ordinary `mise exec -- pnpm scripts run ...` suffices.

`mise exec -- pnpm scripts run glyph:mtsdf-quality:check` runs the closure regression tests and existing production
quality checks. This change fixes the reference comparison; production kernels, shaders, goldens, and baked assets
are unchanged.

[^mtsdf-quality-inspection]: Package-owned native variant inspection workflow and generated measurements.

[^mtsdf-reference-shape]: The reference outline serializer, its closure regressions, and the independent CPU reconstruction.

[^msdfgen-cli]: msdfgen 1.13 `main.cpp`, scanline defaults and post-generation error-correction configuration.

Direct TypeGPU text owns its position coordinates separately from semantic text state. Position-only updates write the
uniform without staging a semantic publication; unchanged coordinates do not write it again. Mixed updates validate
and stage semantic changes before moving the uniform, so rejected caller input preserves the accepted position.

Planner frames are prepared as validated records and written directly into the retained Wasm request arena, including
paragraph queries. The single UTF-16 payload loop packs two code units into each little-endian 32-bit write,
with one 16-bit tail for odd lengths; its helper receives only the destination view, payload offset and text, and
allocates no intermediate text buffer. The writer respects the arena view's
byte offset and clears reused storage before encoding. The transport reuses only primitive payload-offset scratch and
exact-memory-bound request/header views; it releases encoded language references after each synchronous write.
Prepared descriptors stay call-local, and issued publication identities remain independent and epoch-checked. Query
requests retain minimal text mutations; removal requests include only paragraphs previously published. Output growth
invalidates prior borrowed results and rewrites the request before retrying, preserving the existing acceptance fence.

Complete public text assignment still compiles to at most one scalar-aligned UTF-16 replacement; JavaScript does not
allocate a precise edit table or expose a separate edit API. For a same-length replacement, the retained Rust engine
compares accepted and candidate UTF-16 two units at a time within that validated replacement range, keeps identities at
equal positions, and records only the changed islands for downstream invalidation. One logical-order traversal of the
retained clusters derives every dirty window and glyph cursor for both LTR and RTL runs. One scope-driven executor then
handles bounded windows or a whole run and collapses its chunks back into the canonical retained shaped run. Window
splicing is admitted only when retained and new HarfRust `UNSAFE_TO_CONCAT` flags prove the boundaries safe with full
source-run context; font fallback, unsafe boundaries, topology changes, and unequal lengths use the broad scopes or
existing fallback pipeline. The existing canonical cluster comparison also produces coalesced layout dirt when source
coordinates, counts and safe boundaries remain compatible. The shared flow/placement executor uses those intervals to
retain converged clean line islands; shaping windows no longer independently determine layout invalidation. Missing
correspondence, unsafe corrected boundaries, changed base direction, geometry/metrics or ellipsis retain full flow.
Candidate dirt is revoked on abort, adoption and explicit reset, with scratch capacity retained. The block/line summaries
and rope consumers remain in the existing pipeline; strict numeric-basis proof still limits retained placement reuse.
After exact cluster-coordinate admission, the shared comparison trusts the resolved-style producer's unchanged-metrics
proof instead of resolving geometric styles again. Whole-run text/unit identity remains authoritative; changed-cluster
text uses checked absolute slices, with source direction/script/bidi still compared against the actual shaping runs.
Public Three integration coverage repeatedly assigns full
strings through `Text.set`, publishes both retained and freshly created `Text` objects, and compares every public semantic
glyph and line column except retained glyph identities across safe-boundary RTL, ligature/combining/bidi/surrogate risk,
font-fallback entry and exit, and renderer rejection followed by explicit retry. A two-paragraph lifecycle regression
also expands one public `Text`, performs a sparse full assignment, shrinks it through surrogate and scalar values, changes
its layout, and proves an unchanged constrained sibling still measures and publishes normally.

## Legacy-path and duplication audit

The Rust command buffer is the only glyph-packing implementation. Rust is also the production authority for Unicode
analysis: the generator emits the compact Script/Script_Extensions and line-break tables consumed by the shaper, and
the full TypeScript paragraph analyzer has been retired. Rust also resolves authored rich-text span ranges against its
grapheme boundaries before shaping, so no production JavaScript grapheme segmenter or range-provenance cache remains.
The independent Unicode 17 grapheme oracle is test-only; mutation tests also keep a test-only line-break oracle so their
expected topology is not derived from the engine under test.

The former TypeScript `RasterRuntime`, raster
candidate/commit transaction, `select`, `createStorage`, and `writeStorage` surfaces are deleted from production source
and public exports. Current raster formats own identity, artifact decoding, retained CPU resource data, and disposal;
Rust Codec programs own instance packing and dirty-range publication. The package gate retains production render-plan,
font-binding, Three execution, artifact-validation, and Unicode conformance coverage instead of test-only TypeScript
packers.

Publication layout is computed once at the Wasm boundary, checked against the caller's output limit, and passed unchanged
to the encoder. The encoder writes that package-owned layout directly; it does not rescan the immutable plan to recreate
or revalidate the same offsets before publication. Rust transport tests pin every emitted table offset, count, and payload
range against the compiler-owned plan. The complete record-relationship oracle is compiled only for tests and explicitly
instrumented builds, and runs over real ordered, stable, and mixed planner outputs; release publication retains only
checked size arithmetic and destination bounds.

The TypeScript request compiler likewise owns one checked, monotonic allocation stream for fixed tables and variable
payloads. Its product test pins every table, text, language, feature, and polygon range as disjoint and in bounds. Rust
therefore borrows each individual slice with checked offset, count, alignment, and work limits, but does not compare those
immutable slices pairwise or quadratically after the package has constructed them. Maintainers can build a deliberately
instrumented shaper with Cargo feature `debug-validation`; tests enable the publication oracle automatically, while the
shipping `--release --no-default-features` Wasm build does not contain it.

Global shaping snapshots dirty roots from the engine-owned participant set and writes every root descriptor exactly once.
The public multi-handle product test captures those real Wasm descriptors and pins unique, stable root identities across
updates. Rust therefore bounds the owned batch arena and processes its entries directly; it does not allocate a second root
array, sort it, or scan for duplicates before every global shape.

The retained planner likewise mints one nonzero paragraph identity per Text and emits each paragraph once in scene order.
The public two-Text and replacement Three integrations capture actual Wasm requests and pin identity, order, opcodes,
zeroed reserved fields, and the canonical zero order for removals. Rust checks the paragraph table's range and alignment,
then decodes each opcode where the mutation is consumed; it does not pre-scan compiler-owned record canonicality or search
earlier records for duplicate package-owned identities or orders.

That same public request proves one constraint per paragraph and a distinct nonzero flow-thread identity for each. The
request reader therefore trusts those planner-owned identities instead of rescanning the constraint table; caller-authored
axis, typography, wrapping, overflow, and work-limit values remain checked where they enter the Rust engine.

Every ordinary constraint also produces a distinct nonzero region identity bound to a live nonzero transform identity.
The same captured request proves that producer contract. Rust consumes those identities directly instead of searching the
region table for duplicates or rechecking package-minted zero sentinels; it retains caller-authored geometry and raw-memory
checks.

Constraint region spans are also compiler-owned: every paragraph receives one nonempty contiguous partition, including
multi-column layouts, and starts with no resume region. The public producer proof covers one ordinary and one two-column
Text in the same request. Rust no longer pre-scans those relationships before the flow arena consumes the already-bounded
region table.

A Mori 0.19.1 production-source scan (review profile, same-language threshold 0.85, minimum 40 tokens) first identified
shared machinery across the former ordered and stable planners. The narrower extraction saved 1,188 raw / 328 gzip / 744
Brotli bytes, but retained two physical-storage engines. D-362 later retired the unused stable-indirect experiment in full;
the decision register and append-only log retain its design and benchmark history.

## Current size and performance evidence

The checked package-size record after public-export simplification reports:

| Graph                                   |         Raw |      gzip |    Brotli |
| --------------------------------------- | ----------: | --------: | --------: |
| Core JavaScript plus shaper Wasm        | 1,637,744 B | 591,387 B | 464,596 B |
| Three adapter plus core and shaper Wasm | 1,831,432 B | 639,269 B | 503,332 B |

Optional peers are excluded. Raw counts use readable JavaScript plus optimized Wasm; compressed counts use minified
JavaScript and optimized Wasm compressed independently, as browsers transfer them as separate assets. The distribution
keeps source-shaped declarations and private maintenance emit, with tsdown producing compact ESM and retaining tree-shaking annotations in TypeGPU shader modules. Explicit
package exports remain authoritative for source/type/import conditions and Wasm assets.

### Bidi class lookup: two-stage trie (D-341)

`bidi_class` is called once per character on every analysis. It searched 1,267
`(u32, u32, BidiClass)` tuples, which pad to 12 bytes, so each of roughly eleven probes strided
three cache lines. It now indexes a two-stage code-point trie — an 8,704-entry stage-1 index over
184 deduplicated 128-code-point blocks — in two array reads.

Both implementations compiled into one binary and run over identical inputs, best of nine:

| corpus       | binary search | trie    |      |
| ------------ | ------------- | ------- | ---- |
| latin        | 6.59 ns       | 1.18 ns | 5.6x |
| cjk          | 6.78 ns       | 1.17 ns | 5.8x |
| mixed script | 7.32 ns       | 1.22 ns | 6.0x |

Artifact effect, same-session A/B on `main` with identical source, flags, and `wasm-opt` pipeline:
1,191,281 -> 1,209,532 raw (+18,251), 460,939 -> 459,414 gzip (-1,526), 363,430 -> 362,789 Brotli
(-641). Smaller over the wire under both encodings. An earlier reading of +5,399 Brotli is
withdrawn: it compared against a build of a different branch rather than a same-session baseline,
and isolated table compression was found to be a poor predictor of marginal cost inside a 1.2 MB
module. The growth is confined to the data section (220,350 -> 237,110) while the code section
shrinks (966,819 -> 963,087) because the search loop is gone.

Cold start is unchanged. Compile and instantiate medians are indistinguishable across four
repeated and order-reversed runs of 60 samples: compile minima cluster at 0.134-0.149 ms for both
artifacts, and instantiate holds at ~0.06 ms despite 16,760 additional data bytes, because data
segments are memcpy'd into linear memory rather than validated and compiled. An initial single run
suggested an 18% compile improvement; repetition showed the sign flips with run order, so the
honest reading is flat.

End-to-end this is worth about 0.8% of `text_update` on a 22k-glyph paragraph, below that
benchmark's noise floor, because bidi lookup is roughly one percent of a shaping-dominated
pipeline. The per-lookup figure is the claim.

`line_break::properties` (18.56 ns -> 1.32 ns, 14.1x) and `unicode::script` (15.78 -> 1.32, 11.9x)
now use the same structure through the shared `scripts/support/code-point-trie.mjs` helper, which
also replaced the bidi generator's hand-written copy. Across all three tables the artifact moves
1,191,281 -> 1,258,319 raw (+67,038), 460,939 -> 453,053 gzip (-7,886), 363,430 -> 357,253 Brotli
(-6,177) — smaller over the wire under both encodings, and roughly five times the saving bidi gave
alone.

`SCRIPT_EXTENSION_END_VALUES` stays on the range search: its 284 distinct values overflow a u8
stage-2 index and need a wider table. `SCRIPT_EXTENSION_OFFSETS` is excluded permanently because it
is already directly indexed and has no search to remove.

A same-host comparison against the original pre-cleanup build covers the export reduction, root format move, and core naming.
Browser core moves from 85,612 to 85,829 B under gzip; Three moves from 133,725 to 133,711 B;
direct TypeGPU moves from 44,014 to 42,011 B; the experimental Three/TypeGPU graph moves from
146,959 to 143,885 B. Every measured Wasm artifact is byte-identical before and after. All raw, minified,
gzip, and Brotli measurements remain within the unchanged size ceilings. The core fixture selects core API names
explicitly so raster runtimes remain independently measured even though formats now share the root entry.

The earlier shared-entry checks proved that selecting one React format hook excludes the other hooks; React's shared default Three runtime already includes all three formats before consolidation. Root format selection and `/core` are checked directly against implementation imports and the preceding package build. The focused cases cover `glyphFlags`, `txt`, `glyph`, each built-in format, `defineGlyphConfig`, and `msdfSchema`. All eight cases retain identical implementation module and emitted asset sets before and after the move. Renaming the construction entry from `/extend` to `/core` preserves those module and asset sets; compressed byte counts vary slightly with emitted identifiers and URLs. `glyph`, `txt`, and `glyphFlags` retain no raster format, and each selected format excludes the other two formats and their decoders. Identifier ordering changes compressed byte counts without adding implementation modules.

Single-function imports from `/shaders/typegpu` now prune unused stages within the selected technique, including Bitmap vertex versus fragment, MSDF vertex versus coverage, and Slug dilation versus rendering. TypeGPU metadata registrations and module-level constructors carry PURE annotations, and the shader-only build preserves them. The resulting Bitmap vertex, Bitmap fragment, and MSDF vertex consumer bundles also resolve successfully to WGSL. Other modules retain compact publication output. The shared `/shaders/tsl` entry also excludes unused techniques. The existing size workflow checks initial-versus-lazy module membership, and the registration smoke test proves required raster registration survives consumer tree shaking.

WebGPU continues to alias canonical plan arrays directly. Three's WebGL2 PBO builder replaces a storage attribute's
array with power-of-two-padded retained texture storage, so later Rust patches copy only their dirty byte ranges into
that detached upload view before invalidating its texture. A focused integration fixture simulates the replacement and
proves exact canonical/upload equality with untouched padding. The complete 48-cell presentation matrix keeps every
Bitmap, MTSDF, and Slug workload visible on WebGPU and forced WebGL2; this is the deliberate one-copy WebGL2 fallback,
not another renderer-side layout or packing path.
The corrected complete MTSDF baker is 556,619 raw / 218,279 gzip / 171,376 Brotli bytes. A fresh isolated build of the
zero-import feature-minimal admission module is 69,736 optimized / 30,418 gzip / 25,717 Brotli bytes; release evidence
reads that fresh-build record rather than the superseded SIMD-experiment snapshot.
Correcting channel selection changes pixel identities without changing atlas dimensions or GPU residency, but the new
channel data is less compressible: canonical Inter moves from 6,798,458 to 8,007,071 gzip bytes and Font Awesome from
7,227,921 to 8,705,885. These are baked-asset transfer costs, not default package or per-frame renderer costs.

The public Three benchmark now supports an outside-only mode that leaves the internal phase collector disabled and wraps
one `updateMatrixWorld()` call with a host timer. An eight-warmup/31-sample run over 25,515 positioned glyphs measured
19.42/6.59/3.10/14.24 ms median and 21.00/6.86/4.75/15.26 ms p95 for cold/font-size/width/text updates. Those values cover
frame preparation, the complete Rust transaction and render-plan publication, and Three plan application; they exclude
GPU submission. An adjacent phase-instrumented run was indistinguishable within process noise. Those temporary profiler
exports, calls, branches, and clock reads are now absent from the package source and clean publishing output; benchmark
workload markers and the direct Wasm timer remain outside the shipped library.

After the final plan-application lifecycle audit, Three sizes indexed transforms from live paragraph IDs instead of
scanning every glyph record in JavaScript. Patch-only publications retain the transform table and its index instead of
preparing and uploading them again; the ordinary synchronizer still applies transforms and visibility changed in that
frame. Replacement publications prepare fresh transform ownership and resolve visibility through the application scene.
A renderer preparation failure discards its candidate, retains the last
accepted plan fence and error, and waits for explicit renderer-relevant invalidation to request a checkpoint. Dirty upload
ranges accumulate across presentation restoration and Rust patches; buffer/resource generations dispose only their exact
dependent materials; and direct materials survive indexed transform-table growth. A loaded font owns one
cached Three binding and decoded resource set: disposal marks them for retirement, while the final registered-stack lease
keeps them valid and then disposes the Wasm binding before removing renderer resources. The unchanged
eight-warmup/31-sample public 25,515-glyph lane measures
17.84/6.32/3.04/13.84 ms medians and 18.99/6.64/4.60/14.01 ms p95 for cold/font-size/width/text. The adjacent recorded
run was 19.42/6.59/3.10/14.24 ms median; process-separated samples support no regression and a plausible cold-path
reduction, not causal attribution.

The canonical direct benchmark loads the packaged `dist/text-shaper.wasm`: Cargo release optimization, LTO, one codegen
unit, default-on `simd128`, stripping, and `wasm-opt -Oz --enable-simd` have already run. On the identical Rust artifact,
Binaryen `-O3` and `-O4` added 11,976 and 13,661 raw bytes without a demonstrated latency improvement. The
evidence-backed pipeline is now `--merge-similar-functions -Oz --merge-similar-functions -Oz` (D-244): the merge pass
finds nothing after `-Oz` alone, but sandwiched runs remove 8,248 raw bytes from the shaper and 29,289 across the four
bakers with hot-path lanes unchanged within noise. Explicit `#[inline(never)]` stage seams in the update path measured
size-neutral (+241 raw) and were rejected — the large export body is stage aggregation, not duplication.

SIMD expansion follows recorded kernel-lab admission (D-245). The complete scalar/auto-vectorized/explicit comparison
over real paragraph arrays is checked in as shaper evidence: explicit break-opportunity masks run 7.6×, bidi transition
masks 4.8×, and chunk-64 advance summaries 2.2× faster than auto-vectorization, while the pack loop and the production
policy interpreter confirm their earlier scalar and explicit choices. The mask and chunk kernels have no production
consumer yet; they adopt alongside the 11.14 line-planner work behind `cfg(simd128)` with exact scalar-parity tests. The `<4 ms` warm-path target and stable p95 closure remain open.

Cargo `opt-level` is likewise evidence-pinned per crate (D-242). A four-variant shaper matrix (whole-`z`,
dependency-only `z`, HarfRust-family `s`, whole-`s`) shrank the 1,160,223-byte artifact to 890,381–1,076,427 raw bytes,
but every variant regressed shaping-bound benchmark lanes beyond acceptance — whole-`z` roughly doubled all five lanes,
and even HarfRust-`s` cost +22% cold and +27% suffix-edit — because the HarfRust bytes that dominate size are the
shaping hot path. The inverse holds for the parser-generic bakers: forcing `z` or `s` inflates the Bitmap, MTSDF, and
Slug bakers by 26–123 KB over their `-O3` builds, and rebuilding the font baker at `3` or `s` inflates it by 192 or
95 KB over its current `z`, so every crate already sits at its measured per-crate optimum and further size reduction
proceeds through code-shape changes rather than optimizer flags.

The first such change is the shared engine sort kernel (D-243). Every engine ordering now lowers its key into a
`u64` — packed integer fields, or the order-preserving bit image of an `f64` under `total_cmp` — and sorts retained
`(key, source index)` pairs through one instantiation, applying the permutation by cycle walking; the four-field style
cascade key runs as two stable passes over the same kernel. The index tiebreak makes every engine ordering total and
deterministic, sort-algorithm independent, and allocation-free in steady state. This removed 50,579 raw / 14,458 gzip
bytes; measured sort bodies fell from 115.5 KiB in 64 functions to 79.5 KiB in 45, of which 45.5 KiB is HarfRust-internal
and unreachable without a fork. The 22k-glyph benchmark lanes are unchanged within noise (cold 16.41 vs 16.51 ms,
suffix-edit 14.01 vs 13.93 ms medians).

The final sequential eight-warmup/31-sample checkpoint uses the unchanged 22,000-target corpus, which resolves to 25,515
positioned and 21,805 renderable glyphs. Values below are medians in milliseconds for the complete packaged Rust
transaction and raster-format-specific command-buffer publication; GPU submission is outside this direct benchmark.

| Raster format |  Cold | Font size | Column width | Suffix edit | Local edit | Middle splice |
| ------------- | ----: | --------: | -----------: | ----------: | ---------: | ------------: |
| Bitmap        | 15.90 |      6.04 |         2.78 |       13.48 |       1.18 |          8.52 |
| MTSDF         | 16.50 |      6.41 |         2.73 |       13.52 |       1.18 |          8.73 |
| Slug          | 16.73 |      6.64 |         2.96 |       14.37 |       1.31 |          8.94 |

The migration comparison is checked evidence rather than a reconstructed recollection. Commit `90964be0`, the exact
`feat/three-api` base, was rebuilt in an isolated worktree using its own lockfile and original
now-retired `glyph:layout-benchmark` workflow on this Darwin arm64 host. At the same eight-warmup/31-sample cadence its retained
TypeScript path measured 58.32/12.09/9.15/39.61 ms for cold/font-size/width/suffix-edit medians. The current Bitmap,
MTSDF, and Slug records all use one byte-identical optimized shaper Wasm and the complete `pmndrs_glyph_engine_update` plus
raster-format-specific Rust command-buffer publication. The base reports 25,515 positioned glyphs; the current publication reports 21,805
renderable instances from the unchanged 22,000-glyph target because it omits non-rendering glyphs from GPU records.

The exact [TypeScript baseline](../../../benches/fixtures/results/typescript-layout-baseline-90964be0-darwin-arm64.json)
and current [Bitmap](../../../benches/fixtures/results/rust-layout-bitmap-0bdb9e93-darwin-arm64.json),
[MTSDF](../../../benches/fixtures/results/rust-layout-mtsdf-0bdb9e93-darwin-arm64.json), and
[Slug](../../../benches/fixtures/results/rust-layout-slug-0bdb9e93-darwin-arm64.json) records are authenticated by
the benchmark fixture gate. Every comparable median is faster through Rust: Bitmap is 3.67× faster cold, 2.00× on font
size, 3.29× on width, and 2.94× on suffix edit; even the slowest technique for each case remains 3.49×, 1.82×, 3.09×,
and 2.76× faster. This proves the migration comparison on this machine; it does not close the stricter p95-under-4-ms
objective. Local-edit p95 remains about 6 ms and high-variance, while width p95 ranges from 4.29 to 4.75 ms across
raster formats.

Historical paragraph-scoped synchronous measure work (11.17) closed that objective for the old explicit-query shape. At the same
22,000-glyph corpus and cadence, the new `measure-query` lane answers the identical alternating widths as the
`column-resize` lane through `pmndrs_glyph_engine_measure_paragraph`: 1.815 ms median / 1.930 ms p95 / 3.0% RSD with
zero patches and zero publication bytes, beside the full update's 2.996 ms median / 4.483 ms p95 / 21.7% RSD in the
same run — the first width-change lane under the 4 ms p95 objective, recorded in the
[measure-query record](../../../benches/fixtures/results/rust-layout-bitmap-measure-a42c976-darwin-arm64.json).
The variance collapse followed from what that query skipped: gather, plan compile, publication packing, and renderer
revision burn. The retained setter cutover no longer presents this cached number as end-to-end assignment performance;
fresh Labs must include normalization, full-input encoding, and durable Rust preparation before publication.

The preceding unchanged 22,000-glyph localized-edit lane measured the complete production `pmndrs_glyph_engine_update` plus Bitmap render
plan at 2.607 ms median / 6.184 ms p95 after 40 warmups over 101 updates. The fast ASCII-letter path reuses Unicode and
bidi state and recomposes until the line cursor converges; punctuation and spacing edits deliberately retain the full
break-sensitive path, so the 42.4% RSD describes remaining workload classes rather than a completed latency result. The
optimized SIMD shaper is 1,147,266 raw bytes. Five patches write roughly 1.2 KiB per update, and the retained high-water
mark remains 80.38 MiB. Median is now below 4 ms, but p95 and memory-growth gates remain open.

Codec gather now retains complete prior input lanes by committed planner/Codec/capability revision. Zero-change glyphs
reuse them without binding or Codec work; changed glyphs update only reachable lanes. A resource or draw-storage key
change retains the verified prefix and fully rebuilds the suffix, preserving correct replacement-buffer inputs without
double-scanning the prefix. The same production lane now measures 1.314 ms median / 5.863 ms p95 with 76.2% RSD, five
patches, and roughly 1.2 KiB written. The 1,153,122-byte optimized shaper is 5,856 bytes larger than the prior checkpoint,
and retained high-water memory is 80.19 MiB. The fast class approaches 1 ms; the break-sensitive p95 remains open.

The ordered-direct compiler additionally retains committed glyph-to-batch and glyph-to-slot topology while Codec,
capability, glyph count, and every physical storage key remain compatible. The initial admission path validated every
glyph and stable identity; current authenticated range admission is described below. Storage mismatch still falls back
to the same complete batch discovery. Three consecutive optimized runs measured
1.164/5.761, 1.153/5.740, and 1.155/5.738 ms median/p95, versus the preceding 1.314/5.863 ms checkpoint. The optimized
shaper is 1,157,311 raw bytes, a 4,189-byte increase, and retained high-water memory is 79.81 MiB. The repeated median gain
is established; the roughly 5.74 ms p95 and 81.4–81.6% RSD still fail the tail-latency gate.

Patch-only publications now omit the immutable resource, buffer, primitive, and draw bindings when the pending plan
proves the committed batch count, batch state, buffer identity and capacity, primitives, and draws are unchanged and no
retirement is pending. Physical patches remain the complete mutable payload; abort preserves the accepted bytes and a
retry remains patch-only. In a fresh-package four-block Labs comparison, eleven color-only lanes improved by 30.8–46.1%;
the twelfth was inconclusive, while same-length and length-changing text lanes were neutral. Named-Wasm profiles found no shaping samples
for color-only edits, but the 1,000-label candidate still spent time in retained update, gather, and render-plan prepare
and scaled 11.4× from 10 labels. Text edits that change instance-span metadata still require the root display-list group
replacement because the wire contract has no partial immutable-metadata patch. The edit-sized acceptance gate therefore
remains open; this change removes redundant serialization and host reconciliation for the compatible patch-only class
without adding a scheduler, cache, reconciliation system, or public API.

Retained preparation now also uses the package-owned semantic change mask to identify foreground-paint,
region/flow, indexed-transform-selection, and text-effect changes that cannot alter `PlanGlyph` display-list metadata.
When that proof and the preceding exact storage-binding proof both hold, ordered and independent-compositing plans
preserve the accepted primitive/draw tables through commit and skip rebuilding resource, buffer, primitive, and draw records. Checkpoints,
unknown or missing masks, identity/geometry/cluster/placement changes, topology or storage-key changes, buffer recreation
or growth, and pending retirement all retain complete compilation. The production frame test shapes and positions an
Inter glyph, commits independent compositing, changes only foreground paint, and proves the skip survives abort/retry;
the public Three test separately proves a color assignment emits that production compositing policy and retains the
accepted draw. A focused 1,000-glyph single-draw case proves this branch does not walk the accepted draw span, but
complete admission confirms every glyph. Internal root updates can authorize sparse instance changes through the same
rope-backed consumer using authenticated changed-output intervals; canonical commit and abort govern that proof.
Count-changing suffix metadata and complete draw compilation can still scale with root size. The early measurements
above predate these consumers; current scoped results and open gates live in the publication frontier checklist.

Resource lifecycle compilation enumerates admitted pending batch keys instead of every glyph. Each key carries full
resource identity; retained admission or full fallback preserves first-occurrence order. Deduplication, conflict checks,
checkpoint/generation actions, decoration omission and abort/retry use the same compiler. Buffer/draw compilation is
unchanged; this removes only resource rediscovery. Independent review, focused cold/applied-host tests, full native/Node
and build/pack pass. The optimized shaper changes -37 raw/+24 gzip bytes; JS and baker binaries stay identical.
Checkpoint-relative Labs found one faster and 46 neutral edit-sized workloads, six neutral assignment workloads, and no
slower or skipped results. Three matching-source/exact-Wasm WebGPU/WebGL2 probes passed with inspected captures.
This does not establish a broad resource-key timing win or release-wide parity.

The retained-publication regression suite replays emitted allocation/write/retirement records into a test host and
compares active buffer bytes and draw metadata against both forced full checkpoints and fresh cold compilers over 4,096
deterministic mutation steps split across ordered/independent compositing and two storage policies. The mutations cover
content edits, no-ops, display-list metadata, resources, capacity growth, insertion, removal, reordering, empty roots,
periodic checkpoints, and rejected preparations followed by retries. The oracles bypass retained topology and binding
elision; focused cases cover later draw entries, a 1,000-record shared draw, independent instance-only reuse and metadata
fallback, draw-boundary split/merge, resource lifetime, exact patch ranges, and rejection semantics. Run the Rust engine
and authenticated outline/Unicode tests with `pnpm scripts run glyph:shaper-tests`, optionally passing a test-name filter.

Three retains pending attribute upload ranges until its renderer consumes them. Consecutive Rust publications and
presentation-origin restoration before rendering coalesce overlapping or adjacent ranges instead of clearing earlier
writes. Paragraph transform identities return to a binding-local free list only after the Rust removal
transaction commits, bounding the indexed transform table under create/dispose churn. A disposed `Text` may remain in
the Three scene graph until its host detaches it without poisoning the surviving batch, and batch-wide runtime validation
runs inside the group error boundary before reconciliation mutates ownership. Semantic queries use the nonpublishing
paragraph-measure call; an internal query contract failure leaves the engine revision and renderer fence untouched and
throws from the query. Focused public integration exercises all four lifecycles. The canonical direct benchmark defaults
to eight warmups and 31 measured samples so its reported p95 is not the maximum of an 11-sample run.

The Wasm boundary also retains fixed-seed mutation coverage for the two replacement parsers. Sixty-four policy and frame
mutations run twice with identical status sequences, include accepted and rejected paths, and prove that every malformed
input leaves a fresh valid transaction usable. This supplements the Rust parser unit cases at the compiled ABI rather
than restoring any deleted `shapeBatch`, `reshapeRanges`, or TypeScript paragraph state machine. The package gate now
contains 165 Node integration tests plus three deterministic fuzz-smoke tests.

D-254 introduced scale-late F26.6 fixed-point layout decisions, and PR #134 later raised the decision lane to 16
fractional bits stored in `i64`. The current rounding contract is `floor(value * 65,536 + 1/2)` with caller-derived values
bounded to ±2^53 integer units. Cluster values, chunk summaries, fitting, and justification use the `i64` lane; the
authoritative shaped advances and intra-line positioning cursor remain `f64`, and semantic, query, Codec, and renderer
geometry narrows to the public `f32` contract. The original migration landed as stacked slices with an interleaved
same-run A/B for each — sides alternated in identical order within one process session because this host drifts several
percent between sessions. Historical step deltas, medians at the 22,000-glyph corpus:

Break admission is inclusive and exact in that integer lane: equal fits, one layout unit below breaks, and one above
fits, with indexed and scalar word paths pinned to the same result. Measurement sizes, content extents, and intrinsic
widths round outward at the public f32 boundary whenever nearest rounding would undershoot their retained f64 authority.
This prevents a raw measure-to-exact feedback loop from presenting less width than the line it just measured without
adding a floating epsilon or history-dependent hysteresis. Host adapters still round outward to their own point scale
after padding, border, and layout-engine arithmetic.

| Slice                                             | Lane deltas (median, rounds consistent)                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry flattening (slice 1)                     | lane-neutral; shaper −9,433 raw bytes                                                                                                                            |
| F26.6 fit + chunk-64 kernels (historical slice 2) | ~2% measure lane, scales with line length; byte-exact break parity                                                                                               |
| Retained adjacency stream (slice 3)               | column-resize 2.996 → 2.781 ms (−7.2%), measure-query 1.930 → 1.824 ms (−5.5%), both 3/3; suffix +1.3% / splice +2.1% (re-shape scatter, accepted); cold neutral |
| Metric-only scale refresh (slice 3)               | font-size 6.715 → 5.898 ms (−12.2%, 3/3) — 9.2% below the pre-stream baseline; other lanes neutral                                                               |
| Integer justification (slice 4)                   | lane-neutral 2/2 (the direct lanes do not justify); totals now exact                                                                                             |

The stream replaces the glyph permutation with six adjacency-order payload columns scattered at build, so positioning
walks sequential memory and geometry-only updates reuse the stream untouched; a metrics-only restyle re-derives just the
advance lanes from that stream in one sequential pass, bit-identical to a cold build by a lane-for-lane oracle.
Justification distributes euclideanly in layout units — per-site quotient plus a remainder spread one unit over leading
sites — so the fragment advance and the applied cursor adjustments agree exactly, and the compression capacity
quantizes through the same `ratio_q16` expression the fit used to admit the line. The
[integer-units checkpoint record](../../../benches/fixtures/results/rust-layout-bitmap-integer-units-c2e895e-darwin-arm64.json)
pins the slice-4 artifact end-state (measure-query 1.890/2.054 ms median/p95 on a visibly hot host session; the
interleaved deltas above are the comparative evidence).

Corpus re-derivation statement: the packaged fixtures held byte-identical through every slice except the deliberate
quantized-boundary re-pins recorded with their commits — one RTL ellipsis extent at the slice-2b flip (+0.0134 px), the
paragraph bidi and CJK contracts (30 and 25 numeric leaves, maxima 0.070 px and 0.101 px, the latter a long Korean
line's accumulated per-site sub-unit quantization), and the advanced-shaping and rich-text composed hashes, whose
roughly twenty-five structural pins each — glyph and draw counts, line counts, both first-line break positions — held
exactly while the historical F26.6 origins settled on 1/64 boundaries. Integer justification required no re-pin: both contract corpora and
the sixteen-scenario conformance suite reproduce byte-identically because their justified cases divide evenly. Native
and Wasm agree bit-for-bit on the contract corpora by construction of the shared rounding contract, and the linux CI
host reproduces both composed scenario hashes recorded on this darwin host.

PR #134 re-derived the affected deterministic fixtures when the decision lane moved to 1/65,536 units. That refinement
did not make glyph positioning integer: the `f64` pen remains a deliberate seam, and a future integer-pen change requires
its own explicit corpus re-derivation.

The review fold that closed the migration replaced the fit's Q16 shrink budget with an exactly-applied f64 ratio —
one IEEE multiply and one round-half-up per comparison, shared verbatim by justification's growth and compression
caps and by the f64 parity twin — after a review counterexample showed the Q16 ratio's 2^-17 relative error
exceeding the one-unit tolerance above ~2^16-unit space sums and its `<<16` comparison overflowing i64 inside the
admitted magnitude range. The same fold bounded justification application to the counted span in visual encounter
order (trailing logical spaces and uncounted gaps no longer absorb adjustments, so the applied cursor sum equals
the reported fragment advance in both directions), required positional run-topology stability before the
metric-only scale refresh (a metrics restyle can merge adjacent runs and dangle retained run indices), and
collapsed the build's payload scatter to bulk copies when shaped runs tile the glyph array in cluster order.

Historical lazy-query evidence showed that omitting per-glyph positioning moved the measurement-only lane from
1.82–1.90 ms to 0.458 ms median / 0.607 ms p95 (−75%, three interleaved rounds). The setter-first retained contract
supersedes that runtime shape: a successful assignment now prepares positioning as part of the durable revision so
immediate metric and glyph reads agree and do no later preparation. Those older measurements remain attribution
evidence for the cost of positioning, not a benchmark claim for the new end-to-end setter path. The identity-order
scatter reclaimed the retained-stream cost on the edit lanes (suffix and splice both −1.6%, three rounds); font-size
pays +1.2% for the correctness admissions and remains ~11% below the pre-stream baseline. Still open and requiring
fresh setter-inclusive evidence: the committing-resize p95-under-4-ms objective. The historical tail was structural,
not noise — 4.42–4.49 p95 against a 2.8 ms median — and belongs to break-sensitive full recomposition.

Per-sample attribution (the benchmark's `--samples` dump, 101 widening reps at 22k glyphs) later replaced that
characterization with measured structure: the resize distribution has three classes, none of them noise. A third of
the samples — widths whose +7 px quantized to an identical layout — published ZERO bytes yet still cost ~3.2 ms:
the engine re-fits, re-positions, re-gathers, and re-diffs the full corpus to discover nothing changed. The bulk
class (~60%) republishes the entire ~170 KB positioned output as one patch at ~3.5 ms, and the p95 class (~6%,
present in every width quartile) writes the same bytes at ~5.4 ms of roughly doubled compute. The identified fix
for the first class is a break-sequence equivalence short-circuit: the integer fit is cheap and chunk-skipped, so
when the composed lines equal the committed lines under unchanged text and styles, the positioning, gather, and
publication tail can adopt committed state and publish nothing — the same adoption shape D-253 established for
measure transactions.

That short-circuit is landed. `flow_positioning_equivalent` proves, per fragment, bit-equality of the cluster
range, the computed pen origin (slot start plus indent shift plus alignment offset), and the justify distribution
against the committed flow — exactly the inputs positioning consumes — and the geometry-only update path then
aborts the pending flow, retains committed positioning, and commits the new constraint, which the equivalence
proof is precisely the license for. End alignment, centering, justified spans with changed slot spans, and
boundary-bearing flows fail the proof and take the full path; a unit matrix pins each discrimination and an
integration sequence drives adopt → relayout → adopt across the equivalence boundary. Measured at the same
101-rep widening sweep: the zero-publication class (34 of 101 frames) drops from ~3.2 ms to 0.357 ms median
(−89%), the published classes are unchanged, and every other lane is neutral over two interleaved rounds. The
lane median and p95 are order statistics over the published classes and move little; what changed is that a
third of resize frames now cost a third of a millisecond.

The completing reflow pass keeps shaped-word composition data beside the retained cluster lanes. Only a paragraph whose
active geometry requests word wrapping lazily builds the sidecar. Sparse prose records one 12-byte
`(cluster_end, advance_units, space_units)` entry per legal word break plus its terminal segment; a paragraph with at
least one break per two clusters stays on the existing cluster/chunk path, so ordinary dense CJK never pays a sidecar
record per character even when shaping produces a negative advance. Paragraphs shorter than one 64-cluster layout
chunk also stay on the allocation-free scalar path, so ordinary labels never construct the word index. The existing
chunk flag byte marks negative advances, and its existing auxiliary `i64` lane is interpreted by those flags as either
the shrinkable-space sum or, for a negative space-free chunk, the largest advance prefix. This proves that every local
break boundary fits before skipping that chunk. A chunk combining spaces with a negative advance takes the exact scalar
path, preserving hanging-space and shrink semantics without another lane, Wasm ABI field, glyph-record byte, or warm
allocation. Word fitting consumes complete shaped segments before testing the width, including the same word-space
shrink budget used by justification. This fixes the case where an early positive glyph advance followed by a negative
shaping adjustment incorrectly pushed a word to the next line even though the completed word fit. It does not reshape
or split a previously shaped word.

The legal stream begins with Unicode 17 UAX #14 opportunities, discards any optional opportunity that falls inside a
UAX #29 extended grapheme, and intersects the result with HarfRust unsafe-to-break shaping boundaries. The default has
no dictionary segmentation, language-specific hyphenation, or locale tailoring. A Unicode-legal break that HarfRust
marks unsafe stays allowed within one run, binding, and font, as in browser line breaking: the line fitter prices it
from boundary-local shaping corrections, computed lazily per boundary and stored in a cluster lane, so line layout is
exact at the breaks it takes (D-372). A break no space precedes is refused when its island shaped alone draws other glyph ids than the paragraph (a ligature or contextual unit), so Glyph never splits such a unit, unlike Chromium; a positioning-only difference keeps the break. The check is lazy: it rides the `L` pricing shaping at the breaks the fitter evaluates, and an island longer than `ISLAND_CAP` clusters is never reshaped and stays a non-break. Min-content reads the paragraph shaping's word widths uncorrected, like Blink's fast
min-content path, so it never prices every corrected boundary. A line that starts at such a corrected boundary draws the glyphs of the island it opens shaped alone, in
the same pass that prices it (`line_edge_records`, boundary-shape records beside the ellipsis one), so it matches the
line shaped by itself. A line that ends at one, unless a space ends it, draws the island it closes shaped alone too
(the tail record, `FlowFragment::tail_index`), as Blink reshapes a line end that no breakable space
precedes (so only at positioning-only breaks); a hanging space keeps the paragraph's glyphs, as browsers keep the terminating space in the shaping run. Extra glyphs an edge record draws beyond its cluster's paragraph glyphs keep the stable ids of the previous layout's records, found by the text unit of their cluster and their ordinal (`previous_edge_ids`), so an edit that moves offsets keeps them. An island a boundary prices is the island its line edge draws, so one shaping serves both and is kept with the cluster arena (`ClusterArena::islands`): a relayout over the same clusters, such as a width change, shapes nothing, and an edit rebuilds the arena empty.
Edge records lay out cluster by cluster, so spans that split only paint or decoration keep their own extents and
justification. A paragraph with a right-to-left or overridden run marks no unsafe break as correctable, as on main, so its widths and drawn glyphs cannot disagree (known limitation until edge records follow visual order). Optional language-resource imports,
including a versioned linear-memory ABI that can move language tables out of the default Wasm payload, are tracked in
[#163](https://github.com/pmndrs/glyph/issues/163); no renderer adapter may become a second layout implementation.

After composition, start-aligned lines whose semantic range, fragment order, indent, baseline, transform, clip, slot
origin, and final-line state are unchanged copy their committed positioned SoA slices even when a wider slot changes
only its unused end. Retained lines copy their indexed decoration slice with their glyph and semantic slices; a changed
slot start invalidates reuse because it changes the published semantic line extent. Nontrivial bidi, center/end
alignment, justification changes, boundary reshaping, and any changed line geometry take the full positioning path. At 22,000 glyphs and 101 widening updates, the final candidate measured
1.882/4.553 ms median/p95 versus exact remote main's 2.991/5.256 ms. The dedicated measurement query measured
0.282/0.341 ms versus 0.517/0.711 ms. Two browser Paragraph Stress A/B pairs retained 11,510 glyphs in one draw: the
candidate/main retained-update medians were 0.665/0.795 and 0.750/0.785 ms, while update-plus-measure medians were
0.510/0.580 and 0.565/0.605 ms. These machine-local observations establish repeated direction and a lower common-case
cost; width reflow remains above the sub-1-ms interactive target and is still the last post-shaping performance frontier.

The [fragment-relative reflow plan](../planning/fragment-relative-reflow.md) owns that next frontier. It must preserve the
word sidecar and chunk summaries as fit indexes, retain current shaping and bidi authority, and prove that width or obstacle
changes patch stable run placement instead of republishing unchanged glyph-local geometry. This paragraph records the
baseline only; it does not claim that `LayoutRun`, public contour authoring, projected objects, or drop caps are implemented.

Large `measure()` and `glyphs()` queries reserve against the result arena's reported capacity and required watermark.
Each retry must strictly grow the arena
or return the typed engine error. This fixes alternating large inspection queries without an arbitrary retry count and
without changing normal publication or cached-query work.

The [historical integer layout-units record](../planning/integer-layout-units.md) retains the one deliberately open numeric
seam: decisions resolve in the 16-fraction-bit `i64` lane while the intra-line cursor accumulates and resynchronizes against
the `f64` advance lane. Fragment-relative reflow keeps those decision and internal-computation domains, but the pre-alpha
package now deliberately re-pins the final public/render coordinate operation to separately narrowed run-local and
placement `f32` components followed by one specified `f32` addition. This is not an integer-pen migration. The
prepared/pending state-machine follow-up is complete under D-258: every stage is a `Staged<T>`, and staging new flow
invalidates stale positioning by construction.

## Fragment-relative reflow frontier

PR #161 is merged. Its retained word fitting, line reuse, partial update sections, paragraph ordering, synchronous queries,
publication lifecycle, and renderer batching are the baseline rather than open merge gates. Milestone 12's proof,
single-model cutover, renderer integration, and ordered-only cleanup gates are closed. Public contour, projected-object,
and drop-cap authoring remain later milestones; the placement work does not imply those APIs.

The M0/M1 harness first derived maximal shaping-compatible `LayoutRun` intervals from retained cluster ownership without
changing production execution. Production now treats those as post-shaping geometry runs: adjacent shaping runs may
share one `LayoutRun` after shaping when direction, resolved bidi level, selected font, and layout geometry agree, so a
Han/kana/punctuation script transition does not manufacture a renderer placement entity. Direction, bidi, fallback-font,
and shaping/layout-style changes still split the run. `ClusterArena` retains that topology, makes it the sole flow-extents traversal,
and uses it to hoist font geometry for boundary-free, zero-indent, trivial-order positioning, including justified lines.
Bidi, boundary replacement, and indented fragments still use the same shared cluster-emission authority without
run-level hoisting. Maintained benchmark cases isolate justified, mixed-bidi,
equivalent-width, and dense-CJK reflow and retain raw publication counters. The frozen pre-cutover Bitmap checkpoint
measured 22k width updates at `1.144 / 3.605 ms` aggregate median/p95 and `1.493 / 3.743 ms` on the active 174,440-byte
publication subset; measurement-only was `0.192 / 0.226 ms`. Those values remain attribution baselines, not performance
claims for the production slice.

The initial proof consumers establish maximal `(source_run, font_handle)` runs, one-run dense CJK, run-bounded line extents, exact
visual occurrence ownership, and replacement-run ownership. They also reject plain local-plus-translation arithmetic as a
legacy-bit-preserving transform: deterministic inline and block counterexamples change final f32 bits, and a 4,111-case
representation lab finds mismatches in every tested compact candidate. The active-resize benchmark alternates
420/434-unit widths and fails on any zero-patch sample.

Those counterexamples close the old-bit question for the retained additive placement model. The package is pre-alpha and
publishes one indexed placement contract without a compatibility branch. Each rendered glyph's semantic row carries an
engine-owned `placementSlot`; the planner resolves that slot to one root-scoped f32x2 x/y row shared by every compatible
resource and material batch. Raster Codec authors continue to name semantic and raster values rather than slots, tables,
bind groups, or physical buffer layouts. Package-private host assembly stores the slot, and each adapter chooses its
physical packing before applying the same ordered local-plus-placement f32 addition. A 65,536-case finite arithmetic
regression proves this is the same commutative f32 addition the former Codec-side absolute raster origin used;
tiny-world, justification, cancellation, retained-update, and browser-pixel evidence still gate milestone completion.

Static local coordinates cannot be anchored to visual slices because width changes move dense-CJK slice boundaries. The
exact anchor policy remains evidence-gated; an admissible bounded-local form may use fixed, break-independent numeric
blocks inside one stable `LayoutRun`. Their boundaries may use stable glyph/cluster adjacencies even when the edge is not
`CLUSTER_SAFE_BEFORE`, because numeric partitioning neither reshapes nor permits a line break. Admission scans the full
two-dimensional running geometry envelope: direction-canonical glyph cursors, negative advances, cluster
resynchronization, shaping and baseline offsets, semantic origins, and ink coordinates derived from extents. Placement
uses stability-aware source-slice/numeric-block/visual-segment intersections. Sparse prose retains safe word-root slots
from the existing sidecar even when adjacent translations match and splits within a word only at a real displacement or
boundary change. Dense CJK uses fixed numeric blocks and current visual segments without per-glyph runs or rows. Numeric
blocks are not run identity, line entities, batch keys, or draws.

The numeric gate measures local narrowing, translation narrowing, and the final ordered f32 add separately. Fixed,
break-independent numeric blocks bound local geometry; boundary replacement glyphs own distinct replacement `LayoutRun`
geometry and blocks for their committed topology lifetime rather than borrowing a paragraph-source identity. Warmed width
updates with unchanged text, font/local geometry, and replacement topology publish no static glyph-local/numeric-block
bytes.

The visual proof joins independent multi-fragment bidi, per-fragment hanging-space, and justification-site oracles to a
safe-boundary mapper. It preserves multi-glyph cluster order and glyphless ownership, rejects boundary replacement until
it has an explicit occurrence model, and keeps 4,096 homogeneous CJK clusters in one retained run. A 166-glyph real
corpus reconstructs all 332 already-published f32 coordinates exactly from line and observable-slice anchors, but the
f64 reassociation counterexamples remain authoritative for the future CPU cutover.

Break-independent numeric blocks, compact placement segments, and placement slots are production-owned and populated by
the single positioning traversal. A LayoutRun's canonical revision and stable source anchor identify its retained local
geometry; there is no separate run-slot allocator or renderer-visible run handle. Justification, L1/L2, hanging,
boundary ownership, and exact f64 translation remain in core; the
renderer receives only a per-glyph u32 slot and the selected f32x2 row. CPU semantic/query rows and renderer placement use
the same ordered local-plus-placement f32 operation. Run, word, numeric-block, role, bidi, and justification metadata do
not cross the renderer boundary.

`ClusterArena` prepares one stable u32 placement-segment anchor per cluster after word fitting and LayoutRun topology are
available. Short, sparse, and overflow word-sidecar modes retain the stable word root; dense break streams retain the
LayoutRun root, and a glyphless hard break owns its own stable cluster ID. Positioning therefore resolves the segment
anchor in O(1) instead of searching backward or advancing a sparse-record cursor for every visited cluster. The
positioned placement arena stores one rendered-instance count per compact segment rather than repeating one segment
index for every rendered glyph. Retained lines copy those compact counts, and final slot binding walks each contiguous
segment-owned glyph range once. Word fitting remains independently usable without LayoutRun state; paragraph flow
prepares placement anchors as an explicit subsequent step.

Retained geometry-only positioning has a matching guarded path for visually trivial, boundary-free, undecorated text. It
reuses committed glyph-local, raster, and effect rows, copies compact placement metadata, and refreshes clip, region,
thread, and transform metadata. Internal positioned semantic rows keep local origin and ink coordinates plus their
placement-segment index. Pure placement changes retain local Codec inputs. Absolute cached plan bounds must refresh when
translation changes, using gather's ordered f32 addition, without falsely marking local Codec origins dirty. Gather owns
that derived metadata and forwards a scalar bounds-change fact into existing binding compilation; unchanged local GPU
inputs retain their revisions and masks. Changed immutable primitive bounds require publication. The integrated source
uses existing accepted session placement bytes to preserve translation dirt across abort/retry without marking a fresh
gather as changed. Session preparation precedes ordered binding preparation; abort cleans up both. Full native/package
correctness passes; performance and cumulative size remain held in the [publication tracker](../planning/publication-frontier.md).
Public borrowed/full
glyph queries and CPU/plan ink bounds compose absolute f32 values lazily from the
authoritative segment translation. Plan gather requires that positioned semantic row and translation and derives semantic
identity from the same row; malformed internal input is rejected rather than interpreting local coordinates as absolute or
falling back to a parallel semantic lane. Retained gather resolves only genuinely changed Codec dependencies without repeating
font selection, raster resource lookup, or full `PlanGlyph` construction. Stable/glyph/font
identity and exact outline presence authenticate retained rows; any mismatch aborts the candidate. Other changes use the
general authorities.

Copied complete placement spans retain their bound slot-and-generation handle after source/run/count correspondence.
Coverage-growing merge, extension or instance append revokes that proof. The shared binding executor skips glyph rows
only for an exact retained handle; otherwise it applies the same slot/revision/mask rule for prepared and committed
callers. Committed publication reserves an indexed journal of changed handles and glyph fields before mutation. Abort
restores those entries; late revision overflow also restores the revision cursor. Successful publication clears the
existing journal. Dense paragraph glyph snapshots, duplicate mutation loops and full after-write comparison/restore
walks are retired; segment-count/handle traversal and whole-source gather remain. Static, cold/rollback/generation and
complete native/package checks pass; exact-artifact speed/size gates remain in the publication tracker.

The local publication frontier replaces gather's source Vec with the existing retained rope. Record/selected-count summaries map authenticated source intervals to emitted rows, including recordless glyphs. The single retained row executor consumes accumulated unpublished positioning intervals; measurement retains that proof, publication clears it, and transactional binding restores it on abort. The consolidated walker retires iterator/tuple scratch and stops at the first suffix mismatch. The actual-positioning journal records numeric-remap fallback work and retires the post-loop flow-only envelope; existing correspondence and rollback fences remain. The same gather executor now admits ordered count-changing owners through one replacement envelope, sharing clean source gaps and moving emitted flat fields once; source and emitted deltas remain independent. Frozen gather-only Labs proves seven faster and one neutral multi-owner case, at +1,990 gzip bytes versus its immediate control. The next unfrozen planner slice consumes that old/new correspondence in the existing admission, layout and patch executor. It captures one scratch old physical slot per new input before overwriting mappings, admits dirty rows, rebases CPU instance indices and copies clean moved buffer bytes without Codec execution. New batch keys, removed batches and checkpoints use the same complete reconciliation. Planner correctness, elapsed and size gates remain open; gather timings do not validate the new planner. Commit authorizes reuse, while abort revokes speculative shifted metadata. Static, native/Unicode, package and scoped cold/seeded tests pass. Actual Inter visits/gather fall 18,432→13,752, but latest large-paragraph assignment Labs remains neutral. Clean-suffix copy artifact dd65dd1e adds 7,571 gzip bytes versus fda6856d; count-changing Labs proves 1,000 first-label length-change engine publication 5.72→4.20 ms and scene publication 6.02→4.42 ms, with four faster/zero slower/42 neutral/one clock-confounded skip. Three exact-artifact GPU captures pass and are inspected. Repeated edit/read/publication remains neutral. Suffix byte movement and owner metadata work remain. This is unfinished performance work, not release-ready behavior; exact artifacts and gates live in the publication tracker.
The later per-owner sparse gather loop is retired: the preceding retained stream either completes or clears
retaining before broad append. The stream, multi-owner replacement and broad writer remain the active paths;
this reachability simplification has no measured speed claim.

The E3 shared-layout experiment selected whole-run shaping for admitted short broad edits and complete gather
reset for certified dense owner frontiers, preserving sparse owners and one executor. Its independent cold gathered
and physical-byte oracle and scoped package/downstream gates pass. The complete same-machine matrix does not admit
it as live: dense and sparse direct-prior p50 worsen, allocator work and shaper size rise, and clock/control movement
limits causal attribution. Preserve its entire correct production variant before restoring the preceding a829/28fd
source. E3 is preserved in full at734dae75 and `experiments/held-shared-layout-hybrid-measured-20261020`; live package source is restored to exact a829/28fd. Fresh package check exits0 and all947shipped dist members match saved28fd. The
[wave record](../log/2026-10-20-held-shared-layout-hybrid-wave.md) and
[portable packet](../../../benches/reports/held-shared-layout-hybrid-local-2026-10-20/README.md) own exact scope and
source-choice state. Fresh independent Sol High owns the comparative reset and next ownership plan. No second
executor, cache, Unicode parser or storage model is selected; parity remains open.

A test-only transport child can replay the exact requests and registration bytes captured from the actual Bitmap
package fixture through the same native engine and wire owners. It reproduces initialization, root/frame capacity,
query receipt and publication-generation lifetimes before byte-comparing encoded results. The trace-requiring test
is explicitly ignored in ordinary suites and executed by the named benchmark authentication workflow. It adds no
shipping entry, Wasm export, parser, semantic executor or storage. One-root direct entry replay excludes native
batch processing, host buffer contents, allocation and latency claims. The
[authentication log](../log/2026-10-20-bitmap-native-replay-authentication.md) records the fixed-source evidence and
review corrections; product performance parity remains unresolved.

The same test-only transport replay now supports a field/physical-work ledger at existing native owners. Counters include accumulated semantic masks, accepted positioned source counts, actual gather dependency reads/writes (including attempted position-only reads before fallback), prepared modes, Codec work and ordered comparison/suppression/emitted bytes. Reuse paths report count availability explicitly. No production executor or ABI is added. The [work ledger log](../log/2026-10-20-bitmap-native-work-ledger.md) owns the exact-source gates and independent corrections; native counts do not establish latency or seven-family parity.

The frame request header uses direct checked writes rather than constructing 35 field/value tuples per setter;
validation labels, field order and little-endian encoding are preserved. The saved bulk profile attributes 20.960 ms
self samples to the former header writer across 20,000 sets. Compiled ABI 7/7, focused Rust, Unicode, static and
docs checks pass. Frozen d96→7620 publication Labs matches 82 cases (30 faster/52 neutral); the 512-label rewrite
is faster, while the 1,024-label publication p50 −3.7% is neutral under the 5% delta threshold. Baseline drift 5.1%
and unrelated row movement limit causal attribution. This wave removes 598 raw/254 gzip Wasm bytes and adds
1,233 raw/120 gzip frame-wire.js bytes; tarball grows 235 bytes. The bulk/main regression and overall size gate remain.
The shared-empty-input experiment is retired. Its exact ABI/setter/recovery tests passed, but seven paired batch
cases yielded six neutral verdicts and one clock-confounded skip, while JS added 77 gzip bytes. The two source files
are restored to the authenticated 7620 header candidate; archived artifacts preserve the experiment's evidence.
No pool or additional preparation executor remains.

The pending paint-partition correction compares effective styles over the shared refinement of old/new ranges.
Changed paint boundaries refresh the existing shaping-run descriptors and cluster style-index mapping without
declaring metric dirt. The cluster refresh preserves layout summaries and boundary caches when geometry is unchanged;
flow preparation uses the actual geometry-change result. Focused cold-output tests pass with actual Amiri ligature,
combining-grapheme, Fredoka boundary-cache and later-width-edit preconditions. Native/Unicode and root build pass.
Frozen candidate 3a397e92 adds 1,442 raw/761 system gzip9 shaper bytes versus 7620; the frame-wire/render-planner
JavaScript hashes are identical. Four-block style Labs matches 17/17: changing-boundary preparation improves
11.063→6.163 ms p50 and prep+publication 12.984→8.086 ms; 15 controls are neutral. Independent cold geometry/paint
checks pass. Batch controls match 7/7, all neutral; 1,024 labels remain 30.688 ms p50. Cumulative release/main, size
and live gates remain open. This private change preserves public signatures and ABI exports.

Certified equal-length ASCII-letter edits retain shaping-run metadata when Unicode, bidi and resolved styles remain
unchanged. The certificate preserves script ranges and hard-break positions; it does not preserve the changed glyph
shapes. The existing shaping executor consumes the active run metadata and still reshapes changed text, using its
ordinary safe-window or whole-run rules. Cold, uncertified and style-dependent changes rebuild metadata normally.
This adds no retained cache, public API or ABI field. The consolidated build/static gate, 469 native tests and
1,045 Node tests pass. Frozen archive58eeb9d4 contains shaper33898e22:1,590,687 raw/596,144 Node-zlib gzip bytes,
127 raw/161 gzip bytes above9a0e. End-to-end timings still describe9a0e; final current-source performance remains open.

The retained gather cleanup removes legacy tail-prefix discovery and its empty-correspondence scope fallback.
Actual replacement correspondence already owns retained provenance; broad fallback uses ordinary ordered admission.
The two private gather wrappers now return unit. Native empty-output and existing recordless-source/cold rendered
snapshot coverage pass; rebuilt package tests include adapter lease preservation. Frozen c42e70a6 reduces shaper by
330 raw/216 system gzip9 bytes against 3a, with unchanged JavaScript. Four-block batch Labs matches 7/7,
all neutral: 1,024 setters plus publication is 29.438→30.439 ms p50 and 32.899→34.433 ms p99;
512-label rewrite p99 moves 15.733→17.062 ms. No speed win is claimed. No new output executor is introduced.

The private replacement scope now derives its clean prefix from the first correspondence record, instead of
accepting a second independently supplied prefix. Empty correspondence uses ordinary complete admission. This
retires the legacy prefix-only interpretation after gather stopped emitting it; seeded tail/abort fixtures use
real owner correspondence. The shared ordered writer and public APIs are unchanged. Validation and size for
this follow-up pass: 437 native units plus outline/Unicode conformance and cold rendered/abort/malformed
scope comparisons. Production shrinks by 13 lines; frozen 53d93a62 shaper shrinks 166 raw/51 system gzip9
bytes versus c42. Four-block multi-owner Labs matches 8/8, all neutral; tails are mixed. No speed benefit is claimed.

The subsequent demand-summary slice uses the same Rust preparation and inspection helpers. Setters prepare layout
with no measurement sidecar for unqueried labels; once requested, a summary remains current on edits. First query
materializes a missing summary before any borrowed glyph callback. Three renderer acceptance refreshes already-requested
bounds from current cached summaries, preserving returned mutable Box3 references. Unqueried Text bounds stay
lazy; explicit measure()/boundingBox materialize them through a closed unrequested/dirty/current cache state. The publication helper now
forwards the borrowed-layout bit, matching query line glyph spans. Native/cold query-publication and static gates pass,
along with 197/197 focused package tests, 142/142 strengthened Three tests and 38/38 TypeGPU checks. The requested
Box3 refresh oracle still requires48 updates and passes. Frozen package4afe4ba2 adds32raw/31gzip Wasm bytes
versus53d; cumulative Wasm growth versusmain is166,424raw/66,169gzip bytes and remains a reduction gate.
Four-block current-main @batch matches7/7 with1 faster/5 slower/1 neutral and no correctness errors:
edit+measure one of100 labels improves .211375→.166833ms p50, while1024 setters+publication regresses
20.370666→26.812376ms p50 (23.295125→30.598917ms p99). Bulk parity remains failed. Subsequent frozen full/main report matches121 with119 comparable:
71 faster/18 slower/30 neutral/2 timing-mode exclusions; median workload p50 2.490→1.770ms. Baseline drift5.5%.
Published0.1.0 uses those saved candidate timings:116 comparable,88 faster/9 slower/19 neutral/3 exclusions;
median3.010→1.900ms. Two candidate-only outline cases are not counted as speedups; separate-run variability applies.
Bulk1024 still costs5.10ms more thanmain and5.73ms more than0.1.0. No reported baseline correctness errors; these
CPU workloads do not prove GPU/FPS or release readiness. Exact reports live under the linked frontier tracker.

The next source slice retires a repeated retained-style validation walk when mutations are empty and grapheme
normalization leaves ranges unchanged. Planner preflight already checks text-dependent ranges/features; engine
registration rejects disposal of stacks referenced by active paragraphs. Mutated/realigned style validation remains
because it supplies resolver order. Native437/outline/Unicode and static gates pass; strengthened existing fixtures
assert exact retained-feature/surrogate faults before preparation and font lifetime across measure/publication.
Rebuilt071ccfe4 passes focused Node183/183; Wasm is1,621,711raw/599,984gzip bytes,803/198 fewer than4af.
Four-block4af→071 assignments are six neutral; batch has one slower/six neutral, rewrite256+0.48ms (+7.7%,p=.029)
with differing baseline/candidate clocks. Performance acceptance remains open. Full-suite results above describe4af. Public signatures
and ABI are unchanged.

The equal-flow runtime experiment was rejected after cold/native438/Node183 correctness passed but paired
assignment12/batch6/style16 controls were neutral (two clock exclusions; style noisy). Its source/tests/patch/b114
artifact/results remain archived. The current restored package is byte-identical to071: full native437/conformance,
static and scoped build/pack pass. No earlier improvements were reverted. The shared monospaced assignment coverage
remains and exposes~190ms broad preparation versus~21ms proportional preparation. Two exact071 execution CPU
captures attribute about70% self samples to authenticated `decode_utf16_range_into`. Our caller decodes entire
UTF-16 context prefixes/suffixes; pinned HarfRust0.12.0 consumes only five codepoints per side. The prescribed
correction bounds context decoding and scratch capacity to that existing scalar contract, preserving the full item
and independent surrogate/slice semantics. Native438/conformance and rebuilt Node183 pass. Exact071→d73b paired
assignment is2 faster/10 neutral/no skips: monospaced broad preparation188.37→21.93ms and edit plus publication
192.20→26.95ms. Primary retains the30-net-production-line fix; Wasm grows1,212raw/217gzip bytes, all JS/other Wasm
are identical. Batch/cold/style controls are complete; cumulative size and live acceptance remain open. Full d73b versus main
reports60 faster/16 slower/50 neutral/one exclusion, median2.545→2.230ms. Bulk1024publication remains
20.68→26.73ms and512rewrite11.61→14.19ms. Published0.1.0 versus the same saved candidate reports
89 faster/2 slower/24 neutral/10 exclusions, but119.1% baseline clock drift prevents release-wide clearance. These
different-font timings do not establish causation or frame-rate behavior.

Setter preparation and ordinary publication share semantic record grouping and projected-owner validation.
The single-paragraph request validates its known owner and borrows the validated batches directly;
publication emits routing spans in the same loop. Neither uses the retired measure cursor helpers.
The empty semantic request preserves its early return. Exact7f579d correctness gates pass; all seven paired
batch cases are neutral, so this consolidation establishes a smaller implementation, not faster execution.
Shaper size is1,622,359raw/599,655gzip bytes; cumulative growth versus main remains an open gate.

The material-lease candidate retains each exact material identity once per existing owner: configured
binding maps authored inputs, and resolved text maps the resulting live bindings. Root, span and inline
references share their owner's lease; accepted/desired owners remain independent. No global cache or
numeric-handle shortcut is used. Caller disposal, failed-input cleanup, distinct material routing and
final retirement have focused coverage. Accepted artifactdf5a771a passes154focused and all1,025Node tests,
static/build and the authenticated15scene/three-raster hero probe onWebGPU/DPR2. All Wasms and declarations
match7f, while runtime JS grows59gzip bytes. Four-block assignment comparison reports2faster/12neutral:
shared-material preparation32.22→24.34ms and publication32.46→25.81ms. Candidate18.5%clock drift and9.3%
between-run difference limit magnitude precision; no broader release parity is established.
The cold control reports three neutral cases. The frozen style replacement reports 17 neutral cases,
with unchanged benchmark-input digests and no correctness errors. The first style run failed that
integrity guard and is excluded from validation; its output remains preserved.

The next isolated Three span-nesting candidate2a86f521 traverses already ordered spans directly and
sorts numeric original indices only when needed, sharing one nesting/duplicate traversal. Range,
surrogate and binding checks remain. Static/build and199focused tests pass, including96seeded
pairwise-oracle cases. Its four-block assignment comparison againstdf5 reports14faster/0slower:
scattered publication24.08→22.81ms, broad25.93→24.41ms, unchanged preparation5.65→4.27ms.
The module adds107gzip bytes; allfive Wasms and224declarations are identical. FullNode passes1,027tests,
and style controls report2faster/15neutral/0slower with noisy baseline limits. Primary accepts the slice
for the paired assignment improvement, not an attributed color speedup.
Authenticated2a86 hero verification passes all15scenes/three rasters onWebGPU/DPR2, with268source
files/five Wasms matching before/after. Primary viewed the saved image; one unidentified404 remains
in logs and no runtime error was reported. The new warmed profile attributes149/150ms self to the
snapshot comparator in flat/depth, motivating the existing-registry own-key slice described below.
GlobalrAF cadence is separate from rendered FPS. Full landscape and cumulative Wasm growth
gates remain open.

Accepted snapshot-key artifact5735b0b6 caches only immutable own-key lists in the existing ownership
registry. One comparator continues to read values and unowned caller keys, preserving cycles, alias
topology, symbols, nonenumerable keys, NaN/-0 and dynamic accessor values. Static/build,207focused and
all1,029Node tests pass. Four-block assignment reports5faster/9neutral/0slower; scattered publication
22.89→21.64ms and unchanged publication4.38→3.98ms. Cold controls are3neutral; style is1faster/16neutral
with13.7%baseline clock drift. The module adds77gzip bytes; allWasms/declarations remain identical.
This does not retire the remaining duplicate span normalization or clear cumulative size/performance.

The next intermediate cutover shares Three/core span snapshot and identity reuse in
`src/config/text-span-owner.ts`. Each boundary retains its original range/error policy; canonical
records copy only declared span fields, own styles and preserve exact binding references. Live binding
checks remain downstream. Static/build and57focused tests pass; production delta+78/−73. Binding
provenance and removal of downstream re-copying are still pending, so this is not a measured speedup
or final acceptance. See the publication frontier checklist and `shared-span-owner-proof/` receipts.

The subsequent data-provenance cutover connects both binding projections to that same owner and
removes configured inherited re-snapshotting and planner normalizeTextInput. Frozen static/build,
64focused and all1,042Node tests pass; shaperSHA4c607d02 remains unchanged. Packed candidate14da7ced
adds128production lines and771summed-module-gzip JS bytes; allfiveWasms and existing declarations
match5735. Four-block paired assignment reports3faster/4slower/7neutral: shared-material scattered
set/publication23.21→21.20ms, but unchanged cases regress0.29–0.41ms. Clock midpoint drift is−1.83%.
The source remains held for performance/size acceptance. The scope guard candidatea475 still reports
unchanged-case slowdowns with7.1%baseline clock drift. Diagnostic callback profiles attribute25,127µs
self to the shared owner versus11,000µs to old Three reuse; these are sampled totals, not latency.
Primary reviewed a one-function policy hoist (net+4lines) with format/static/build,12focused and docs
passing. Its paired assignment/byte gate is queued. No authenticated current hero result exists.
Proofs: `binding-cutover-{acceptance,scope-guard,unchanged-profile,policy-hoist}/`; these gates do not
establish that the frontier is solved.

Authenticated7f source/Wasm browser verification covers Dynamic Layout MTSDF on WebGPU and WebGL2.
The same ASCII hero app passes its all15scene/raster/projection/reduced-motion assertions with7f and
pinned-main c2 on WebGPU/DPR2; primary inspected final captures without an introduced visible defect.
These scoped captures do not prove full backend/DPR parity or paired frame-time performance. Other browser
matrix cells, cumulative size and full release acceptance remain open in the compact tracker.

Retained ordered admission normalizes one nonempty exact whole-input interval to the existing complete physical
ordered walk after mapping, codec, capability and input-count gates. Sparse, empty and multiple intervals retain their
scope; the shared admission body still verifies canonical input mapping, identities and semantic masks. Cold A/B/A
batch-order and abort/retry oracles pass. This removes leaf-local fetches in complete dirt; exact stress Labs remains
neutral, so this is not evidence of release parity or a publication timing win.

Placement-slot identity follows the stable occurrence source rather than the run's geometry revision. Paragraph,
boundary-source, and ellipsis runs remain distinct source kinds, but changing font metrics or other canonical run geometry
does not by itself retire and rewrite the per-glyph placement-slot lane. The run canonical revision still changes
independently and guards static local geometry. In the maintained full font-size update, this separation reduced candidate
publication from 456.5 KiB to 371.3 KiB by removing the redundant approximately 85 KiB occurrence rewrite; the measured
CPU timing change was within noise and is not claimed as a speedup.

The intermediate direct-offset A/B/B/A ordered Bitmap comparison used 40 warmups and two 101-sample passes per revision. Pooled candidate
median/p95 is `2.874 / 2.915 ms` for 21,805 Latin glyphs and `2.233 / 2.258 ms` for 21,978 dense-CJK glyphs. Exact clean
main measures `3.697 / 3.754 ms` for Latin and `2.909 / 2.968 ms` for CJK. The retained candidate is therefore 22.3%
faster at the Latin median and 23.2% faster at the CJK median, with 22.4% and 23.9% lower p95 respectively. Every
active-resize sample still emitted one glyph-wide f32x2 patch—174,440 bytes for Latin and 175,824 bytes for CJK—so these
results establish the retained CPU positioning win but do not measure the current indexed publication path.

A corrected indexed-publication smoke over the same 21,805-glyph Latin resize produced 3,903 active placement rows and
one 31,224-byte session-table patch on every measured update. It produced zero placement-slot writes and zero
static/raster writes because the stable word-root assignments did not change. This is the expected compact transfer shape,
and the five-sample smoke authenticated the dirty buffers and byte count before the full interleaved benchmark gauntlet.

The corrected indexed A/B matrix pools three independent 101-sample passes after 40 warmups for both exact
`2094243668bcf5462cff0ac3b1f7faf52cba3b6c` main and the candidate. Bitmap Latin improves from
`3.741 / 3.829 ms` median/p95 to `2.584 / 2.680 ms` while writes fall from 174,440 to 31,224 bytes; dense-CJK Bitmap
improves from `2.986 / 3.153 ms` to `2.268 / 2.292 ms` while its two alternating states write 103,880 or 109,200 bytes
instead of 175,824. Justified Latin improves from `3.675 / 3.726 ms` to `3.447 / 3.491 ms` and writes 31,344 bytes
instead of 174,440. MTSDF and Slug Latin improve from `4.079 / 4.131 ms` and `4.031 / 4.098 ms` to
`2.683 / 2.708 ms` and `2.639 / 2.743 ms`; both write 31,224 rather than 348,880 bytes. Mixed bidi is the explicit
exception: it regresses from `3.956 / 4.065 ms` to `4.520 / 4.685 ms` while reducing publication from 176,352 to
35,856 bytes. The bidi CPU regression remains open for browser end-to-end attribution; it is not averaged into a general
speedup claim.

A follow-up same-harness A/B/B/A comparison isolates the compact-count and precomputed-anchor change against exact
branch parent `2b6d5eb3`. Each resize pass used 8 warmups and 31 measured samples, pooling 62 samples per revision.
Justified Latin improves from `3.450 / 3.616 ms` median/p95 to `3.218 / 3.251 ms` (−6.7%/−10.1%); mixed bidi improves
from `4.490 / 4.603 ms` to `4.404 / 4.503 ms` (−1.9%/−2.2%); ordinary Latin improves from `2.584 / 2.656 ms` to
`2.540 / 2.624 ms` (−1.7%/−1.2%); and dense CJK improves from `2.293 / 2.324 ms` to `2.278 / 2.306 ms`
(−0.7%/−0.8%). Patch counts and bytes are unchanged: 31,344 justified, 35,856 bidi, 31,224 ordinary Latin, and the
same alternating 103,880/109,200 dense-CJK bytes. A separate 20-warmup, 202-sample-per-revision cold comparison measures
only +0.4%/+0.5% Latin/CJK median; p95 changes −1.9%/+1.5%. The optimized Wasm is 339 raw bytes smaller. This is
incremental attribution against the immediate parent, not a substitute for the final fresh-main performance gauntlet.

The intermediate direct-offset `adopt-position-query` case prepared borrowed-layout positioning before timing the remaining transaction.
For the same final Latin fixture, measurement is `0.220 / 0.227 ms`, measurement plus positioning is
`1.222 / 1.248 ms`, and adoption plus retained gather, plan compilation, and publication is `1.655 / 1.688 ms`. The
dense-CJK publication tail is `0.973 / 0.998 ms`. These phases explain the complete median rather than forming a second
layout path: glyph-wide direct-offset publication was about 58% of the Latin total, per-glyph positioning about 35%, and line fitting
about 8% after rounding.

The current indexed renderer contract is exercised as product code rather than a synthetic placement graph. Direct TypeGPU
renders Bitmap/MSDF/Slug through project Chromium WebGPU with nonzero-alpha counts `2148/2010/1992`. Native Three TSL and
the experimental Three/TypeGPU shader set each pass Bitmap/MSDF/Slug, retained storage/draw, detached-copy, decoration,
and custom-composition gates on WebGPU and forced WebGL2 with identical per-backend counts. These runs close the basic
indexed browser-realization gate; the full editorial pixel/performance and soak matrix remains open. Both Three and direct
TypeGPU store Slug's `placementSlot` in the existing unused `bandCounts.z` lane. Slug therefore retains seven technique
records plus its separate stable-glyph identity record under the eight-buffer Codec contract; its vertex pipeline binds
the seven technique records and reads one shared scene-owned x/y placement table from storage. Placement uses neither a
texture nor an additional Codec buffer or draw. Direct TypeGPU remains a proof-of-concept, but this measured physical
choice no longer exceeds the contract it advertises.

The planner-scoped placement allocator reconciles compact CPU placement topology transactionally and quarantines retired
slots until renderer acknowledgement. Adjacent occurrence ranges with contiguous input ranges coalesce during existing subset admission; complete root coverage uses the same sorted reconciliation executor without per-key sparse searches or repeated occurrence-rope replacement. Sparse gaps keep their original scope. Its focused lifecycle tests validate reorder, retirement, acknowledgement,
abort/retry, and stale-slot reuse directly; there is no parallel run allocator, canonical-update mode, batch identity, or
draw identity. Its desired and occupied values are the planner's `PlacementLogicalKey` directly; the former generic
one-field wrappers carried no additional invariant and are removed. The standalone M1 visual-span and multi-fragment
shadow planners were retired after the complete 12.1–12.5
core, renderer, browser, size, and performance matrix closed; focused production-path regressions remain authoritative.

The final reduction layer removes 4,785 net non-documentation lines relative to the accepted placement-publication
checkpoint without changing batches, primitives, draws, stable identity, or the x/y placement contract. Instrumented
Rust production coverage is unchanged after consolidating six overlapping tests; built-package Node coverage slightly
increases while 241 overlapping cases are removed. A final ownership audit keeps four large Rust modules because they
own different stages: paragraph-local f64 segments, fixed run-local geometry, root occurrence-slot identity and
acknowledgement-gated reuse, and the root f32x2 renderer buffer. The bounded follow-up removes a repeated retained
segment-resolution pass, a duplicate glyph-advance field, fixed per-instance placement-buffer metadata, and the last
wildcard-exported host Codec assembler.

On the rebuilt 20-warmup/101-sample 22k alternating-width harness, the cleaned head measures `1.626 ms` ordinary Latin,
`2.248 ms` justified Latin, `3.565 ms` mixed bidi, and `2.462 ms` dense CJK median, publishing
`30.6/30.6/35.1/96.3 KiB` respectively. The same-host main medians are `3.725/3.281/3.953/2.995 ms`, so all four current
paths remain faster. Against PR #175, the shaper is 7,738 raw / 2,989 gzip / 2,679 Brotli bytes smaller. Three is
8,652 raw / 8,426 minified / 2,203 gzip / 1,728 Brotli bytes smaller; Three+TypeGPU is 8,609 / 8,431 / 2,124 / 1,538
bytes smaller. Direct TypeGPU is +1 raw / −5 minified / +3 gzip / +45 Brotli bytes. Against exact main, the completed
feature costs 161,147 raw / 59,828 gzip / 42,769 Brotli shaper bytes, 27,021 / 6,899 / 5,409 Three bytes, and
7,394 / 1,466 / 1,175 direct-TypeGPU bytes; those are retained feature costs rather than duplicate live-deformation
storage, which is absent.

A ten-window hardware WebGPU dynamic-layout rerun keeps one draw and 387 glyphs in every 120-frame window. The median
window is `0.573 ms` CPU and `0.858 ms` GPU, versus main's same-machine `0.655/0.853 ms`; the CPU path is 12.6% faster,
while the `0.005 ms` GPU difference is noise-level parity. Direct TypeGPU's project-Chromium live gate passes Bitmap,
MTSDF, and Slug with its callback bind groups, placement updates, and disposal lifecycle.

The indexed direction keeps the existing batches, physical instances, primitive spans, and draws. Direct physical
addressing reads `placementSlot[physical]` and the shared session row. A portable `RasterCodec.codecBody` receives
only the frozen renderer capability set and authors glyph-local technique outputs. After authenticating that body,
package-private host assembly appends stable identity, optional transform identity, and the slot store. Codec authors
therefore describe glyph meaning and raster inputs, not slot allocation, tables, bind groups, or backend memory layout,
and they cannot accidentally omit or collide with system lanes. An adapter may keep a separate u32 lane or pack the slot
into a proven-unused technique lane without changing the public Codec plan or creating a run/slice batch key.

An earlier indexed cleanup checkpoint remained 4–5% slower than main while still publishing the baseline 170.4/171.7 KiB;
that result is negative evidence about the incomplete implementation, not the current 31,224-byte publication shape. The
intermediate direct-offset candidate isolated a real retained CPU speedup but preserved glyph-wide transfer. The current
indexed candidate combines that retained positioning work with compact session rows. Its immediate-parent A/B is
directionally positive across ordinary, justified, bidi, and dense-CJK resize. A subsequent same-machine A/B/B/A against
freshly fetched `origin/main` `ee56fa48` (README-only after the byte-identical `20942436` shaper) used 20 warmups and 101
measured updates per pass, pooling 202 samples per revision. Candidate `8221aa87` improves ordinary Latin from
`3.725 / 3.856 ms` median/p95 to `2.523 / 2.594 ms` (−32.3%/−32.7%), dense CJK from `2.995 / 3.040 ms` to
`2.261 / 2.291 ms` (−24.5%/−24.6%), and justified Latin from `3.281 / 3.685 ms` to `3.195 / 3.276 ms`
(−2.6%/−11.1%). Mixed bidi regresses from `3.953 / 4.071 ms` to `4.407 / 4.516 ms` (+11.5%/+10.9%) even though
publication falls from 176,352 to 35,856 bytes. The fresh-main CPU/publication comparison is therefore complete but the
performance gate remains open on mixed bidi and the full browser/editorial matrix.

The subsequent lazy-absolute-semantic checkpoint removes the remaining width-only semantic position rewrite rather than
changing line fitting, batching, draws, or the renderer placement contract. Two final 20-warmup/101-sample passes pool to
`1.562 / 1.615 ms` median/p95 for ordinary Latin, `3.437 / 3.491 ms` for mixed bidi, and `2.277 / 2.298 ms` for dense
CJK. Justified Latin pools to a `2.229 ms` median; one pass suffered unrelated host stalls, while the independent clean
pass measured `2.189 / 2.210 ms`. Compared with the recorded same-host fresh-main medians (`3.725 / 3.281 / 3.953 /
2.995 ms` for ordinary/justified/bidi/CJK), all four paths are now faster, including mixed bidi by 13.0%. Each update
still publishes only the compact placement data: 31,224 bytes ordinary, 31,344 justified, 35,856 bidi, and 98,560 bytes
across three dense-CJK patches in this final state. The exact package gate passes 982/982 tests plus Rust, type, fuzz,
and format checks. The subsequent browser gauntlet passes all 120 Presentation cells: both native TSL and Three/TypeGPU,
10 workloads, WebGPU/WebGL2, and Bitmap/MTSDF/Slug. Editorial preserves exactly three draws and measures
`0.990–1.710 ms` median reflow across those full runs. Direct TypeGPU's dedicated Chromium WebGPU gate also passes all
three rasters. The reviewed size check accepts a 554-byte raw shaper increase (0.04%); adapter and font sizes are
unchanged. There is no remaining known CPU, publication, renderer, or size regression in this cutover.

Final reduction removes the compile-time justification and text-effect specialization axes from the positioning
traversal. Both conditions are invariant for a fragment or build, and the specialized forms duplicated most of the same
machine code to avoid only a small adjustment tail or optional effect-lane append. One runtime traversal removes 80 Rust
source lines and 26,486 raw / 3,200 gzip optimized-Wasm bytes. A 22k A/B/B/A keeps ordinary, bidi, and dense-CJK width
medians within 0.3%; the longer 501-sample justified comparison is within 0.34%, with identical patches and write bytes.
This is accepted as prediction-friendly parity rather than preserving duplicated code for an unmeasured theoretical win.

The remaining justified penalty was not the integer division or SIMD space scan. Trivial-order positioning had selected
one placement segment per cluster whenever any justification was nonzero. Word-space-only distribution now reuses the
existing stable word/numeric-block segmentation and ends a segment immediately after each adjusted space; nonzero
letter-gap distribution retains cluster granularity because every gap can move the next glyph. A 50-warmup/501-sample
A/B/B/A reduces the 22k justified median from `2.067–2.077 ms` to `1.500–1.510 ms` with the same one patch and 30.6 KiB
write. Ordinary and mixed-bidi controls remain `1.538 ms` and `3.321 ms`. The optimized shaper grows by 175 raw / 162
gzip / 34 Brotli bytes. The existing exact F16.16 quotient/remainder arithmetic and `simd128` flag scan remain
authoritative; no aggregate-count line format or second justification model is added without evidence that the retained
scan is material.

The benchmark also owns a `position-query` case that runs the same break-changing flow and positioning tail through the
borrowed-layout mask while excluding gather, plan compilation, publication, and inspection copies. On the pinned M4 host,
623 rendered Bitmap glyphs measured `0.061 ms` on the frozen main baseline and `0.109 ms` after the initial cutover;
shrinking the shipping run-local glyph row reduced the frontier result to `0.105–0.106 ms`. Direct row addressing for
source-order runs then reduced a stable 22k-glyph positioning comparison from `2.776–2.823 ms` to `2.695–2.701 ms` without
changing RTL/fallback lookup. The matching complete 22k active-resize path improved from `4.067` to `3.893 ms` for Latin
and from `3.650` to `3.607 ms` for dense CJK. Embedding each retained local raster origin in the existing 64-byte
`LayoutGlyph` row then removed two parallel per-glyph vectors and their retained-copy/gather traffic. On the exact rebuilt
source, complete Latin measured `3.864 / 3.994 ms` median/p95 and dense CJK measured `3.195 / 3.218 ms`, with low
`2.21% / 1.23%` relative standard deviation. This confirmed that duplicate origin storage materially amplified the dense
CJK regression, but that earlier incomplete indexed design still did not beat the same-contract baseline.
Those measurements remain attribution history rather than the current package state.

The final ordered-only verification uses exact `origin/main` `ee56fa48` and cleanup head `8457073d`, with two passes per
revision, 20 warmups, and 101 measured updates per pass. Pooled medians/p95 are `1.489/1.581 ms` ordinary Latin,
`1.508/1.589 ms` justified Latin, `3.229/3.351 ms` mixed bidi, and `2.264/2.357 ms` dense CJK. The matching main values are
`3.639/3.784`, `3.698/3.898`, `3.882/4.027`, and `2.897/3.002 ms`, so every final path is faster by 16.8–59.2% at the
median. Publication falls from 174,440/174,440/176,352/175,824 bytes to 31,352/31,352/35,896/98,560 bytes. Relative to
PR #175, the final shaper is 85,192 raw / 26,476 gzip / 15,688 Brotli bytes smaller; browser core is 1,090 / 223 / 82
bytes smaller; Three is 11,217 / 2,790 / 2,223 bytes smaller; direct TypeGPU is 777 / 186 / 104 bytes smaller; and the
combined adapter graph is 11,170 / 2,764 / 2,292 bytes smaller. Relative to main, the retained feature costs 83,693 raw /
36,341 gzip / 29,760 Brotli shaper bytes, 10,837 / 2,808 / 2,185 browser-core bytes, 24,456 / 6,312 / 4,914 Three bytes,
and 6,616 / 1,277 / 1,026 direct-TypeGPU bytes. These are generated-artifact measurements on the pinned arm64 host; the
repository size gate accepts them.

[^slug-shader-core]: The directory is the single renderer-independent expression of the analytic Slug fill algorithm.

## TypeGPU application integration

`defineTypeGpuConfig({ root, format, sampleCount?, depthStencil?, transformPosition?, transformColor? })` accepts a
caller-owned TypeGPU root and attachment settings, with optional GPU callbacks.
`glyph.handle(name, config)` exposes `createText()` and `draw(pass, { width, height })`; named roots retain independent
publications. The adapter uses public GlyphConfig services and portable bitmap, MSDF, and Slug codecs with direct,
ordered draws. It neither imports Three.js nor submits during `glyph.shape()`. The application ends and submits its pass.

Text options include a loaded FontFace, content, style, paragraph layout, constraints, raster pixel ratio, and 2D position.
MSDF supports outline and shadow. `transformPosition` maps top-left, y-down logical pixel positions (after text translation)
to homogeneous clip coordinates. `transformColor` receives straight RGBA after coverage/effects plus physical fragment
coordinates. Both callbacks are fixed per config and may capture caller-owned uniforms for changes without reshaping.
TypeGPU slots bind them independently per pipeline. Handles and named roots expose `.with(bindGroup)`, returning
an immutable, reusable `TypeGpuDraw` view. Chaining replaces earlier groups for the same layout identity without mutating
parent views; each draw forwards the groups through TypeGPU's pipeline `.with()` API for every retained raster span.
Binding groups does not reshape text or rebuild pipelines. The originating root owns the draw view's lifetime; caller
resources stay caller-owned. TypeGPU reports missing required groups at draw time. Slug estimates its screen-space dilation using nearby projections;
this supports matrix projections exactly and nonlinear deformations approximately. Optional depth state must match the
caller-owned pass attachment; transparent text uses caller-controlled depth writes and ordering.
Decoration lines, rich spans, and third-party raster programs are not part of this high-level API. Renderer buffers and textures are released with their owning roots/resources;
the caller's TypeGPU root stays alive. Shader-only consumers use `/shaders/typegpu`, including independently importable leaves.

The [TypeGPU hello-world package](typegpu-hello-world.md) supplies the application and GPU verification workflow.
MSDF retains Euclidean UV derivative lengths so its antialiasing footprint is invariant under screen rotation.
Both direct TypeGPU and experimental `/three/typegpu` use the shared shader's `std.dpdx`, `std.dpdy`, and `std.inverseSqrt` operations.
TypeGPU 0.12.5 and `@typegpu/gl` 0.12.4 translate these operations to GLSL equivalents; these releases are also
the minimum supported peer versions.
Slug rejects a sorted band's terminating curve before root eligibility and solving;
the emitted WGSL and GLSL checks hold that ordering.

The direct renderer stages owned patch payloads during decode and applies mutations only at commit. Same-capacity
updates reuse CPU storage, GPU allocations, and unchanged draw bindings; uploads cover merged changed ranges, bounded
to 32 ranges per buffer. Resizing replaces storage, and discard releases staged allocations without changing accepted
bytes. A real-engine integration test checks localized edits, allocation and upload costs, rejection, and cold-publication
parity. These are structural cost checks, not GPU timing claims.
The focused TypeGPU suite checks real engine publications, named-root isolation, failed input, updates, and disposal.
The browser probe renders all three formats, checks nonzero alpha, updates, idle frames, empty text, and shared-pass use.
It also verifies uniform-driven perspective and color changes without reshaping, fragment-position access, depth
occlusion, offscreen clipping, and isolation between custom callbacks and the default configuration. Explicit bind-group
checks cover vertex/fragment layouts, replacement, parent-view isolation, missing bindings, named roots, and disposal.

The Three split is exercised through `pnpm scripts run benchmark:v1-bitmap`, with `-- --typegpu` selecting the experimental entry. The same Bitmap, MTSDF, Slug, decoration, retained-update, detached-glyph, and custom-material assertions run on WebGPU and WebGL2 for either config. A focused package test also runs one Bitmap-plus-decoration material factory through `/three` and `/three/typegpu` and requires the same shader context. The packed-consumer test bundles the root and stable `/three` while rejecting any TypeGPU peer request, then proves the TypeGPU shader, direct-renderer, and Three bridge entries both request their optional peers and bundle when those peers are supplied externally.

The split verification on 2026-09-07 passed both browser workflows. Bitmap produced 3,109 lit pixels with native TSL and 2,685 with the experimental shaders on each backend; custom Bitmap composition likewise produced 2,642 versus 2,185. MTSDF and Slug lit-pixel counts matched in these fixtures. These checks establish rendering and lifecycle behavior, not complete visual parity; the Bitmap difference remains a reason to keep the experimental entry separate.

Published distributions include hidden JavaScript source maps and referenced declaration maps. The build rebases staging-relative source paths onto the packaged source tree before atomically publishing dist; packed-package checks verify every map source and declaration reference resolves inside the installed package. Hidden JS maps add install bytes but no runtime imports or browser map requests. The repository-only raster-baker profiler is excluded together with its source and maps.

## Retained host topology publication

Rust distinguishes fresh primitive metadata from structural host bindings using the existing result flags. A non-checkpoint publication may certify unchanged draw order, physical storage generations, clip/material/resource bindings and instance spans while still publishing complete fresh identities, semantic metadata and bounds. JavaScript combines that proof with unchanged transform membership and lifecycle order. Replacement of session placement storage revokes the proof.

The existing display-list replacement carries an optional retainedTopology hint; it does not create a second publication executor. Three retains accepted meshes and bindings for certified metadata changes, applies buffer patches, refreshes matrices and repairs detached mesh parenting. Direct TypeGPU retains its accepted draw spans. Checkpoints and structural changes continue through full replacement.

Schema constructors remain the authority for renderer-specific bindings. Integrators opt in with preservesHostTopology only when primitive metadata cannot change host bindings and skipped constructors have no required side effects. defineGlyphSchema binds that promise to the constructor identities: spreading a built-in schema and overriding a constructor automatically revokes inherited certification. Complete lazy metadata remains available during the synchronous command-buffer borrow.

Merged #299 at `9022bb40087afaedce83de2fef38627d283828e7` passed final rebuilt local validation: 341 native Rust tests and 974 Node package/integration tests, plus types, lint, formatting and documentation checks. Final correctness/maintainability review cleared the implementation; the subsequent full v0.1.0-to-main static review found no additional runtime or architecture defects. These reviews did not execute tests. Exact-head CI run 38093741115 passed all five jobs, including 16 browser conformance cases, packed-consumer checks and TypeGPU GPU proof. The reviewed PR head, CI merge checkout and merged main share the same tree.[^query-first-ci]

The frozen CI package SHA-256 is `c2ea9cef0c24f8a553b9d213b9f9b66bedc049d04e67cefcc0883469e51103cc`; its shaper SHA-256 is `dc0d918f28e67591417ecd29c86d442b9fc8d703a992781fc25803b05f415403`. The archive contains 1,217 files and 3,099,916 bytes; repository-only profiler files and fingerprint filenames are absent. CI delivery-size deltas versus the immediate base are Core JS +0.19%, Three adapter +0.28% and Shaper Wasm −0.24%; fonts and bakers are unchanged. The adapter rows overlap and must not be summed.[^query-first-ci]

The eight-block installed-package glyph comparison versus pre-PR main reports 2 faster, 0 slower, 10 neutral and no excluded workloads, baseline correctness failures or timing-mode mismatches. Edit plus independent copy improves from 3.48 to 3.22 ms for one label and 13.07 to 7.60 ms for one among 1,000. Neutral increases remain visible: width inspection plus publication adds 0.55 ms, and cached 100-label metric copies add 11.07 µs. These focused CPU workloads do not establish release-wide parity or FPS.[^query-first-ci]

The full published 0.1.0 comparison against this frozen merged-main package remains in progress. The supplemental pre-query main `30391d02` report has 56 faster, 3 slower, 43 neutral and two timing-mode exclusions, with zero correctness errors and 8.3% baseline clock drift. It does not clear the newly merged query change. #247 remains an open performance frontier; #240's whole-root publish-on-read proposal and rope draft #292 remain held.[^release-comparison]
