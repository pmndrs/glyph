---
type: Workspace Package
title: '@pmndrs/glyph'
description: Implements portable font loading, retained Rust shaping and layout, renderer-directed command planning, and maintained Three.js and React Three Fiber adapters.
resource: ../../../packages/glyph
workspace_package: '@pmndrs/glyph'
documentation_type: reference
source_digest: 'sha256:fe55c1b820b029f192facb613ec4f5b22860660fffadbc6a5e797d2c1d11bdb2'
tags: [package, public-api, rust, wasm, threejs, typography]
sources:
  - id: manifest
    resource: ../../../packages/glyph/package.json
    title: Package manifest
  - id: release-workflow
    resource: ../../../.github/workflows/release.yml
    title: npm canary release workflow
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
  - id: tsl-shaders
    resource: ../../../packages/glyph/src/tsl.ts
    title: Technique shader library layer
  - id: three-api
    resource: ../../../packages/glyph/src/three.ts
    title: Three.js public exports
  - id: three-text
    resource: ../../../packages/glyph/src/three/text.ts
    title: Three.js retained text lifecycle
  - id: three-plan
    resource: ../../../packages/glyph/src/three/engine-plan-target.ts
    title: Three.js render-plan executor
  - id: three-config
    resource: ../../../packages/glyph/src/three/handle.ts
    title: Built-in ThreeConfig and handle factories
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
  - id: engine-design
    resource: ../planning/rust-layout-engine.md
    title: Rust text engine and render-plan design
  - id: core-api-reference
    resource: ../planning/core-api.md
    title: Core text API reference
  - id: three-api-reference
    resource: ../planning/three-api.md
    title: Three.js text API reference
  - id: detached-glyph-slice
    resource: ../planning/detached-glyph-slice.md
    title: Planner-assisted detached glyph slice
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-28T20:10:29Z'
---

# Package reference: `@pmndrs/glyph`

Status: foundation merged; canary publishing configured while publishing-feature stacks continue

## Ownership

The package owns six runtime layers:

| Layer                    | Owner                 | Responsibility                                                                                                                        |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Root runtime and config  | TypeScript core       | Initialize one Glyph engine, construct named adapter handles, and coordinate projection/decode/commit transactions.                   |
| Font and raster loading  | TypeScript core       | Read portable GLB envelopes, register shaping payloads, decode selected raster resources, and retain font identity.                   |
| Shaping and layout       | Rust/Wasm             | Unicode analysis, bidi, font fallback, shaping, line composition, positioning, ellipsis, and semantic query state.                    |
| Codec and command buffer | Rust/Wasm             | Interpret a validated Codec, pack canonical technique records, coalesce dirty ranges, and emit a compact command buffer.              |
| Three.js integration     | `@pmndrs/glyph/three` | Compile Codec programs, resolve font/material resources, apply command-buffer deltas, upload dirty ranges, and maintain draw proxies. |
| React integration        | `@pmndrs/glyph/react` | Reconcile React values into the same imperative `Text` and `TextGroup` objects.                                                       |

Runtime Rust and all shared Rust code remain `no_std + alloc` compatible with the package allocator contract. The optional
font-baker Wasm alone enables a feature-gated `std` adapter for Fontations subsetting; the same crate continues to
pass its `wasm32-unknown-unknown --no-default-features` build. The text engine uses the existing compile-time direct-memory mapping
for font registrations. Ordinary publication enters once through
`pmndrs_glyph_engine_update_batch(entriesPointer, count)`, whose entries address the already-written request slice and
existing A/B result storage for each dirty root. Paragraph-scoped semantic queries remain separate synchronous calls.
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
than rescanning every table, scalar, and registration on every frame.
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

The `/config/*` leaves contain only renderer-neutral authoring operations. Package registries and identity maps, compiled
Codec-body authentication, system-lane normalization, and Glyph's reserved built-in raster registration path stay under
`src/internal`; they are neither root exports nor wildcard subpath APIs. Integrators can register their own portable raster
Codecs through `registerRasterCodec()` and can normalize a renderer-owned capability set explicitly when composing
config helpers.

## Public package surfaces

| Subpath                      | Purpose                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `@pmndrs/glyph`              | Root `glyph` runtime plus application-facing FontFace/font/raster contracts, fallback stacks, formatting helpers, and paragraphs. |
| `@pmndrs/glyph/config/*`     | Renderer-neutral GlyphConfig, Codec, schema, raster-format, and portable-resource helpers for integration authors.                |
| `@pmndrs/glyph/three`        | Built-in `ThreeConfig`, handle-created `Text`/`TextGroup`, material factories, and Codec registration.                            |
| `@pmndrs/glyph/react`        | `GlyphProvider`, React `<Text>`, `<TextGroup>`, and `useFont`, reconciled through React Three Fiber.                              |
| `@pmndrs/glyph/react/bitmap` | Typed `useBitmap(input, options)` convenience over `useFont`.                                                                     |
| `@pmndrs/glyph/react/msdf`   | Typed `useMsdf(input, options?)` convenience over `useFont`.                                                                      |
| `@pmndrs/glyph/react/slug`   | Typed `useSlug(input)` convenience over `useFont`.                                                                                |
| `@pmndrs/glyph/bake`         | Node programmatic font baking, glyph selection, and font inspection used by the `glyph` CLI.                                      |
| `@pmndrs/glyph/runtime-bake` | Explicit browser Worker host for optional runtime baking.                                                                         |
| `@pmndrs/glyph/raster/*`     | Renderer-neutral Bitmap, MSDF, and Slug decoding and raster-technique contracts.                                                  |
| `@pmndrs/glyph/tsl`          | Canonical TSL shader realizations of the first-party technique interfaces; no scene integration.                                  |
| `@pmndrs/glyph/typegpu`      | Canonical TypeGPU shader realizations of the first-party technique interfaces; no scene integration, no engine driving.           |
| `@pmndrs/glyph/bakers/*`     | Optional portable raster bakers.                                                                                                  |

