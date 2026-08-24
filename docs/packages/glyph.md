---
type: Workspace Package
title: '@pmndrs/glyph'
description: Implements portable font loading, retained Rust shaping and layout, renderer-directed command planning, and maintained Three.js and React Three Fiber adapters.
resource: ../../packages/glyph
workspace_package: '@pmndrs/glyph'
documentation_type: reference
source_digest: 'sha256:33ae90999c5728e2b56abb9efb44d31fed4bbb7682ac86b8c3bf0ded00be5a5c'
tags: [package, public-api, rust, wasm, threejs, typography]
sources:
  - id: manifest
    resource: ../../packages/glyph/package.json
    title: Package manifest
  - id: release-workflow
    resource: ../../.github/workflows/release.yml
    title: npm canary release workflow
  - id: public-api
    resource: ../../packages/glyph/src/index.ts
    title: Renderer-neutral public exports
  - id: runtime
    resource: ../../packages/glyph/src/text-runtime.ts
    title: Font and Rust-runtime ownership
  - id: node-cli
    resource: ../../packages/glyph/src/node/cli.ts
    title: Project-discovery and direct font-bake CLI
  - id: font-baker
    resource: ../../packages/glyph/rust/font-baker
    title: Optional portable font-baker Wasm
  - id: bake-api
    resource: ../../packages/glyph/src/node/bake.ts
    title: Programmatic bake subpath
  - id: text-properties
    resource: ../../packages/glyph/src/text-properties.ts
    title: Paragraph input contract
  - id: layout-query
    resource: ../../packages/glyph/src/layout.ts
    title: Explicit layout-query values
  - id: rust-engine
    resource: ../../packages/glyph/rust/shaper/src/engine/state.rs
    title: Retained Rust text engine
  - id: frame-host
    resource: ../../packages/glyph/src/core/host.ts
    title: Single-export Wasm host
  - id: core-api
    resource: ../../packages/glyph/src/core.ts
    title: Renderer-neutral core layer
  - id: tsl-shaders
    resource: ../../packages/glyph/src/tsl.ts
    title: Technique shader library layer
  - id: three-api
    resource: ../../packages/glyph/src/three.ts
    title: Three.js public exports
  - id: three-text
    resource: ../../packages/glyph/src/three/text.ts
    title: Three.js retained text lifecycle
  - id: three-plan
    resource: ../../packages/glyph/src/three/engine-plan-target.ts
    title: Three.js render-plan executor
  - id: three-policy
    resource: ../../packages/glyph/src/three/plan-program-registry.ts
    title: Three.js policy-program registry
  - id: react
    resource: ../../packages/glyph/src/react.ts
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
generated:
  by: openai-codex/gpt-5
  at: '2026-08-24T03:12:27Z'
---

# Package reference: `@pmndrs/glyph`

Status: foundation merged; canary publishing configured while publishing-feature stacks continue

## Ownership

The package owns five runtime layers:

| Layer                   | Owner                 | Responsibility                                                                                                                         |
| ----------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Font and raster loading | TypeScript core       | Validate portable GLB assets, register shaping payloads, decode selected raster resources, and retain font identity.                   |
| Shaping and layout      | Rust/Wasm             | Unicode analysis, bidi, font fallback, shaping, line composition, positioning, ellipsis, and semantic query state.                     |
| Policy and render plan  | Rust/Wasm             | Interpret a validated renderer policy, pack canonical technique records, coalesce dirty ranges, and emit a compact command buffer.     |
| Three.js integration    | `@pmndrs/glyph/three` | Compile policy programs, resolve font/material resources, apply command-buffer deltas, upload dirty ranges, and maintain draw proxies. |
| React integration       | `@pmndrs/glyph/react` | Reconcile React values into the same imperative `Text` and `TextGroup` objects.                                                        |