The three renderer-neutral raster leaves retain portable Codec-registration side effects under tree shaking. Built-in
Three material realization imports its TSL shader implementations directly rather than routing through package
self-imports or a module-global shader registry; `/tsl/*` remains the direct public shader surface for application
composition. The unshipped `/three/bitmap`, `/three/msdf`, and `/three/slug` forwarding aliases were removed: applications
import portable formats from `/raster/*` and shader builders from `/tsl/*` without paying for wrapper modules.
Every TypeScript subpath also publishes a custom `source` condition. Workspace Vite applications opt into that condition
for direct TS/TSX hot reload, while ordinary Node and package consumers continue to resolve built declarations and ESM.
Wasm and `package.json` exports remain distribution artifacts because they have no TypeScript source equivalent.

The font-baker Rust source, direct-memory wrapper, schemas, tests, build pipeline, optimized Wasm, and generated ABI are
owned by this package. There is no separately published font-baker package. The root entry has no static edge to the
baker, its `std`-enabled dependencies, Ajv, glTF Validator, or the baker Wasm; only explicit bake/runtime-bake surfaces can
load those bytes.

The TypeScript paragraph engine, paragraph batches/attachments, direct shaping exports, and the text-preparation Worker
are removed. TypeGPU is a later adapter stack built against the Rust render plan; it is not a compatibility wrapper over
the removed batch model. The exception is the `@pmndrs/glyph/typegpu` shader library, which publishes the same technique
realizations as `/tsl` as typed TypeGPU functions for any WebGPU host; `typegpu` is an optional peer and the root entry
has no static edge to it.

The package-owned `glyph` executable is available through `pnpm exec`; its `bake` command supports both project discovery
and a direct known-font mode. Its stable packaged shim delegates to the built Node CLI, so workspace installs can link the
executable before `dist` exists. Direct mode accepts one input/output pair, a collection face, optional shaping-font
Unicode subsetting through the package-owned Fontations/Skera baker Wasm, and independently selected embedded Bitmap,
MSDF, and Slug rasters. The prepared source bytes feed the core shaping bake and every selected raster bake; neither the
CLI nor the programmatic `@pmndrs/glyph/bake` path invokes a platform font tool. `--check`
publishes only to temporary storage and compares the complete GLB byte-for-byte with the requested output. It calls the
same `bakeFont` host as programmatic consumers rather than maintaining an example-only composition path.

The `glyph glyphs` command uses the same package-owned baker Wasm and Skrifa to enumerate Unicode mappings, exact glyph
IDs, and names retained in a font's `post` or CFF data. Exact repeatable `--name` filters can emit structured JSON or a
compressed `--unicode-set` accepted by `glyph bake --unicodes`. Fonts without authored names still expose exact IDs rather
than invented semantic labels. Rich vendor labels and aliases remain external catalog data.

R3F `<Text>` and `<TextGroup>` expose no handle prop. They read a selected `ThreeHandle` or terminal `ThreeRoot` from the
nearest optional `GlyphProvider`, or suspend on one module-owned default Three handle that calls idempotent `glyph.init()`
and installs `ThreeConfig` once. `handle="surface"` is shorthand for the idempotent `defaultHandle('surface')` named root;
an omitted provider selection still uses the Canvas-local default root. A provider captures its initial selection and `fontFaces` alias table and never updates
the context value; selecting another root, handle, or alias table requires remounting the provider. Context is constructor dependency
injection only: it owns no engine, runtime, scene, renderer, canvas, publication cursor, or semantic resource cache, and
it never disposes an externally owned handle or FontFace. It disposes only FontFaces it declared from shorthand table
entries. Supplying `fontFaces` or `fallback` adds a local Suspense boundary; `errorFallback` handles only `FontLoadError`
and rethrows unrelated errors. Imperative construction uses `handle.createText()` and `handle.createTextGroup()` for the
anonymous root, or `handle(name).createText()` and `handle(name).createTextGroup()` for a named root.

The public `ThreeRoot` contract stops at that retained scene API: identity and disposal, Text/TextGroup construction,
counts, and mutable material presentation. The renderer draw object, discovered Three Scene, root services, command
boundary, and Font lease acquisition belong to the package-owned root host. They are unavailable through both source
conditions and built declarations; package internals recover the host through private identity rather than exposing a
second renderer/runtime object to applications.

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
cannot repeatedly allocate large Wasm memories; a full page or module replacement is the retry boundary. Vite HMR carries
the process-local Glyph runtime through replacement data instead of instantiating a second engine. React still checks
synchronous initialized and loaded state first, so ready renders do not enter Suspense or cross a microtask. Pending font
loads use `suspend-react` only as React's stable suspension cache; Glyph's FontFace resource graph remains the semantic
cache and lease owner. Each FontFace selection retains one Promise for the lifetime of its declaration-owned load record;
disposing the face releases that record, and a rejected font operation is evicted so an explicit later load can retry.

The R3F `Text` component infers the raster-format union from a required outer font selection, including a font stack chosen
from runtime state. Callers do not widen dynamic selections to `AnyRasterFormat`. A nested `Text` is flattened into
an inline styled run and may omit `font` because it inherits from its enclosing paragraph; a rendered outer `Text`
without a font is invalid. Nested text creates no Three object and accepts only `children`, `font`, `style`, `paint`, and
`material`. Because JSX erases the generic element identity needed to reject every box-only prop statically, the
flattener validates this boundary synchronously and names any invalid property instead of silently discarding it.
`TextGroup` owns nestable hierarchy and presentation inheritance, never font inheritance or a planner boundary. Both mounted components register their Three
objects with the R3F host and are constructed during its commit rather than in a layout effect. React `Activity` can
therefore pre-render a hidden text or whole text group, while R3F retains visibility and eventual disposal ownership.

Structural `txt`/`span` values and nested React `<Text>` are the only public rich-text authoring paths. They compile one
immutable string and internal span records, then resolve their derived joins onto the extended grapheme-cluster grid
before a frame is built (D-265). Public `Text` and `Text.set()` inputs reject a parallel raw `spans` field;
callers therefore cannot forge offsets, split a cluster, or keep a mutable range table synchronized with text. Internal
alignment remains a compiler backstop because concatenation can fuse the tail of one fragment with the head of the next.

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
technique instead of applying to nothing. Snapshot tracking uses weak registry references, so an abandoned runtime cannot
keep its identity registry alive or permanently poison later registration after collection. `/three` also re-exports
`ParagraphLayoutSummary`, `GlyphLayoutInspection`, `ParagraphLayout`, `ParagraphMeasurement`, and `FontFeature`, so a
`/three` importer can name what `Text.measure()`, `Text.glyphs()`, and `TextStyle.features` give it.

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
Explicit `Text.measure()` and `Text.glyphs()` calls synchronously query one Text through its selected handle. They may pay
one additional Wasm crossing, but do not traverse a scene, publish commands, or realize renderer resources. Normal
rendering still publishes every dirty root through one `glyph.shape()` crossing. The former renderer-free
`createParagraph()` path was removed because its private engine, handle, Codec, planner, font bindings, and caches
duplicated the GlyphConfig pipeline (D-339).

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

React's `useFont(source, config?)` declares through that same FontFace path, asks the selected Three handle which exact
format the declaration denotes, enters the shared `suspend-react` resource only while that format is unloaded, and returns
an independently mounted immutable Font lease. Single-technique
consumers may import `useBitmap`, `useMsdf`, or `useSlug` from the matching `/react/*` subpath. Each wrapper only builds its
typed format request and delegates to `useFont`; readiness, canonical source/format identity, and mounted disposal have
one implementation. Every hook carries Promise-returning `preload()` and declaration `clear()`. Clearing a declaration
does not invalidate an independently mounted Font or Text lease.

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
technique identifier. Decorated render planners rebuild their gather output; the undecorated retained fast path is unchanged.

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

Every handle owns one anonymous root, and `handle(name)` idempotently selects named sibling roots. Each root owns one Rust
render planner and one renderer draw root. It may bind to at most one Three `Scene`, discovered from its attached Text
members by object identity; a root name is stable semantic/customization metadata, not a `Scene.uuid`. A second Scene
therefore uses another named root. Returned roots are terminal and cannot create deeper roots. `TextGroup` remains freely
nestable for scene hierarchy, transform/visibility inheritance, material selection, pixel snapping, and render order, but
does not create another planner or publication stream. Capacity and compositing are immutable `ThreeConfig` policy shared
by the anonymous and named roots of one handle; selecting different policy means creating another handle from
`defineThreeConfig(...)`, not mutating a live root. Per-root, group, Text, and span material selection remains retained
scene state because it describes authored presentation rather than renderer policy. A traversal sends only changed
paragraph sections:

- text replacement sends text plus any dependent style/geometry state;
- font, spans, shaping style, paint, raster ratio, or material send style state;
- content-box changes send geometry;
- transform and visibility changes update Three's renderer-local sidecar without calling Wasm;
- an empty or normalized-equal update sends nothing.

Three's ordinary scene traversal owns world-matrix composition. The root observes Text membership and ancestor state,
publishes semantic changes once at its renderer-owned draw node, and patches root-relative transforms through a separate
engine-free side path. Camera motion does not republish text. Text, nested `TextGroup`, and other ancestor motion,
visibility, reparenting, and manual matrix changes patch only affected renderer-local slots and do not enter Wasm.
Each traversed Text reports only its own current Scene. When that Scene and the renderer-owned draw object are unchanged,
observation returns without allocating or scanning sibling Text instances. A full membership scan is reserved for an
actual Scene transition or a detached draw object, including recovery after a host clears and reattaches the authored
scene tree.

Rust publishes one revision containing:

- engine and command revision headers;
- physical-buffer allocation and retirement commands;
- coalesced per-buffer dirty byte ranges;
- resource bindings;
- ordered draw commands with technique/program, resource, material, transform, and clip identity;
- optional semantic measurement or inspection sections only when explicitly demanded.

Metric-only style changes refresh retained shaping-run typography before cluster aggregation but reuse the HarfRust glyph
result. Font size, letter spacing, word spacing, line height, and baseline changes therefore rebuild advances and
positioning without treating glyph identities as newly shaped content. A public optimized-Wasm regression doubles a
paragraph's font size and proves its retained inline advance doubles; the live Paragraph Stress scene additionally keeps
correct spacing through intermediate animated sizes for Bitmap, MSDF, and Slug.

The Three executor does not infer paragraph layout from GPU records and does not maintain a parallel candidate/current
target state machine. It applies the Rust command buffer transactionally and retains only renderer resources required by
future deltas. Portable payload bytes are already shared by `LoadedFont`; Three's current GPU texture realization remains
render-planner-local. Pooling those immutable device objects above render planners is a Three implementation follow-up, not a core scene,
device, render-pass, or implicit-standalone-batch API.

A paragraph's content box may declare `columns: { count, gap }`, flowing text through side-by-side ordered columns inside
the exact content-box width. Columns fill in order without balancing, so the final column may run short, and an exact
`width` is required because the column advance is derived from it. Ordered columns are the only multi-interval flow the
engine represents; balancing, exclusions, and contour flow remain post-v1.

## Renderer Codec