Runtime Rust and all shared Rust code remain `no_std + alloc` compatible with the package allocator contract. The optional
font-baker Wasm alone enables a feature-gated `std` adapter for Fontations subsetting; the same crate continues to
pass its `wasm32-unknown-unknown --no-default-features` build. The text engine uses the existing compile-time direct-memory mapping
for font registrations and the single mutating `pmndrs_glyph_engine_update(sessionId, requestOffset, requestLength)`
export for retained engine sessions.
TypeScript does not independently shape, lay out, or pack paragraphs.

## Public package surfaces

| Subpath                      | Purpose                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@pmndrs/glyph`              | Font/raster contracts, loading, fallback stacks, formatting helpers, paragraph inputs, layout-query values, and portable bakers. |
| `@pmndrs/glyph/three`        | Three `FontLoader`, `Text`, `TextGroup`, material factories, and policy registration.                                            |
| `@pmndrs/glyph/three/bitmap` | Compatibility alias re-exporting the renderer-neutral Bitmap raster module.                                                      |
| `@pmndrs/glyph/three/msdf`   | Compatibility alias re-exporting the renderer-neutral MSDF raster module.                                                        |
| `@pmndrs/glyph/three/slug`   | Compatibility alias re-exporting the renderer-neutral Slug raster module.                                                        |
| `@pmndrs/glyph/react`        | React `<Text>`, `<TextGroup>`, and `useFont`, reconciled through React Three Fiber.                                              |
| `@pmndrs/glyph/bake`         | Node programmatic font baking, glyph selection, and font inspection used by the `glyph` CLI.                                      |
| `@pmndrs/glyph/runtime-bake` | Explicit browser Worker host for optional runtime baking.                                                                        |
| `@pmndrs/glyph/raster/*`     | Renderer-neutral Bitmap, MSDF, and Slug decoding and raster-technique contracts.                                                 |
| `@pmndrs/glyph/core`         | Renderer-neutral engine host, frame wire, plan/layout-query views, technique schemas, policy-program DSL, and binding compiler.  |
| `@pmndrs/glyph/tsl`          | Canonical TSL shader realizations of the first-party technique interfaces; no scene integration.                                 |
| `@pmndrs/glyph/typegpu`      | Canonical TypeGPU shader realizations of the first-party technique interfaces; no scene integration, no engine driving.           |
| `@pmndrs/glyph/bakers/*`     | Optional portable raster bakers.                                                                                                 |

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

The R3F `Text` component infers the technique union from a required outer font selection, including a font stack chosen
from runtime state. Callers do not widen dynamic selections to `AnyRasterTechnique`. An inline `TextSpan` may omit
`font` because it is flattened into a styled run and inherits from its enclosing paragraph; a rendered `Text` without a
font is invalid. The two are separate components because they are separate kinds of thing: `Text` is a paragraph box and
a Three `Object3D`, while `TextSpan` is never mounted and its props are exactly the five the flattener reads. Every
box-level prop is a type error on a span rather than a value silently discarded, and a `ref` on a span — which could
never fire, because no object exists — no longer type-checks. Flutter separates `RichText` from `TextSpan` on the same
line. `TextGroup` owns batching and compositing policy, never font inheritance. Both components register their Three
objects with the R3F host and are constructed during its commit rather than in a layout effect. React `Activity` can
therefore pre-render a hidden text or whole text group, while R3F retains visibility and eventual disposal ownership.

Span offsets are resolved onto the extended grapheme cluster grid before any frame is built (D-265). The engine
resolves one style per cluster and refuses a frame whose styles split one, so `Text` settles the question at its own
boundary and settles it constructively: a cluster takes the style of its base, and every boundary moves forward to the
end of the cluster containing it. One rule covers both entry points: offsets a caller authored through the `spans`
array, and boundaries the tree compilers derive. `txt`/`span` and nested React `<Text>` compile a document that states
no offsets at all, and each resolves the boundaries it derives at its own concatenation joins, where concatenation can
fuse the tail of one fragment with the head of the next into one cluster; `alignSpansToClusters` remains the backstop
for the untyped array rather than the discoverer of a compiler-authored split. Cluster resolution never throws, so no
span fault the compilers derive can escape a React mount before `onError` exists; the React tree states no offsets at
all, so nothing a `<Text>` compiles can reach the range check below either. A
span left holding no cluster becomes an empty range and stays in `Text.spans` rather than vanishing, and empty spans
compile to no engine style. `alignSpansToClusters` is exported so a caller can resolve or check its own offsets against
the same segmentation, which is this package's `findGraphemeBoundaries` rather than the host's `Intl.Segmenter`.

An INVERTED or out-of-range span is separated from that resolution because it has no correct answer (D-268). It throws
from `Text` construction and `set()`, beside `normalizedColumns` and `normalizeCapacity`, where the stack still names the
caller; `set()` normalizes before it commits, so a rejected update leaves the paragraph exactly as it was. Collapsed
spans stay in `Text.spans` and are dropped where engine styles are compiled, and disjoint-or-nested stays with the engine.

A frame the engine refuses names its cause and the input that caused it (D-267). Six caller-actionable statuses --
`styleRangeInvalid`, `styleSplitsCluster`, `styleNestingInvalid`, `styleRootInvalid`, `fontStackMissing`,
`fontMetricsMissing` -- are separated from `invalidRequest`, which keeps every internal invariant violation and names
nothing. Each carries the offending paragraph and style in two u32s of the result header's existing tail padding, so the
header size and every prior field offset are unchanged. `/three` re-raises them as `TextFrameError`, whose `rejection` is
a discriminated union over the cause plus a second union over the subject: the `Text` object and, where one span owns it,
that span and its index in `Text.spans`.

A rejected frame latches (D-269). Compilation stops, `.error` keeps the rejection, `onError` fires once, and the batch
resumes only when what it would compile actually changes -- a `set()`, a paragraph added or removed, a material swap,
or `setCapacity`. There is no public `retry()`: a rejection is an invariant this package broke, not a caller mistake, so
there is nothing to retry. A frame the engine accepted whose GPU application failed is deliberately not
latched, because it is retried from the retained publication on the next frame. The accepted path pays one boolean test.

`registerThreeRasterPlanProgram` refuses a technique registered after a runtime has read the registry (D-270), naming the
technique instead of applying to nothing. `/three` also re-exports `ParagraphLayoutSummary`, `ParagraphLayoutInspection`,
`ParagraphLayout`, `ParagraphMeasurement`, and `FontFeature`, so a `/three` importer can name what
`Text.layout()`, `Text.glyphs()`, and `ParagraphStyle.features` give it.

One baked GLB may expose several raster techniques without repeating its input identity. `TextRuntime.loadFont()` and
R3F `useFont()` accept a nonempty `rasters` tuple and return a position-preserving tuple of `LoadedFont` values. The
artifact is fetched, validated, registered with the shaper, and retained once; each requested technique still derives
its exact descriptor, resolves and decodes its own raster resource, and retains its associated data type. A mapped tuple
keeps required Bitmap options and custom third-party technique types enforceable at every position.

Artifact metrics carry text decoration from bake time (D-246): required `underlinePosition`/`underlineThickness` from
`post` and `strikeoutPosition`/`strikeoutSize` from `OS/2`, with a conservative derived fallback when a source font
omits `post`. The loader decodes all four into public `FontMetrics`, and the rich-text conformance lane probes every
font it loads for finite, positive-thickness values. Decoration rendering consumes those metrics end-to-end (D-248):
spans declare `decoration` (solid underline, overline, and line-through; other line styles are rejected at the
boundary), the engine cascade stamps the CSS decorating box so one continuous line spans nested font-size changes at
the declaring span's scale, and records flow through both planners as resource-free rows of the reserved
`pmndrs.decoration` technique. Plan programs carry a primitive kind in the former reserved wire field; underline and
overline rows precede the paragraph's glyphs while line-through follows them, matching CSS paint order, and Three
realizes every decoration draw with one shared flat-quad TSL material. Decorated sessions rebuild their gather output;
the undecorated retained fast path is unchanged.

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

One `TextGroup` owns one Rust engine session. A traversal sends only changed paragraph sections:

- text replacement sends text plus any dependent style/geometry state;
- font, spans, shaping style, paint, raster ratio, or material send style state;
- content-box changes send geometry;
- transform and visibility changes update Three's renderer-local sidecar without calling Wasm;
- an empty or normalized-equal update sends nothing.

Three's ordinary scene traversal owns world-matrix composition. `TextGroup` tracks local matrices, visibility, and
parent identity only below its shared draw root, then gives the executor the paragraph IDs whose relative transform
path changed. Camera and `TextGroup` motion therefore move the shared draw without forcing every `Text` world matrix a
second time, multiplying every relative matrix, or scheduling transform-table uploads. Direct `Text` motion, nested
ancestor motion, visibility, reparenting, and manual matrix changes still patch the affected renderer-local slots and do
not enter Wasm.

Rust publishes one revision containing:

- engine and plan revision headers;
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
future deltas.

A paragraph's content box may declare `columns: { count, gap }`, flowing text through side-by-side ordered columns inside
the exact content-box width. Columns fill in order without balancing, so the final column may run short, and an exact
`width` is required because the column advance is derived from it. Ordered columns are the only multi-interval flow the
engine represents; balancing, exclusions, and contour flow remain post-v1.

## Renderer policy

Each portable technique registers a schema, policy-body factory, and cold font compiler in `/core`. Three registers
only the renderer half — resource realization and material creation — then assembles the complete Three `PolicyProgram`
from the portable body. Rust validates and interprets the compiled policy; it never invokes a JavaScript callback in
shaping, layout, or packing.

The first-party policy can select indexed transform batching, direct per-draw transforms, or a hybrid. Indexed mode adds a
stable transform-table ID to each rendered glyph so compatible paragraphs may collapse into one draw. Direct mode splits
draws by transform for integrations that prefer ordinary object matrices. Policy programs may use ordered-direct or
stable-indirect physical storage. Stable draws carry one reserved u32 order buffer; Three validates its draw/primitive
addressing once, then uses the same logical-to-physical mapping for technique records, transform indices, explicit origin
queries, and third-party program material contexts. `TextGroup.compositing` determines whether Rust must preserve authored
ordering or may reorder independent work. Ordered-direct remains the first-party default until stable planning meets the
same tail-latency target.

`materialId` is explicit through the frame ABI and render plan. Three maps it to a `defineTextMaterial()` factory. Material
identity may split draws without forcing a second copy of the canonical glyph buffers.

Bitmap atlas pages within one strike are renderer layers, not independent draw resources. The font binding exposes one
strike resource, the Rust policy writes the selected page as one u32 instance lane, and Three uploads the strike as one
R8 texture array. This preserves authored glyph order while preventing page transitions inside ordinary prose from
splitting a paragraph into hundreds of draws. The multi-page integration fixture asserts one ordered draw and a live
Chrome run reduced the sampled Paragraph Stress CPU frame from roughly 80 ms before the correction to 0.47–1.3 ms after
it; the sampled GPU frame remained a separate 1–5 ms concern.

## Font fallback and techniques

`createFontStack()` accepts fonts from one runtime in explicit fallback order. Members may use different techniques. The
font carries both shaping identity and raster binding, so `Text` has no redundant technique property. Rust resolves the
font for each cluster and partitions the render plan according to the active renderer's supported technique programs.

This permits an MSDF or Bitmap prose font to fall back to a Slug emoji font while keeping third-party renderers safe: an
unregistered technique fails at the policy boundary instead of producing an unsupported draw.
A public compiled-Wasm integration loads Bitmap Inter plus Slug Font Awesome, shapes one paragraph through that ordered
fallback stack, and observes two Rust-planned draws with exact Bitmap `vec2` and Slug `vec4` physical records. The
selected font binding—not a `Text` technique selector—carries the renderer program and resource.

## Semantic queries

Ordinary rendering requests no layout readback. `Text.layout()` explicitly requests aggregate measurements and
counts; `Text.glyphs()` additionally copies line and glyph arrays. Query results are cached by committed revision.
When the only pending change is the laid-out text's geometry, `layout()` routes through the core host's
`session.measureParagraph` — the paragraph-scoped synchronous query below — so repeated measurement under changing
constraints performs no publication flips and no revision burns, and the next ordinary frame adopts the speculative
work. Any other pending change synchronizes the containing Rust session once and the following render traversal reuses
that publication.

The engine additionally exports `pmndrs_glyph_engine_measure_paragraph`, a paragraph-scoped synchronous query beside
`pmndrs_glyph_engine_update`. It reuses the update request layout with the queried paragraph as an ABI argument, runs
validation and speculative preparation for that paragraph only, and writes the header plus semantic table into the
inactive result slot without publishing: no A/B flip, no publication-generation bump, no revision advance, and no
renderer-fence acknowledgment. The host must copy the records out before its next update call (host lease). The query
terminates leave-committed, so the following ordinary frame proceeds from pre-measure revisions with no checkpoint
hazard.

The prepared pending state is retained as one speculative session transaction. Sequential queries extend it while the
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
- presentation origin overrides never mutate authoritative Rust layout.

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

The renderer-neutral core publishes as `@pmndrs/glyph/core` (D-249): runtime shaper creation, the engine host and sessions, frame-wire
serialization, render-plan and layout views, font-binding compilation, the versioned ABI, and the policy-authoring
toolkit. The four technique TSL node graphs publish as `@pmndrs/glyph/tsl` under Tsl-prefixed names, including the Slug shader tree that
previously lived in core internals. Three's first-party policy is authored with the same public toolkit in
`three/render-policy.ts`, and a scoped import lint denies the three, tsl, and react surfaces any import from `internal/`
or `generated/`, so the first-party integrations consume exactly the layering a third party would.

Both layers publish as npm subpaths. They are how a renderer integrates without our `Object3D`s, and `@pmndrs/glyph/three` is itself built on `/core`, so the earlier finding that they had no consumers was wrong. `packages/glyph-example-renderer` is the standing proof that a second engine consumer can be written against `/core` alone, and it now drives real frames through the item 11 retention protocol: publications are borrowed by default but expire loudly (`isExpired`/`assertLive`), `retain` makes one contiguous host-owned copy branded in the type system, acknowledgement feeds the generation the engine already verifies at the wire, patches surface dirty ranges, and storage generations retire through `(kind, id, generation)` records (`core/retention.ts`). `/core`'s contract still has sharp edges -- caller-chosen raw `u32` handles where branded `FontHandle`/`RasterHandle` already exist, caller-supplied opaque byte blobs, no published path from host-owned bytes to a registered shaping font (audit item 12; the example renderer's real-frame test records the clean `fontMissing` rejection), and a manual acquire/release refcount pair -- and those are tracked as hardening in the API surface audit rather than as a reason to withdraw the entry point.

The same reasoning withdrew the `*-abi` and `bakers/*/validate` subpaths. The ABI subpaths existed to publish struct
offsets for pointer arithmetic, which is an internal representation handed to a caller who then owns keeping it valid;
`textShaperAbi` reaches its one legitimate consumer through core. The validator subpaths had no consumer outside this
package. Both sets of modules remain, reached by relative path from the package's own tests and scripts.

The renderer-neutral core owns the completed asynchronous Worker transfer contract: it copies opaque frame bytes once
into a bounded worker-owned transferable pool, applies explicit backpressure, and requires root to transfer each retired
buffer back so reuse or final collection occurs in the owning realm. Adopting that mode in the Three host is deferred;
the synchronous Three path does not restore the deleted TypeScript shaping Worker. TypeGPU is likewise a later adapter
slice built directly against the Rust render plan.

## Current correctness evidence

The foundation currently has:

- 154 passing Rust engine tests, including exact retained-cluster, revision-range, immediate line-convergence, and
  later cursor-convergence regressions;
- the package JavaScript/integration gate passing through the single-path public exports;
- exact retained Amiri bidi, policy, ellipsis, clipping, UIKit-layout, and CJK contracts exercised by the browser
  `paragraph-contracts` target through public `FontLoader`, `Text`, `TextGroup`, `layout()`, and `glyphs()`;
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

The Rust command buffer is the only glyph-packing implementation. The former TypeScript `RasterRuntime`, raster
candidate/commit transaction, `select`, `createStorage`, and `writeStorage` surfaces are deleted from production source
and public exports. Current raster techniques own identity, artifact decoding, retained CPU resource data, and disposal;
Rust policy programs own instance packing and dirty-range publication. The package gate retains production render-plan,
font-binding, Three execution, artifact-validation, and Unicode conformance coverage instead of test-only TypeScript
packers.

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

The latest checked package-size record after the baker ABI cleanup reports:

| Graph                                   |         Raw |      gzip |    Brotli |
| --------------------------------------- | ----------: | --------: | --------: |
| Core JavaScript plus shaper Wasm        | 1,194,036 B | 443,967 B | 351,843 B |
| Three adapter plus core and shaper Wasm | 1,442,346 B | 483,478 B | 384,647 B |

Three, React, and React Three Fiber are optional peers and excluded from these bundle totals. JavaScript and Wasm are
measured independently and then summed because browsers transfer them as separate assets.

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
The corrected complete MTSDF baker remains 552,025 raw / 215,030 gzip / 168,758 Brotli bytes; the earlier 52 KiB
observation was a kernel-only test artifact that reused the distributable Cargo target directory.

The public Three benchmark now supports an outside-only mode that leaves the internal phase collector disabled and wraps
one `updateMatrixWorld()` call with a host timer. An eight-warmup/31-sample run over 25,515 positioned glyphs measured
19.42/6.59/3.10/14.24 ms median and 21.00/6.86/4.75/15.26 ms p95 for cold/font-size/width/text updates. Those values cover
frame preparation, the complete Rust transaction and render-plan publication, and Three plan application; they exclude
GPU submission. An adjacent phase-instrumented run was indistinguishable within process noise. Those temporary profiler
exports, calls, branches, and clock reads are now absent from the package source and clean publishing output; benchmark
workload markers and the direct Wasm timer remain outside the shipped library.

After the final plan-application lifecycle audit, Three sizes indexed transforms from live paragraph IDs instead of
scanning every glyph record in JavaScript. A renderer failure retains an unconsumed owned plan for zero-crossing retry;
dirty upload ranges accumulate across presentation restoration and Rust patches; buffer/resource generations dispose
only their exact dependent materials; direct materials survive indexed transform-table growth; and loaded-font disposal
removes its decoded renderer resources. The unchanged eight-warmup/31-sample public 25,515-glyph lane measures
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

The exact [TypeScript baseline](../../apps/benchmarks/fixtures/results/typescript-layout-baseline-90964be0-darwin-arm64.json)
and current [Bitmap](../../apps/benchmarks/fixtures/results/rust-layout-bitmap-0bdb9e93-darwin-arm64.json),
[MTSDF](../../apps/benchmarks/fixtures/results/rust-layout-mtsdf-0bdb9e93-darwin-arm64.json), and
[Slug](../../apps/benchmarks/fixtures/results/rust-layout-slug-0bdb9e93-darwin-arm64.json) records are authenticated by
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
[measure-query record](../../apps/benchmarks/fixtures/results/rust-layout-bitmap-measure-a42c976-darwin-arm64.json).
The variance collapse follows from what the query skips: no gather, no plan compile, no publication packing, and no
revision burn, so the following ordinary frame adopts the speculative layout instead of paying a checkpoint rebuild.

The preceding unchanged 22,000-glyph localized-edit lane measured the complete production `pmndrs_glyph_engine_update` plus Bitmap render
plan at 2.607 ms median / 6.184 ms p95 after 40 warmups over 101 updates. The fast ASCII-letter path reuses Unicode and
bidi state and recomposes until the line cursor converges; punctuation and spacing edits deliberately retain the full
break-sensitive path, so the 42.4% RSD describes remaining workload classes rather than a completed latency result. The
optimized SIMD shaper is 1,147,266 raw bytes. Five patches write roughly 1.2 KiB per update, and the retained high-water
mark remains 80.38 MiB. Median is now below 4 ms, but p95 and memory-growth gates remain open.

Policy gather now retains complete prior input lanes by committed session/policy/capability revision. Zero-change glyphs
reuse them without binding or policy work; changed glyphs update only reachable lanes. A resource or draw-storage key
change retains the verified prefix and fully rebuilds the suffix, preserving correct replacement-buffer inputs without
double-scanning the prefix. The same production lane now measures 1.314 ms median / 5.863 ms p95 with 76.2% RSD, five
patches, and roughly 1.2 KiB written. The 1,153,122-byte optimized shaper is 5,856 bytes larger than the prior checkpoint,
and retained high-water memory is 80.19 MiB. The fast class approaches 1 ms; the break-sensitive p95 remains open.

The ordered-direct compiler additionally retains committed glyph-to-batch and glyph-to-slot topology while policy,
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
1.083 ms versus ordered-direct's 0.001 ms, so stable remains an explicit policy rather than the first-party default. The
sequential benchmark high-water marks are 107.56 MiB ordered and 114.25 MiB stable; retained-memory right-sizing remains
open and neither figure is presented as ordinary application demand.

The first-party policy declares one allocation strategy for every registered technique. Rust now resolves that uniform
strategy once per update instead of looking up a program for every glyph before the selected planner performs its own
validated compilation. Mixed-strategy policies retain the per-glyph discovery path and stop once both strategies are
observed. A five-warmup/11-sample ordered run measures 6.005 ms font-size, 2.813 ms column-resize, 1.212 ms localized-edit,
and 8.281 ms middle-splice medians. The adjacent prior medians were 6.178, 2.817, 1.353, and 8.452 ms; these short runs
show no regression and suggest a small scan reduction, but do not establish a latency win. The same change preserves
whole-buffer update alignment after dirty-range promotion and costs 182 raw / 42 gzip / 233 Brotli bytes.

Three retains pending attribute upload ranges until its renderer consumes them. Consecutive Rust publications,
presentation-origin restoration, and a retry before rendering coalesce overlapping or adjacent ranges instead of
clearing earlier writes. Paragraph transform identities return to a binding-local free list only after the Rust removal
transaction commits, bounding the indexed transform table under create/dispose churn. A disposed `Text` may remain in
the Three scene graph until its host detaches it without poisoning the surviving batch, and batch-wide runtime validation
runs inside the group error boundary before reconciliation mutates ownership. An internal semantic-query contract failure
advances the observed engine revision and retains unexpected render work for the ordinary zero-crossing retry path rather
than leaving the Wasm session permanently revision-conflicted. The focused public integration exercises all four
lifecycles, and the complete package gate passes 158 Rust and 165 Node tests. The canonical direct benchmark now defaults
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
[integer-units checkpoint record](../../apps/benchmarks/fixtures/results/rust-layout-bitmap-integer-units-c2e895e-darwin-arm64.json)
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