Each portable technique registers a schema, Codec-body factory, and cold font compiler through the root package. Three
registers only the renderer half—resource realization and material creation—then assembles the complete Three Codec
program from the portable body. Rust validates and interprets the compiled Codec; it never invokes a JavaScript callback in
shaping, layout, or packing. Cold resource selection receives explicit `(glyphIndex, strikeIndex)` coordinates; the
compiler alone lowers them into the strike-major wire table. Three validates declared reserved supplied-geometry
semantics when a variant registers, then validates every retained payload attribute when a font is bound, before device
realization. Material contexts retain the discriminated `PortableResource` union rather than erasing validated payloads
to `unknown`.

CPU reference renderers and allocation diagnostics may pair `compileRasterFont()` with `readCompiledRasterFont()`.
The authenticated read-only view resolves schema field names, strike rows, selected resources, and portable payloads
directly from the compiled binding. It does not expose technique-private decoded font data, perform another raster
decode, or copy the binding's scalar value tables; ordinary renderers continue through their render-planner target.

Portable resource declarations select `one` or `many` cardinality. Fixed-member groups carry synchronized leaf buffers
and textures under one retained identity; groups cannot nest, geometry cannot repeat, and every resourceful schema names
the primary render resource used by the command-buffer primitive. Bitmap repeated strikes, MSDF atlas/range companions, and Slug
repeated page groups all compile through this contract. Capability profiles contain capabilities only;
`compileCodec()` assigns their nonzero wire IDs by descriptor order, and ordinary single-profile frames omit the
selector.

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
draws by transform for integrations that prefer ordinary object matrices. Codec programs may use ordered-direct or
stable-indirect physical storage. Stable draws carry one reserved u32 order buffer; Three validates its draw/primitive
addressing once, then uses the same logical-to-physical mapping for technique records, transform indices, explicit origin
queries, and third-party program material contexts. Root `compositing` determines whether Rust must preserve authored
ordering or may reorder independent work. Ordered-direct remains the first-party default until stable planning meets the
same tail-latency target.

`materialId` is explicit through the frame ABI and render plan. Three maps it to a `defineTextMaterial()` factory. Material
identity may split draws without forcing a second copy of the canonical glyph buffers.

Bitmap atlas pages within one strike are renderer layers, not independent draw resources. The font binding exposes one
strike resource, the Rust Codec program writes the selected page as one u32 instance lane, and Three uploads the strike as one
R8 texture array. This preserves authored glyph order while preventing page transitions inside ordinary prose from
splitting a paragraph into hundreds of draws. The multi-page integration fixture asserts one ordered draw and a live
Chrome run reduced the sampled Paragraph Stress CPU frame from roughly 80 ms before the correction to 0.47–1.3 ms after
it; the sampled GPU frame remained a separate 1–5 ms concern.

## Font fallback and raster formats

`createFontStack()` accepts fonts from one runtime in explicit fallback order. Members may use different raster formats.
The font carries both shaping identity and raster binding, so `Text` has no redundant format property. Rust resolves the
font for each cluster and partitions the render plan according to the active renderer's supported Codec programs.

This permits an MSDF or Bitmap prose font to fall back to a Slug emoji font while keeping third-party renderers safe: an
unregistered raster format fails at the Codec boundary instead of producing an unsupported draw.
A public compiled-Wasm integration loads Bitmap Inter plus Slug Font Awesome, shapes one paragraph through that ordered
fallback stack, and observes two Rust-planned draws with exact Bitmap `vec2` and Slug `vec4` physical records. The
selected font binding—not a `Text` format selector—carries the renderer program and resource.

Raster formats explicitly declare the text effects their portable Codec and shader implement. MSDF supports outline and
shadow; Bitmap and Slug currently support neither. Three and root-configured integrations validate
the selected font formats at the call that accepts a style, so an unsupported effect cannot become a malformed or
silently degraded render plan. The semantic ABI carries effect color, width, offset, and inherited opacity only for
technique programs that opt in.

## Semantic queries

Publication emits no semantic readback by default. A renderer that needs current local bounds requests the measurement
sidecar on the same update; core copies it into the retained text cache before target acceptance, so plan publication and
bounds cost one Wasm hop. Every semantic mutation invalidates that cache immediately. `Text.measure()` then answers from
the cache or explicitly measures current desired state, while `Text.glyphs()` similarly requests the positioned
inspection lane. Neither query traverses matrices, realizes renderer resources, flips publication slots, or burns a
revision.

A same-build isolation over one 21,805-glyph paragraph measured 0.002 ms for an unchanged publication, 0.174 ms for the
aggregate measurement sidecar, and 0.582 ms for full glyph inspection. Three requests only aggregate measurement and
only while it has changed text to publish; an idle synchronization does not enter the engine. Default renderer-neutral
publication therefore pays no semantic-sidecar cost, while renderers that need same-frame bounds pay the explicit
per-publication cost instead of making a second Wasm query.

An explicit query before first render carries the desired paragraph lifecycle and applies text, style, and geometry
mutations only for the queried paragraph. Sequential queries extend one speculative batch candidate. The next ordinary
publication adopts matching prepared work and publishes the batch once instead of shaping twice; a geometry-only mismatch
reuses the semantic prefix and recomputes only flow and positioning. Unchanged measurements and inspections remain cached
until the next semantic mutation.

The engine additionally exports `pmndrs_glyph_engine_measure_paragraph`, a paragraph-scoped synchronous query beside
`pmndrs_glyph_engine_update`. It reuses the update request layout with the queried paragraph as an ABI argument, runs
validation and speculative preparation for that paragraph only, and writes the header plus semantic table into the
inactive result slot without publishing: no A/B flip, no publication-generation bump, no revision advance, and no
renderer-fence acknowledgment. The host must copy the records out before its next update call (host lease). The query
terminates leave-committed, so the following ordinary frame proceeds from pre-measure revisions with no checkpoint
hazard.

The prepared pending state is retained as one speculative render-planner transaction. Sequential queries extend it while the
committed revision, lifecycle input, and the queried paragraph's text/style input fingerprints still match — a
geometry-only follow-up query re-runs just geometry, flow, and positioning over the retained semantic prefix, and
identities extend linearly from the transaction's high-water marks instead of rolling back between queries. Any
fingerprint mismatch rebuilds cold with results identical to a fresh preparation.

The committing frame adopts the transaction instead of discarding it: when the frame's lifecycle input matches, its
identity counters continue from the transaction's reserved high-water marks, and each paragraph whose text/style/geometry
inputs fingerprint-match its speculative pending state skips preparation entirely — the stable glyph identities a query
reported stay valid in the committed frame. A paragraph whose prefix matches but whose geometry changed re-runs only the
geometry/flow/positioning tail; anything else prepares cold. A frame whose inputs do not match the transaction drops it
leave-committed at entry, so committed state never observes an unadopted query.

The semantic values preserve information useful to callers:

- resolved box dimensions remain distinct from intrinsic content extents;
- clipping does not discard off-viewport semantic layout;
- semantic truncation retains visible positioned lines while reporting intrinsic overflow;
- glyph/font identity, UTF-16 clusters, stable IDs, flags, line membership, and positioned origins remain available on
  explicit inspection;
- detached copy requests never mutate authoritative Rust layout or the source planner's acceptance frontier.

## Root-assisted detached glyph copies

Public `Text.breakApart()` requests committed glyph and decoration subsets through its owning root. Rust compacts the
selected paragraph records through the installed Codec into complete checkpoints; it does not expose buffer offsets or
private planning objects for each renderer to reconstruct. Root services synchronously decode each detached copy into its
destination renderer. The query does not advance the source root's revision or publication generation.

Three's `Text.breakApart()` uses both planner requests and returns the frozen tuple
`[Glyphs, Decorations | undefined]`. It preserves the source transform, planner-defined batching, fallback techniques,
shared immutable atlas/page leases, and supplied geometry while adding one full affine matrix per drawable record. Its
local methods mirror `InstancedMesh`; world methods bridge physics state to root-relative storage. Bulk world-space
callers update the detached root once, invert its world matrix once, convert each body matrix with
`worldToLocalMatrix()`, and use `setMatrixAt()` so traversal and inversion stay outside the per-glyph loop. Materials and
root-relative resource leases belong to each detached object,
so the pair may outlive the source `Text`, font, and loader without sharing mutable presentation state. The source `Text`
stays live and may continue publishing while detached objects remain unchanged.

Decoration passes are not glyph records and retain an independent object and lifetime; tuple slot two is `undefined`
when the committed paragraph has no decoration draws. Three coordinates both roots' draw ranges so underline/overline
remain below glyphs and line-through remains above them without assigning a group-level render order. If either import
fails, `breakApart()` releases everything it created before throwing. Neither path reconstructs child `Text` objects,
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
explicit `@pmndrs/glyph/config/*` leaves. D-306 and D-308 supersede D-249's former public `/core` engine-driving layer. Internal projection,
identity mapping, planning, settlement, and Wasm transport are package machinery rather than an application or integrator
API. The explicit `/tsl` and `/typegpu` shader subpaths own technique shader realizations and no scene, runtime, or root.

The raw borrowed Rust publication and its typed command tree never cross the integration boundary. The engine projects
that trusted wire data through the integration's schema and resource resolver, then calls
`GlyphRenderer.decode(CommandBufferView)`. The bound view is the only renderer input: it preserves authoritative ordered
display-list children and exposes the closed semantic `GlyphInstanceKind` union, while numeric wire identities,
projection state, and publication settlement remain private. An integration therefore implements one host-realization
step rather than selecting or invoking a second decoder.

Codec authoring similarly exposes only the identity vocabulary an integration can legitimately declare:
`id.buffer`, `id.technique`, `id.program`, and `id.resource`. Numeric identities for installed Codecs, font bindings,
root publications, paragraphs, styles, materials, regions, exclusions, inline objects, and live resources are minted and
validated by package-owned handle state. Their scopes and the capability-set wire selection are unavailable from
`/config/codec`, so a custom renderer cannot accidentally become a second engine-state owner.

Three and `packages/glyph-example-renderer` consume the same public root types and `/config/*` helpers available to third-party integrations. The
example is the standing second-engine proof: its Codec describes storage, the trusted internal projection supplies one
borrowed ordered view, its renderer stages and commits host objects synchronously, exact identities govern retirement,
and its caller-owned TypeGPU/WebGPU host later submits work. Portable font compilation retains only validated buffer,
texture, grouped-resource, and GLB-like geometry payloads, never renderer objects.

The same reasoning withdrew the `*-abi` and `bakers/*/validate` subpaths. Raw struct offsets and enum numbers remain
package-private implementation data; the root exposes only renderer-facing semantic views and Codec authoring values.
The validator subpaths likewise had no consumer outside this package. Both sets of modules remain reachable by relative
path from package-owned tests and scripts where wire-level verification is legitimate.

Public implementation helpers use wildcard leaf exports under `/config`, `/three`, `/react`, `/raster`, `/tsl`, and
`/typegpu`; exact friendly aliases such as `/tsl/slug` remain stable. Nested TSL and TypeGPU shader modules are therefore
directly importable without a barrel. Explicit `null` export-map entries block the package's `internal`, generated ABI,
font-baker validator, Three executor, raster decoder, and TSL compatibility paths even though package-owned relative
imports can still reach those files. Packed-package tests import representative nested leaves and prove each blocked path
fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

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

## Legacy-path and duplication audit

The Rust command buffer is the only glyph-packing implementation. Rust is also the production authority for Unicode
analysis: the generator emits the compact Script/Script_Extensions and line-break tables consumed by the shaper, and
the full TypeScript paragraph analyzer has been retired. The JavaScript `findGraphemeBoundaries` helper remains a real
runtime dependency while authored rich-text spans are normalized synchronously before the shape boundary; its complete
Unicode 17 GraphemeBreakTest gate is retained beside an independent gate over Rust's analysis. Mutation tests keep a
test-only line-break oracle so their expected topology is not derived from the engine under test.

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

A Mori 0.19.1 production-source scan (review profile, same-language threshold 0.85, minimum 40 tokens) corroborated the
deleted parallel path and identified exact shared planner machinery. Ordered and stable planning now use one retained
epoch-cleared identity set, one plan-error and result-capacity classifier, one cold physical-buffer allocator, one inline
draw-span predicate, and one deliberately out-of-line final primitive/draw emitter. The optimized Wasm moved from
1,160,505 raw / 442,612 gzip / 348,594 Brotli bytes to 1,159,317 / 442,284 / 347,850, saving 1,188 / 328 / 744 bytes.

The remaining similar bodies are not two implementations of one behavior. Ordered-direct compacts physical records in
draw order; stable-indirect preserves slots, publishes a separate order buffer, and quarantines retirements until renderer
acknowledgement. A symbol-bearing optimized build attributes 33.3 KiB of function bodies to ordered planning and 50.1 KiB
to stable planning; those complete strategy totals are upper bounds, not deduplicable byte estimates. Their draw compilers
resolve different physical address spaces. Normalizing those addresses into another staging array or dispatching through a
dynamic strategy interface would add hot-path memory traffic or indirect calls, so the audit retains the strategy-local
loops and shares their exact invariants instead. The 22k-glyph complete Rust benchmark remains within adjacent-run noise;
a 20-warmup/51-sample cold check measured 15.452 ms median / 15.670 ms p95 at 1.0% RSD.

## Current size and performance evidence

The latest checked package-size record after the tsdown distribution cutover reports:

| Graph                                   |         Raw |      gzip |    Brotli |
| --------------------------------------- | ----------: | --------: | --------: |
| Core JavaScript plus shaper Wasm        | 1,524,942 B | 547,975 B | 429,901 B |
| Three adapter plus core and shaper Wasm | 1,718,613 B | 594,736 B | 467,591 B |

Three, React, and React Three Fiber are optional peers and excluded from these bundle totals. JavaScript and Wasm are
measured independently and then summed because browsers transfer them as separate assets.

The distribution build keeps TypeScript's complete source-shaped declarations and private maintenance emit, then uses
tsdown to bundle and minify every supported application entry with peer dependencies externalized. Source maps remain in
the package for debugging; the hand-authored export map remains authoritative for source/type/import conditions, wildcard
leaves, private-path guards, and Wasm assets. Compared with the preceding checked JavaScript graph, measured Core falls
from 499,251 to 327,570 raw bytes and from 81,007 to 80,505 gzip bytes; Three falls from 802,390 to 521,241 raw bytes and
from 127,744 to 127,266 gzip bytes. The fixed Three gzip ceiling remains unmet and is tracked as cleanup work rather than
being raised.

The optimized shaper is 1,101,396 raw / 425,300 gzip / 335,661 Brotli bytes after the shared sort kernel (D-243)
replaced twelve per-type engine sort instantiations and the Binaryen merge pipeline landed (D-244); the pre-golf
checkpoint measured 1,160,223 / 442,808 / 348,415. The renderer-neutral JavaScript graph is
92,550 raw / 18,659 gzip / 16,177 Brotli, and the complete Three JavaScript graph is 334,488 raw / 57,253 gzip /
48,250 Brotli. Deleting the legacy TypeScript raster packing/lifecycle path reduced the measured core total from 461,917
to 460,901 gzip bytes and the complete Three total from 501,815 to 498,922 gzip bytes; the later shared-emitter and stable
range-scan work reduces those totals to 460,416 and 498,437 gzip bytes. The homogeneous-policy dispatch and dirty-range
alignment correction moved those totals to 460,458 and 498,479 gzip bytes; the focused planner deduplication and current
Three graph measured 460,130 and 498,606 gzip bytes. The current source-response cache policy and publishing changes
measure 460,943 and 499,537 gzip bytes respectively.

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
scanning every glyph record in JavaScript. A renderer preparation failure discards its candidate, retains the last
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
transaction and technique-specific render plan; GPU submission is outside this direct benchmark.

| Technique |  Cold | Font size | Column width | Suffix edit | Local edit | Middle splice |
| --------- | ----: | --------: | -----------: | ----------: | ---------: | ------------: |
| Bitmap    | 15.90 |      6.04 |         2.78 |       13.48 |       1.18 |          8.52 |
| MTSDF     | 16.50 |      6.41 |         2.73 |       13.52 |       1.18 |          8.73 |
| Slug      | 16.73 |      6.64 |         2.96 |       14.37 |       1.31 |          8.94 |

The migration comparison is checked evidence rather than a reconstructed recollection. Commit `90964be0`, the exact
`feat/three-api` base, was rebuilt in an isolated worktree using its own lockfile and original
`glyph:layout-benchmark` workflow on this Darwin arm64 host. At the same eight-warmup/31-sample cadence its retained
TypeScript path measured 58.32/12.09/9.15/39.61 ms for cold/font-size/width/suffix-edit medians. The current Bitmap,
MTSDF, and Slug records all use one byte-identical optimized shaper Wasm and the complete `pmndrs_glyph_engine_update` plus
technique-specific Rust render plan. The base reports 25,515 positioned glyphs; the current plan reports 21,805
renderable instances from the unchanged 22,000-glyph target because it omits non-rendering glyphs from GPU records.

The exact [TypeScript baseline](../../../apps/benchmarks/fixtures/results/typescript-layout-baseline-90964be0-darwin-arm64.json)
and current [Bitmap](../../../apps/benchmarks/fixtures/results/rust-layout-bitmap-0bdb9e93-darwin-arm64.json),
[MTSDF](../../../apps/benchmarks/fixtures/results/rust-layout-mtsdf-0bdb9e93-darwin-arm64.json), and
[Slug](../../../apps/benchmarks/fixtures/results/rust-layout-slug-0bdb9e93-darwin-arm64.json) records are authenticated by
the benchmark fixture gate. Every comparable median is faster through Rust: Bitmap is 3.67× faster cold, 2.00× on font
size, 3.29× on width, and 2.94× on suffix edit; even the slowest technique for each case remains 3.49×, 1.82×, 3.09×,
and 2.76× faster. This proves the migration comparison on this machine; it does not close the stricter p95-under-4-ms
objective. Local-edit p95 remains about 6 ms and high-variance, while width p95 ranges from 4.29 to 4.75 ms across
techniques.

The paragraph-scoped synchronous measure (11.17) closes that objective for the explicit measure shape. At the same
22,000-glyph corpus and cadence, the new `measure-query` lane answers the identical alternating widths as the
`column-resize` lane through `pmndrs_glyph_engine_measure_paragraph`: 1.815 ms median / 1.930 ms p95 / 3.0% RSD with
zero patches and zero publication bytes, beside the full update's 2.996 ms median / 4.483 ms p95 / 21.7% RSD in the
same run — the first width-change lane under the 4 ms p95 objective, recorded in the
[measure-query record](../../../apps/benchmarks/fixtures/results/rust-layout-bitmap-measure-a42c976-darwin-arm64.json).
The variance collapse follows from what the query skips: no gather, no plan compile, no publication packing, and no
revision burn, so the following ordinary frame adopts the speculative layout instead of paying a checkpoint rebuild.

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
capability, glyph count, and every physical storage key remain compatible. It still validates every glyph and stable
identity; the first storage mismatch falls back to complete batch discovery. Three consecutive optimized runs measured
1.164/5.761, 1.153/5.740, and 1.155/5.738 ms median/p95, versus the preceding 1.314/5.863 ms checkpoint. The optimized
shaper is 1,157,311 raw bytes, a 4,189-byte increase, and retained high-water memory is 79.81 MiB. The repeated median gain
is established; the roughly 5.74 ms p95 and 81.4–81.6% RSD still fail the tail-latency gate.

The direct benchmark also keeps an independent middle-splice lane. On the current optimized artifact, a sequential
eight-warmup/31-sample run measures ordered-direct insertion/deletion at 8.452/9.033 ms median/p95 and 511.3 KiB written
because following physical records move. Stable-indirect reduces that publication to 452 B and measures 9.372/9.583 ms.
The earlier 51.067 ms figure was the maximum selected as p95 from only 11 samples and did not reproduce. This establishes
the storage-policy tradeoff without changing the default: stable planning remains optimization/correctness work, and
chunk-local text storage cannot be claimed as the dominant splice fix while the physical plan has this cost.

Three now consumes stable-indirect plans through one shared record-addressing abstraction rather than technique-specific
branches. A Rust/Three integration regression proves lifecycle reorder mutates only the order table and preserves physical
glyph bytes and draw objects. A two-record GPU oracle makes slot zero green and slot one red, then renders logical slot zero
through `order[0] = 1`: forced WebGL2 and hardware WebGPU both return 16/16 exact red pixels and the same readback hash.
The complete ordered Bitmap/MSDF/Slug/custom-material matrix remains green on both backends. A strict 31-sample stable
run exposed a quadratic dependency scan: each changed physical range rescanned every slot write. Binary-partitioning the
sorted writes to the requested range reduces stable font-size from 350.136 to 7.982 ms median and column resize from
49.636 to 3.767 ms; localized edit is 2.172/6.628 ms and splice is 9.372/9.583 ms median/p95. Stable no-op remains
1.083 ms versus ordered-direct's 0.001 ms, so stable remains an explicit allocation strategy rather than the first-party default. The
sequential benchmark high-water marks are 107.56 MiB ordered and 114.25 MiB stable; retained-memory right-sizing remains
open and neither figure is presented as ordinary application demand.

The first-party Codec declares one allocation strategy for every registered technique. Rust now resolves that uniform
strategy once per update instead of looking up a program for every glyph before the selected planner performs its own
validated compilation. Mixed-strategy Codecs retain the per-glyph discovery path and stop once both strategies are
observed. A five-warmup/11-sample ordered run measures 6.005 ms font-size, 2.813 ms column-resize, 1.212 ms localized-edit,
and 8.281 ms middle-splice medians. The adjacent prior medians were 6.178, 2.817, 1.353, and 8.452 ms; these short runs
show no regression and suggest a small scan reduction, but do not establish a latency win. The same change preserves
whole-buffer update alignment after dirty-range promotion and costs 182 raw / 42 gzip / 233 Brotli bytes.

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

The integer layout-units migration (D-254) moved cluster advances, line fitting, justification, and positioning onto
F26.6 integers with one rounding contract (`layout_units.rs`: round-half-up as `floor(value * 64 + 1/2)`), landed as
stacked slices with an interleaved same-run A/B for each — sides alternated in identical order within one process
session, because this host drifts several percent between sessions. Step deltas, medians at the 22,000-glyph corpus:

| Slice                                  | Lane deltas (median, rounds consistent)                                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry flattening (slice 1)          | lane-neutral; shaper −9,433 raw bytes                                                                                                                            |
| F26.6 fit + chunk-64 kernels (slice 2) | ~2% measure lane, scales with line length; byte-exact break parity                                                                                               |
| Retained adjacency stream (slice 3)    | column-resize 2.996 → 2.781 ms (−7.2%), measure-query 1.930 → 1.824 ms (−5.5%), both 3/3; suffix +1.3% / splice +2.1% (re-shape scatter, accepted); cold neutral |
| Metric-only scale refresh (slice 3)    | font-size 6.715 → 5.898 ms (−12.2%, 3/3) — 9.2% below the pre-stream baseline; other lanes neutral                                                               |
| Integer justification (slice 4)        | lane-neutral 2/2 (the direct lanes do not justify); totals now exact                                                                                             |

The stream replaces the glyph permutation with six adjacency-order payload columns scattered at build, so positioning
walks sequential memory and geometry-only updates reuse the stream untouched; a metrics-only restyle re-derives just the
advance lanes from that stream in one sequential pass, bit-identical to a cold build by a lane-for-lane oracle.
Justification distributes euclideanly in layout units — per-site quotient plus a remainder spread one unit over leading
sites — so the fragment advance and the applied cursor adjustments agree exactly, and the compression capacity
quantizes through the same `ratio_q16` expression the fit used to admit the line. The
[integer-units checkpoint record](../../../apps/benchmarks/fixtures/results/rust-layout-bitmap-integer-units-c2e895e-darwin-arm64.json)
pins the slice-4 artifact end-state (measure-query 1.890/2.054 ms median/p95 on a visibly hot host session; the
interleaved deltas above are the comparative evidence).

Corpus re-derivation statement: the packaged fixtures held byte-identical through every slice except the deliberate
quantized-boundary re-pins recorded with their commits — one RTL ellipsis extent at the slice-2b flip (+0.0134 px), the
paragraph bidi and CJK contracts (30 and 25 numeric leaves, maxima 0.070 px and 0.101 px, the latter a long Korean
line's accumulated per-site sub-unit quantization), and the advanced-shaping and rich-text composed hashes, whose
roughly twenty-five structural pins each — glyph and draw counts, line counts, both first-line break positions — held
exactly while origins settled on 1/64 boundaries. Integer justification required no re-pin: both contract corpora and
the sixteen-scenario conformance suite reproduce byte-identically because their justified cases divide evenly. Native
and Wasm agree bit-for-bit on the contract corpora by construction of the shared rounding contract, and the linux CI
host reproduces both composed scenario hashes recorded on this darwin host.

The review fold that closed the migration replaced the fit's Q16 shrink budget with an exactly-applied f64 ratio —
one IEEE multiply and one round-half-up per comparison, shared verbatim by justification's growth and compression
caps and by the f64 parity twin — after a review counterexample showed the Q16 ratio's 2^-17 relative error
exceeding the one-unit tolerance above ~2^16-unit space sums and its `<<16` comparison overflowing i64 inside the
admitted magnitude range. The same fold bounded justification application to the counted span in visual encounter
order (trailing logical spaces and uncounted gaps no longer absorb adjustments, so the applied cursor sum equals
the reported fragment advance in both directions), required positional run-topology stability before the
metric-only scale refresh (a metrics restyle can merge adjacent runs and dangle retained run indices), and
collapsed the build's payload scatter to bulk copies when shaped runs tile the glyph array in cluster order.

The measure-query stretch target is met: a measurement-only query now skips the per-glyph positioning tail —
measurement derives at line level from flow and clusters, glyph totals from the adjacency stream and boundary
records, and the committing frame runs exactly the missing tail once, proven byte-identical to a never-measured
control by an integration test. The lane moved from 1.82–1.90 ms to 0.458 ms median / 0.607 ms p95 (−75%,
three interleaved rounds), inside the plan's 0.6–0.9 ms objective; the earlier attribution of the residual floor
to the fit walk was wrong — the floor was the positioning tail. The identity-order scatter reclaimed the
retained-stream cost on the edit lanes (suffix and splice both −1.6%, three rounds); font-size pays +1.2% for the
correctness admissions and remains ~11% below the pre-stream baseline. Still open: the committing-resize
p95-under-4-ms objective. The tail is structural, not noise — 4.42–4.49 p95 against a 2.8 ms median on both sides
of every round — and belongs to break-sensitive full recomposition; the productized interactive width path is the
measure query above, and the raw full-update tail remains the documented open gate.

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

Two follow-ups from the closing audit are tracked in [the integer layout-units plan](../planning/integer-layout-units.md)
as slice 6 so they cannot silently lapse: the integer pen (layout decisions resolve in F26.6 while the
intra-line cursor still accumulates the f64 advance lane — one deliberate seam, deterministic but dual-lane,
whose closure deletes the f64 advances column and re-pins the visual corpus), and the explicit-state-machine
consolidation of the engine's prepared/pending flag lattice, which produced one live regression and one
review finding during the migration and belongs to the first maintainability-review pass together with a
direct dual-derivation assertion for the glyph-count lanes.

## Merge gates still open

Before the foundation stack is publishable:

- finish the stale-code and stale-documentation audit;
- regenerate affected ABI, optimized Wasm, package-size records, and package digests from source;
- run package checks, strict Rust checks, benchmark conformance, packed consumers, WebGPU and forced-WebGL2 live rendering,
  and the full repository gate;
- run the unchanged 25k-glyph comparison with enough samples and report cold, font-size, width, and text-update tables;
- profile and reduce any path that misses the target without weakening correctness;
- run a read-only Claude adversarial review if the CLI is available, then address supported findings;
- commit and push the coherent stack with a clean worktree.

The query/candidate-adoption API and the two publishing-feature stacks remain follow-on work after this foundation merge.
They must reuse retained Rust paragraph state and the same render-plan architecture rather than reintroducing a second
layout path.
