---
type: Workspace Package
title: '@pmndrs/text'
description: Implements public font loading, shaping, paragraph measurement, static discovery, and portable raster artifact contracts.
resource: ../../packages/text
workspace_package: '@pmndrs/text'
documentation_type: reference
source_digest: 'sha256:3e73bcdbe8c884a3fae45b6883ee7d4df14c03f24e7dbccf8157d41ca873d030'
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
  - id: typescript-go-node-variance
    resource: https://github.com/microsoft/typescript-go/issues/4528
    title: TypeScript Go Three.js Node variance expansion
  - id: definitelytyped-node-extras
    resource: https://github.com/DefinitelyTyped/DefinitelyTyped/pull/75246
    title: Upstream NodeExtras lookup-map fix
  - id: bitmap-identity
    resource: ../../packages/text/src/raster/bitmap-technique.ts
    title: Bitmap descriptor and raster identity implementation
  - id: bitmap-baker
    resource: ../../packages/text/rust/bitmap-baker
    title: Portable bitmap generator implementation
  - id: raster-coverage
    resource: ../../packages/text/src/raster-coverage.ts
    title: Bounded runtime raster coverage contract
  - id: bitmap-validator
    resource: ../../packages/text/src/bakers/bitmap-validator.ts
    title: Layered bitmap artifact validator
  - id: mtsdf-admission
    resource: ../../packages/text/rust/mtsdf-admission
    title: Non-shipping MTSDF generator admission harness
  - id: mtsdf-baker-profile
    resource: ../../packages/text/scripts/profile-mtsdf-baker.mjs
    title: MTSDF artifact baker phase profiler
  - id: mtsdf-baker-profile-evidence
    resource: ../../packages/text/rust/mtsdf-admission/evidence/baker-phases-v0.json
    title: MTSDF artifact baker phase evidence
  - id: mtsdf-host
    resource: ../../packages/text/src/internal/mtsdf-generator.ts
    title: MTSDF direct-memory TypeScript host
  - id: mtsdf-contract
    resource: ../../packages/text/src/raster/msdf.ts
    title: Portable MTSDF runtime technique
  - id: mtsdf-baker
    resource: ../../packages/text/src/bakers/msdf.ts
    title: Fixed MTSDF baker host
  - id: mtsdf-validator
    resource: ../../packages/text/src/bakers/msdf-validator.ts
    title: Layered MTSDF artifact validator
  - id: mtsdf-fontations
    resource: ../../packages/text/rust/mtsdf-fontations
    title: Shared Fontations MTSDF provider
  - id: slug-contract
    resource: ../../packages/text/src/internal/slug-contract.ts
    title: Fixed Slug V0 identity contract
  - id: slug-validator
    resource: ../../packages/text/src/bakers/slug-validator.ts
    title: Layered Slug artifact validator
  - id: slug-baker
    resource: ../../packages/text/rust/slug-baker
    title: Portable Slug artifact baker
  - id: slug-baker-host
    resource: ../../packages/text/src/bakers/slug.ts
    title: Direct-memory Slug baker host
  - id: slug-runtime
    resource: ../../packages/text/src/raster/slug-technique.ts
    title: Portable analytic Slug runtime technique
  - id: slug-shaders
    resource: ../../packages/text/src/internal/slug-shaders
    title: Three.js TSL Slug shader implementation
  - id: slug-outline-research
    resource: ../planning/slug-outline-research.md
    title: Slug outline architecture
  - id: raster-wasm-host
    resource: ../../packages/text/src/internal/raster-baker-wasm.ts
    title: Shared direct-memory raster baker host
  - id: raster-atlas-runtime
    resource: ../../packages/text/src/internal/raster-atlas.ts
    title: Renderer-neutral lossless-atlas decoder
  - id: raster-technique-api
    resource: ../../packages/text/src/raster-technique.ts
    title: Portable raster technique contract
  - id: text-runtime-v1
    resource: ../../packages/text/src/text-runtime.ts
    title: Target-v1 renderer-neutral text runtime
  - id: paragraph-batch-v1
    resource: ../../packages/text/src/paragraph-batch.ts
    title: Target-v1 paragraph batching and canonical storage
  - id: formatted-text-v1
    resource: ../../packages/text/src/formatted-text.ts
    title: Target-v1 formatted text and span composer
  - id: paragraph-attachment-v1
    resource: ../../packages/text/src/paragraph-batch-attachment.ts
    title: Target-v1 renderer attachment coordinator
  - id: three-v1
    resource: ../../packages/text/src/three.ts
    title: Maintained target-v1 Three.js integration
  - id: r3f-v1
    resource: ../../packages/text/src/r3f.ts
    title: Maintained target-v1 React Three Fiber integration
  - id: typegpu-v1
    resource: ../../packages/text/src/typegpu.ts
    title: Maintained target-v1 TypeGPU integration
  - id: raster-ktx
    resource: ../../packages/text/src/internal/raster-ktx.ts
    title: Shared dependency-light KTX2 validation
  - id: raster-records
    resource: ../../packages/text/src/internal/raster-records.ts
    title: Shared dependency-light dense-record validation
  - id: raster-validation
    resource: ../../packages/text/src/internal/raster-artifact-validation.ts
    title: Shared standalone raster artifact validation
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
  - id: text-object
    resource: ../../packages/text/src/three/text.ts
    title: Framework-neutral Three.js Text object
  - id: raster-runtime
    resource: ../../packages/text/src/raster-runtime.ts
    title: Shared decoded-raster runtime
  - id: mtsdf-technique
    resource: ../../packages/text/src/raster/msdf.ts
    title: Renderer-neutral MTSDF technique
  - id: bitmap-technique
    resource: ../../packages/text/src/raster/bitmap-technique.ts
    title: Renderer-neutral Bitmap technique
  - id: slug-technique
    resource: ../../packages/text/src/raster/slug-technique.ts
    title: Renderer-neutral Slug technique
  - id: react-runtime
    resource: ../../packages/text/src/r3f.ts
    title: React Three Fiber reconciliation layer
  - id: unicode-analysis
    resource: ../../packages/text/src/internal/unicode.ts
    title: Unicode analysis implementation
generated:
  by: openai-codex/gpt-5
  at: '2026-08-08T10:15:42Z'
---

# Package reference: `@pmndrs/text`

Status: 🚧 Target-v1 core and maintained integrations are in progress

Target-v1 now has an executable renderer-neutral `TextRuntime`, `ParagraphBatch`, attachment state machine, and Bitmap,
MTSDF, and Slug techniques. The maintained `/three` adapter renders all three techniques through `WebGPURenderer` on native
WebGPU and forced WebGL2, `/r3f` retains those Three objects through React 19 Strict Mode without leaking font leases, and
the first `/typegpu` slice provides the caller-owned-root engine plus exact program/target boundary. Built-in TypeGPU raster
programs and their live-pixel proof remain open. `RasterTechnique` preserves
exact options, descriptor, decoded data, binding, and canonical storage types without `any`; its public helpers validate
and brand technique and resource identities without requiring casts. A `RasterGlyphInput` is valid only for the `select`
or `writeStorage` call that receives it, because packing pools one input per glyph and rewrites it on every update rather
than allocating a glyph-sized set each time; a technique that needs a field beyond the call copies the value.
`/raster/bitmap`, `/raster/mtsdf`, and `/raster/slug`
decode and authenticate CPU resources without importing Three, explicitly omit absent records, select stable physical
bindings, and pack positive-down paragraph origins plus technique fields into typed canonical arrays. Bitmap selects a
strike/page per glyph and retains R8 pages; MTSDF retains one RGBA8 atlas-array binding per font; Slug retains its original
RGBA16F curve, R32 header, and R16 reference bytes so Three's R16-to-R32 workaround remains target-owned. Focused package
tests prove selection, range writes, binding identity, coordinates, paint, and analytic addresses. The merged-v0 Bitmap and
Slug renderer modules, the `/raster/msdf` spelling, the merged-v0 `Text`, and the `/react` binding are deleted; `/raster/bitmap`, `/raster/mtsdf`, `/raster/slug`, `/three`, `/r3f`, and `/typegpu` are the whole renderer surface. The
Bitmap conformance lane no longer needs a fallback: driven by the target-v1 `Text`, `ThreeBitmapTarget`, and
`LoadedFont` raster data, it reproduces the benchmark's independent CPU atlas compositor in zero mismatched bytes and
returns the same pinned full-frame hash `a47930d3…e893`, the same 5,930 lit and 3,473 half-coverage pixels, and the same
`[68, 18, 313, 112]` ink bounds the merged-v0 renderer produced. Reaching that required two corrections to the exported
Bitmap graph, both invisible to a coverage-threshold smoke check and both caught only by the exact oracle: the graph had
inherited merged-v0's vertical atlas flip, which belongs to that renderer's `flipY`-enabled upload rather than to the
target-v1 pages, and it had dropped the physical-pixel snap the strike's integer placement depends on. Every Presentation
surface now renders through the target-v1 techniques and the `/three` adapter.

The `/three` adapter resolves each technique's target through a program registry keyed by the technique's stable
identifier rather than its object identity, and pre-registers the three first-party programs. Identifier keying preserves
the public raster extension boundary proven in milestone 10: a third party registers a Three program for its own technique
through `registerThreeRasterProgram`, and an application may wrap a first-party technique to instrument its runtime baker
without the wrapper losing its program. An unregistered technique fails at batch construction with a typed error naming
the identifier instead of rendering nothing. `registerThreeRasterProgram` infers that technique, so a program may type its
prepared batches, storage, and binding concretely; the registry itself stays heterogeneous and holds the erased form after
the pairing is proven at the registration call.

`/three` also exports each canonical technique shader as `bitmapShader`, `mtsdfShader`, and `slugShader`.[^three-v1] Each
takes one glyph instance's resolved nodes plus that batch's bound GPU resources and returns a named readonly output:
position, coverage, resolved colour, opacity, and the intermediate stages the technique produces, such as MTSDF's separate
fill, outline-ring, and shadow coverage or Slug's dilated render coordinate. These are not a parallel copy maintained for
external use. `ThreeBitmapTarget`, `ThreeMtsdfTarget`, and `ThreeSlugTarget` build their materials from exactly these
functions, so a composed program cannot drift from what the first-party path renders and deleting an export breaks the
built-in target rather than an unused mirror. Each function reads `positionLocal` and `uv()` from the technique's unit
quad, so a program supplying its own geometry owns that correspondence.

`bitmapShader` additionally publishes `clipPosition`, the projected quad rounded to whole physical pixels, which a program
assigns to `material.vertexNode`. Bitmap coverage is authored at one atlas texel per device pixel, so an unsnapped quad
resamples the strike rather than reproducing it, and placing that snap in the exported shader rather than in the built-in
target is what makes a composed program inherit it by construction instead of by convention. The output carries no other
route to a vertex stage, so the seam cannot be silently skipped. MTSDF and Slug deliberately publish no such member: a
distance field reconstructs its edge from the screen-space gradient and Slug integrates coverage analytically from
outlines, so both are correct at any subpixel placement and must keep the default projection. Bitmap pages upload in the
atlas's own top-down row order with `flipY` disabled, and `atlasUv` addresses that same space directly, so the sampled row
is the baked row on both backends.

The composed-program proof renders one paragraph twice on native WebGPU and forced WebGL2: once through the pre-registered
Bitmap program, then through a third-party program that owns its own attributes, geometry, and material and composes only
its final colour over `bitmapShader`. Both passes light an identical 2,616-pixel set while the composed pass emits no green
channel, so the custom program inherited the canonical placement, snapping, and coverage instead of reimplementing them.
The retained proof pages light 2,606 pixels for Bitmap, 1,935 for MTSDF, and 1,510 for Slug on both backends.

Two target-v1 raster defects surfaced when the benchmark began driving these programs against the exact conformance
oracles rather than against themselves. Slug published each quad's lower-left em corner while its shader documented and
consumed the upper-left, so every glyph integrated its coverage vertically mirrored inside a correctly placed quad;
publishing the top and walking em space downward moved the CPU band-walk reference from 22.94 mean absolute error with
22,911 severe error pixels to 0.223 with none, and restored the independent browser-rasterized source-outline envelope.
Bitmap carried two defects at once. It kept the merged renderer's vertical atlas flip, which belonged to a `flipY`
upload the target-v1 program no longer performs, so every fragment sampled the mirrored row of its page; and it dropped
the device-pixel snapping milestone 1 records as a hard density contract. Correcting both restores the pinned merged-v0
frame exactly: hash `a47930d3…e893`, 3,473 half-coverage pixels, and ink bounds `[68, 18, 313, 112]`.

Both defects were masked by self-comparison. A rendered-pixel count taken from the program under test only proves the
program is stable, not correct, so each technique is held against a reference computed independently of it.

The Three `FontLoader` forwards the two per-load capabilities the core runtime already accepted but the adapter withheld.
A request may carry an `AbortSignal`, so a cancelled load stops instead of running to completion; the merged-v0 registry
and loader both accepted one, and several consumers abort mid-load. Loader options may name a `FontRegistry`, so an
application holding registry-scoped state reaches the fonts this loader produces rather than receiving fonts owned by a
registry it cannot address.

Readonly `Text.gpuBytes` and `TextGroup.gpuBytes` report the bytes of the GPU resources their attached target currently
retains: the textures it shares across batches plus the instance buffers its committed revision owns. Reporting belongs to
the target because only the target knows the realized allocation — Bitmap's R8 pages, MTSDF's layer-padded RGBA8 atlas
array, and Slug's RGBA16F curves, R32UI headers, and pair-packed R32UI references — while the portable techniques end at
CPU data and never describe engine residency. A revision that transferred its resources to a successor reports nothing, so
a warm commit cannot count the same buffers twice; an unbound `Text` and a third-party target that omits the optional
`ThreeRasterTargetAccounting` accessor both report zero. A `Text` inside a `TextGroup` shares that group's target, so both
objects report the same batch-wide total rather than a per-paragraph share. On the retained proof pages at the default 256-glyph capacity,
16-pixel Inter Bitmap measures 707,584 bytes as one 1024×679 R8 page plus 12,288 attribute bytes, MTSDF measures
41,971,712 bytes as its 41,943,040-byte padded atlas array plus 28,672 attribute bytes, and Slug measures 3,190,784 bytes;
the same totals are reported on WebGPU and forced WebGL2.

The `txt` and `span` composer emits UTF-16 ranges over the composed string.[^formatted-text-v1] One span carries two kinds
of data with different consumption points: shaping data (`font`, `fontSize`, `lineHeight`, `letterSpacing`, `language`,
`direction`, `features`) must resolve before shaping because it segments runs and changes advances, while paint data
(`color`, `opacity`, `outline`, `shadow`) and the render variant resolve at glyph-instance packing. Both kinds resolve
through one cascade with one set of semantics, and part company only where each is consumed: the resolved shaping style
becomes disjoint segments that intersect with UAX #24 script and UAX #9 bidi runs before shaping, and the resolved paint
becomes per-glyph values indexed during packing. Resolution therefore cannot give one answer for `fontSize` and a
different one for `color`.

The cascade folds every span covering a cluster from the outermost inward and merges **per property**, so a span states
only what it changes and inherits the rest from the scope enclosing it. A style-only span shapes from the surrounding
font; a span stating only `color` keeps the surrounding opacity, outline, and shadow; a span stating only `opacity`
re-applies that opacity to the inherited fill, outline, and shadow colours. An absent property group stays absent rather
than arriving as an empty object, so a span cannot silently reset a range to a default glyph colour or shaping style.

Precedence follows containment rather than array order: the innermost covering span wins each property, and spans over
exactly the same range fall back to array order. Producer emission order is therefore not load-bearing, and a hand-built
span array that lists a contained span before the span enclosing it still resolves innermost-first. Partial overlap has no
innermost span at all, so it is rejected with a typed `SpanNestingError` naming both offending spans and their ranges
instead of resolving to whichever span a consumer happened to visit last. The font-fallback overlay the layout path
generates is machine-produced rather than authored, so it is split at the authored boundaries it crosses and stays inside
the same invariant. Resolution runs once per paragraph revision, keyed on the property snapshot, so packing indexes a
precomputed per-glyph result instead of rescanning the span array for every glyph.

Ranges count UTF-16 code units, so an astral character before a span shifts that
span by two. Replacement content owns its own formatting on both the core `Paragraph` and the Three `Text`: assigning a
literal installs that literal's spans, and assigning a plain string clears the spans it replaced rather than reinterpreting
stale ranges against unrelated text. Runtime integration covers each of these against real shaped output — inherited font
handles and glyph IDs, a nested style-only span shaping from the font its enclosing span selected, each paint property
inherited independently through MTSDF fill, outline, and shadow storage, a span font size moving both shaped advances and
the line break, the typed nesting error and order-independent precedence, per-glyph font sizes and canonical linear
colours, cluster indices across a surrogate pair, tuple-spread and direct `span` calls producing identical layout, and a
formatted literal driven through `TextGroup` binding, `updateMatrixWorld`, and the drawn per-run instance counts.

`Text` is a composite `Object3D`, not a `Group`, so it honors the primary `groupOrder` of any caller-owned parent Group.
Generated raster batches also use neutral `Object3D` roots rather than nested Groups. `Text.renderOrder` becomes the secondary
base applied to drawable meshes, which preserve their first-glyph/page-run-local offsets. Cold publication, warm retained
commits, base changes, and multi-font spans need no reshaping or per-frame descendant walk. Bitmap, MTSDF, Slug, and the
external proof package implement the required batch method, and the Three adapter rejects a plugin batch that would reset
inheritance with a nested Group.

Milestone 10.4 proves that the open contract is implementable outside this package. The private
`@pmndrs/text-glyph-example-raster` consumer owns a new literal kind, companion GLB, embedded/external records, static and runtime
bakers, decoder, retained Three.js/TSL adapter, dirty uploads, overflow, abort, and disposal without importing this package's
internals or first-party raster modules. The proof made the Three adapter requirement explicit through public
`RasterObjectDrawBatch<Object>` and `ThreeRasterDrawBatch` types while keeping portable `RasterDrawBatch` renderer-neutral. Its
neutral Three.js root preserves renderer-local transparent-run order beneath the caller-owned parent Group and `Text` base. It
also corrected `RasterRuntime.load` to retain the caller's `resolveResource` callback in cache-owned options; authenticated
external records now traverse the same deduplicated load as their companion artifact. The public type additions erase at
runtime. Compact forwarding of the complete public option bag makes browser core and every first-party runtime closure 55 raw
/ 49 minified bytes smaller than the parent. Browser core changes by −11 gzip / +76 Brotli bytes, Bitmap by −15 / −74, MTSDF
by −14 / −41, and Slug by −13 / +6. The lazy validator, every baker host, and every Wasm artifact remain byte-identical.

Slug V0 renders fill and opacity and rejects outline or shadow paint before batch allocation or paint mutation. The removed exact-distance outline and the bounded replacement gate are retained in the [outline research record](../planning/slug-outline-research.md).

This package owns the accepted public core and React contract types. Its fixtures prove literal font and raster inference, capability composition, source/baked input rules, paragraph constraints, React prop derivation, lazy raster and `useFont` inference, and invalid combinations at compile time. React and React Three Fiber remain optional peer capabilities and are not reachable from the core entry point. Three.js-facing runtime values and types resolve through the public `three/webgpu` and `three/tsl` subpaths rather than the legacy root or internal source exports, matching the renderer boundary used by first-party raster work; package lint rejects those forbidden imports. Public raster-baker descriptors are constrained to `JsonValue` while preserving their exact inferred shape. Plugin-produced values are still revalidated during their unavoidable RFC 8785 canonicalization pass: exotic prototypes, cycles, excessive nesting, non-finite numbers, invalid Unicode, and non-JSON values cannot collide with a valid raster identity, while repeated non-cyclic references remain legal. Project plans resolve each descriptor and `rasterKey` once, then carry that same pair through ordering, packaging, and baking so a stateful plugin cannot make identity drift within one bake.

Every `Text` generation now uses one required renderer-neutral raster transaction. `stageBatch` receives the prior compatible batch when one exists and returns an unpublished target plus synchronous `commit` and idempotent `abort`; there is no separate build, optional retained-update, or repaint-mutation contract. A candidate publishes only after every participating raster stages successfully. Failure, cancellation, or stale completion aborts staging without touching the live generation, while commit transfers exact batch ownership atomically. The portable batch surface owns only idempotent disposal and imports no Three.js type; the Three-backed `Text` adapter separately validates and attaches each target object. Bitmap, MTSDF, and Slug allocate deterministic 25% instance slack capped at 256 glyphs, track logical draw count independently, and retain geometry, material, texture, attribute, and backing-array identity while arbitrary replacement glyphs fit. Bitmap updates origin, size, UV, and color fields; MTSDF updates its complete 28-float instance record; Slug updates both its 17-float and six-integer records. Shrinks and exact-capacity growth update authoritative `instanceCount`, while overflow, strike changes, or incompatible ordered Bitmap/Slug page-run topology stage a correctness-preserving replacement. Dirty instances coalesce through 32-instance buckets and fall back to one logical full-range upload above eight disjoint ranges; unconsumed Three.js ranges carry into the next stage so a later commit cannot lose an earlier GPU upload.[^bitmap-identity][^mtsdf-contract][^slug-runtime]

Milestone 9 introduces the fixed Slug V0 identity and standalone artifact-validation boundary.[^slug-contract][^slug-validator] The validator layers the pinned Khronos and byte-identical extension schemas over exact 40-byte dense records, exclusive buffer-view ownership, lossless native RGBA16F KTX2 curve pages, R32UI header grids, R16UI reference grids, checked page-relative addressing, authenticated external resources, and bounded GPU residency. Malformed identity, record, address, padding, KTX2 descriptor, integer-grid tail, external hash, and residency cases are named negative controls. That boundary feeds the package-owned Slug baker, registered-raster loader, analytic runtime, and framework-neutral public `Text` path described below. The retained all-external public-loader framebuffer gate and performance-review packets close Milestone 9; additional Slug tuning remains future measured research rather than unfinished renderer integration.

The package-owned Slug baker now composes the ported outline conversion and exact packing crates into deterministic embedded or independently authenticated external-page artifacts.[^slug-baker] Its Rust-generated V0 ABI drives the same shared direct/segmented host mechanics used by the existing raster bakers, including bounded artifact windows, synchronous progress forwarding, owned-copy-before-release behavior, structured errors, and transactional allocation cleanup.[^slug-baker-host] The serial module-Worker entry remains lazy; neither the baker host nor Wasm enters the initial renderer graph.

The fixed Slug renderer copies and adapts the reviewed Three Flatland TSL implementation to the package's exact V0 resources rather than recreating the analytic coverage graph.[^slug-runtime][^slug-shaders] It uploads lossless RGBA16F curves and R32UI headers directly; the Three.js adapter pair-packs exact R16UI glyph-local references into R32UI texels because Three 0.185.1's WebGL TSL backend otherwise declares a float sampler for `UnsignedShortType`. The adapter retains two bytes per reference plus at most one terminal padding value, while the authenticated artifact remains unchanged. Integer instanced addresses, consecutive page runs, hostile per-band work caps, the stable q-form solver, and loop-invariant derivative and reciprocal hoists remain intact. The patched `NodeExtras` declaration makes ordinary public TSL operator calls tractable; the private compatibility boundary now erases only the two runtime-supported operations Three 0.185.1 does not type precisely: boolean-form `Loop` and unsigned `textureLoad`. Shader construction stays inside `Fn` boundaries; assignment nodes append through the active TSL stack, axis-specific declaration names produce clean diagnostics, and package tests prove that ordinary core, Bitmap, and MTSDF entry graphs do not eagerly include Slug. The shared registered-raster resource seam resolves embedded views or independently packaged resources through a caller resolver or the companion artifact's retained URL/fetch context, then enforces declared length, SHA-256 identity, cancellation, and the registry resource ceiling before Slug creates any GPU object. Embedded and external baker outputs prove byte-identical records and curve/header/reference resources; retained WebGPU and forced-WebGL2 captures now cover exact pixels plus the seven-source visual and performance corpus.

The shipped Slug runtime retains only the original 17-float fill instance layout and one fill material. The removed one-draw outline was visually correct but added a separate closest-distance curve solver after ordinary coverage. Retained 268-glyph measurements placed it at `2.44×–4.33×` fill-only GPU time across WebGPU/WebGL2 and DPR 1/2, so the implementation, TSL distance graph, outline attributes, CPU stroke authority, and benchmark controls were deleted rather than preserved as a fallback. Any future outline must reuse ordinary fill traversal, stay within the documented near-fill performance gate, and match or beat MTSDF outline quality.[^slug-outline-research]

The non-shipping `autoresearch-fixed32-bands` baker feature proves that V0's per-glyph band counts are an executable optimization seam without becoming a JavaScript option or alternate distribution. It produces separately retained candidate artifacts; the ordinary Wasm build remains fixed 16. Exact dual-backend quality and interleaved product evidence reject universal fixed 32 as the production policy because its curve-work reduction comes with double-digit payload and residency growth. The separately gated `autoresearch-adaptive-bands` feature selects only among 16, 32, and 64 at bake time and never enters the production Wasm build. Its first six-reference target is rejected at the artifact gate because 64-band escalation grows every source. The distinct `autoresearch-adaptive32-bands` feature caps the same trigger at 32 under a separately precommitted manifest; its exact quality and complete dual-backend timing evidence also reject the universal policy because the added resources do not yield a reliable guard-wide product win. The copied packed-hull format likewise preserves exact pixels but is rejected after complete dual-backend product measurement: no source clears the 5% gate on both backends, while the incompatible reference layout adds 29.0–44.2% gzip bytes and 17.4–25.2% GPU residency. Its implementation remains at the retained candidate commit rather than adding a runtime format branch. The root-contribution challenger is also rejected and removed from the shipping tree after exact same-build measurement. Inspection of final Three 0.185.1 programs corrected the older mechanism: boolean `select` already emits control flow, so the candidate coalesces eight root-condition branches into four rather than replacing eager arithmetic. All 28 quality cells remain byte-identical and resources remain exact, but no source clears the 5% gate on both backends; the seven-source median paired deltas are a 0.84% WebGPU regression and a 1.56% WebGL2 improvement. Its implementation remains available at the retained candidate commit without adding an experiment API to the public raster. None of these experiments changes production output or rewrites the retained rejections.

The workspace pnpm patch carries DefinitelyTyped's `NodeExtras` lookup-map rewrite for `@types/three` 0.185.1.[^definitelytyped-node-extras] It replaces the deeply nested `Node<TNodeType>` conditional/intersection chain identified by TypeScript Go issue 4528 without changing the public node extensions.[^typescript-go-node-variance] The compile-only TSL regression covers the previously explosive method chain, uint shift/bitwise operations, integer division/modulo, vector derivatives, and object-form loop; it completes in 215 milliseconds at 4 MiB peak RSS. The complete text project completes in 346 milliseconds at 252 MiB, so package and build scripts invoke the pinned compiler directly and the former native-process memory guard is removed. The private unsigned-texture adapter remains separately justified because Three 0.185.1 types `textureLoad` as a generic float `TextureNode` even for an unsigned data texture; it is not compiler containment.

Milestone 8.1 adds a repository-owned `no_std + alloc` Rust MTSDF core and a non-shipping admission harness beside the package's existing bakers. Typed AoS outline construction lowers once into kind-segregated SoA spans with contour identity; reusable scratch keeps per-pixel traversal allocation-free and now retains corner-coloring storage between glyphs. True signed curve distances, contour-aware overlap combination, nonzero-fill sign correction, and deterministic edge coloring produce zero coverage mismatches against pinned native `msdfgen` 1.13.0 across ordinary, acute, overlapping, self-intersecting, quadratic, cubic, and counter fixtures. Quadratic segments use the exact stationary-point polynomial solve from the pinned reference rather than nine seeded Newton searches; a regression fixture proves the former approximation can choose a materially wrong distance. Post-quantization correction retains the reference-compatible edge-fast pass for ordinary channel collisions, then applies at most four MTSDF-specific passes only to cells where bilinear RGB coverage disagrees with true-distance alpha near the coverage boundary. Both correction stages are glyph-local. Mean alpha error stays between 0.470 and 0.549 bytes with zero oracle coverage mismatches. The optimized `wasm32-unknown-unknown` admission module imports nothing and its compiled graph contains no font parser, WGPU, native binding, or WASI dependency. Its recorded binary hash and compressed sizes are explicitly host-labeled: the recorded host requires exact freshness, while every foreign host must rebuild the module, reproduce the portable admission contract and synthetic output, retain zero imports, and remain under the same reviewed raw/optimized/gzip/Brotli ceilings. A bounded cargo-fuzz lane covers malformed outline streams. The oracle, channel-SIMD, scalar-tile, and adjacent-texel SIMD implementations remain test-only; scalar is the single production kernel.

The geometry core is independent of its host boundary. A sibling `mtsdf-baker` crate owns the package allocator and seven-function generator C ABI for allocation, release, generation, and borrowed-result access. Build-only Rust generation derives the portable JSON and exact typed TypeScript contract; production Wasm does not embed or export that contract. Callers write one checked header plus fixed command records directly into Wasm memory; the module accepts only exact active pointer/length pairs and rejects a released allocation. The generator exposes a checked sampling transform for production baking: every glyph may be placed on one global plane grid with one authoritative distance range, rather than stretching each glyph independently to its rounded texture dimensions. The legacy one-em oracle path uses the same implementation and remains byte-identical. A feature-minimal admission build preserves the independently measured generator boundary, while the package publishes one full baker module containing that kernel and the artifact pipeline rather than duplicating it as a second Wasm resource. Its internal TypeScript host writes discriminated move/line/quadratic/cubic/close commands directly into linear memory, maps statuses to typed errors, verifies the exact RGBA8 length, copies borrowed output before release, and releases requests after every later failure. All seven native-oracle cases retain their independent SHA-256 identities through the host; malformed numeric/outline input, forged release ranges, stale allocations, ABI drift, and cleanup after invalid output are named regressions. The feature-minimal scalar boundary remains separately measured from its host.

Milestone 8.2 composed that kernel into the original fixed `@pmndrs/text/bakers/msdf` artifact path. One shared Fontations adapter supplies maintained unscaled line, quadratic, and cubic outlines to both admission evidence and the baker; no second parser or outline bridge exists. Its 64 px/em, full-eight-pixel-range descriptor hashes to `e944ba8d…fe93`. Item 8.6 now exposes `emSize` and full `pixelRange` as authenticated integer bake options in `1..=1022` and `1..=1020`. Omitted or partial options resolve against 64/8; explicit effective 64/8 canonicalizes to the legacy fieldless descriptor and raster key, while every non-default descriptor carries both effective values. `planeUnitsPerEm` equals `emSize`, and each glyph is evaluated only over its tight source-outline rectangle plus `ceil(pixelRange / 2)` field-padding texels on that global plane grid. Correction operates over the same glyph-local rectangle before copying into a 1024-pixel atlas page. Real 155-glyph subset bakes at 32/4 and 32/6 pass artifact validation, establishing the control path without changing the recommended default before quality and payload benchmarking. Bitmap and MTSDF descriptors may additionally authenticate bounded raster coverage while retaining the full source-local glyph namespace and dense record table. Standalone validation derives the expected coverage only from that authenticated descriptor; its public context has no second coverage field that could silently disagree. Degenerate non-rendering selected glyphs become exact absent records, while malformed command streams remain typed failures. The shared TypeScript direct-memory host owns allocation, response framing, nested metadata validation, copying, and transactional cleanup for both bitmap and MTSDF bakers.

Direct raster-baker ABI revision 1 keeps ordinary responses contiguous and moves oversized results through bounded borrowed windows: the host reads metadata once, copies each window while Wasm owns it, and explicitly releases that ownership before the Worker transfers exact result buffers. Every Wasm pointer, status, length, and count is normalized as unsigned at the JavaScript boundary. The generator-only no-default-feature MTSDF module remains valid because artifact-baker fields are optional to the generator host, while the packaged baker requires and validates them. MTSDF quality options travel in the authenticated descriptor and do not change the low-level Wasm ABI. Build output removes obsolete ABI revision 0 files before packing.

Bitmap and MTSDF runtime fallback share one serial ESM module-Worker host. The same normalized descriptor options drive deliberate Node baking and missing-artifact fallback; Bitmap's Worker normalizer retains both strikes and coverage instead of projecting coverage away. Each dynamically imported baker receives an owned source copy, one active job uses the reusable Worker, queued jobs remain FIFO, cancellation replaces active ownership safely, and an idle Worker terminates. Preparation failures reject through the promised asynchronous API rather than escaping synchronously. Core provenance now retains the authenticated collection-face index; legacy artifacts may default only when their descriptor hash proves face zero, and runtime raster baking always reuses that selected face. Registry subscriptions are released when their final tracked font is disposed.

Runtime font and raster bake requests accept one optional `onProgress` listener. Its closed contract reports `font` or `raster` stage, a versioned phase, and bounded `completed`/`total` units. The host reports `queued` immediately; Workers report loading, packaging, transfer, and completion; Rust reports raster glyph progress through one generated synchronous Wasm import at roughly one hundred updates per complete pass. Progress messages never resolve a request, mutate render state, or enter the shaping/rendering graph. Consumers may therefore present deterministic progress without polling, timers, or main-thread baking, while omitting the listener pays only the fixed callback branch in optional baker code.

Item 8.6 makes runtime raster coverage an explicit bounded capability rather than forcing every request through a complete-face atlas. One frozen typed contract accepts sorted, non-overlapping inclusive Unicode scalar ranges, authored scalar text, and sorted exact font-local `u16` glyph IDs under fixed count limits. Unicode ranges skip code points absent from the selected face; authored text fails if any scalar is unmapped; exact glyph IDs fail outside that face. The union selects raster work only: it does not subset the shaping font, remap IDs, or claim GSUB/GPOS closure. Sparse artifacts retain dense records and add one exact `ceil(glyphCount / 8)` little-endian selection bitset, where bit `n % 8` of byte `n / 8` names glyph `n`; unused terminal bits are zero. Selected spaces may remain absent records, while every unselected record must be absent. The canonical seed descriptor and bitset must appear together and are strictly validated.

Node composition, direct Wasm calls, and the serial module-Worker use the same canonical descriptor and produce byte-identical bounded Bitmap/MTSDF artifacts. Complete descriptors retain their legacy raster keys and complete-face artifact/page hashes. Both runtime decoders rederive the canonical raster key from the authenticated artifact policy before creating GPU resources, so mutated strikes, quality settings, or coverage cannot retain a stale declared identity. Progress totals count selected glyphs rather than the source face, active cancellation replaces the Worker before queued recovery, and warm runtime preparation throws public `RasterCoverageError` with sorted missing font-local IDs before publishing a partial batch. This boundary intentionally leaves transitive shaping closure and compiler source subsetting to Milestone 17.

The Darwin arm64 coverage-capable Binaryen-optimized MTSDF baker measurement is 552,025 raw, 215,030 gzip, and 168,758 Brotli bytes with one generated synchronous progress import; its independent host is 26,940 raw, 19,117 minified, 5,530 gzip, and 4,908 Brotli bytes and remains lazy outside the shaper and renderer graphs. The corresponding Bitmap baker is 626,940 raw, 234,735 gzip, and 180,503 Brotli bytes. The shared boundary materializes one validated JSON value for artifact packaging and canonical policy hashing instead of instantiating a second derived serializer graph. Relative to the pre-coverage modules, the remaining Brotli growth is 5,188 bytes for MTSDF and 6,951 bytes for Bitmap; dedicated raw, minified, gzip, and Brotli regression gates keep that strict decoding, cmap resolution, and policy-validation cost explicit. Compiled Wasm size and hash remain host-labeled package-size evidence with reviewed foreign-host ceilings; raster fixtures authenticate the generator version and exact baked outputs rather than treating a host compiler binary length as portable artifact identity. Profiling uses a private diagnostic entry that is neither packed nor present in the package export map and is unreachable from every production raster-baker graph, so ordinary bakes perform no clock, memory, or output-size observation. The package-size build fails if a shipped JavaScript graph reaches that module or retains its profiling symbols, if a thin baker host retains `performance.now`, or if a production Wasm import/export exposes profiling or timing. Canonical 64/8 Inter still produces 58,740 record bytes and ten independently addressable single-level lossless RGBA8 KTX2 pages. Their authored levels contain 39,111,736 unpadded texel bytes and occupy 41,943,040 exact bytes after texture-array layer padding; the corrected embedded full-font artifact remains 39,347,712 raw and 6,798,412 gzip bytes. The exact legacy descriptor, artifact, and page hashes remain unchanged. On the 1,402-icon Font Awesome fixture, the exact quadratic solve reduced a two-icon targeted raster pass from about 392 to 170 milliseconds and the refreshed complete-face bake measured 113.5 seconds; these are same-host observations, not portable performance gates. The complete artifact contains nine pages, 32,511,100 bytes of authored texture payload, 36,347,904 bytes of padded GPU allocation, 32,580,900 raw transport bytes, and 7,227,824 gzip transport bytes. The Worker forwards bounded progress while the synchronous Wasm call is active.

That complete-face duration is a measured kernel cost, not an unexplained Worker stall. The discoverable `text:mtsdf-baker-profile` workflow accepts `--case=small|medium|complete|all` and compiles its native phase observer once. It measures the shared optimized pipeline by selection, outline extraction, texel generation, packing, KTX2 encoding, and GLB serialization, then runs the real optimized Wasm directly and through the serial module Worker. On the recorded Apple arm64 host, texel generation consumes 245.40 of 248.32 native milliseconds for the 39-selected-glyph case, 4,429.17 of 4,445.46 milliseconds for the 524-selected-glyph case, and 25,871.57 of 25,957.06 milliseconds for complete Inter. Those cases generate 71,341, 1,289,496, and 7,233,197 texels while visiting 1,694,576, 36,939,819, and 227,327,416 colored edges. Direct Wasm-to-host copies cost 0.69, 0.74, and 4.51 milliseconds; final Worker delivery costs 0.46, 0.61, and 0.47 milliseconds. Wasm linear-memory high-water marks are 6,488,064, 36,634,624, and 227,737,600 bytes; isolated Worker-process peaks are 109,002,752, 147,177,472, and 343,343,104 bytes. The corresponding artifacts are 595,752, 7,074,796, and 39,175,608 bytes. Direct Wasm and Worker identities are exact. The complete native-arm artifact is recorded separately because native and Wasm floating-point targets diverge there; it is not substituted for the shipped Wasm identity. Texel traversal is therefore the measured dominant phase and triggers the adjacent-texel scalar/SIMD comparison, while bounded runtime atlases remain the interactive path and complete faces remain explicit offline/stress work.

Thin production artifacts use `pnpm build`; its MTSDF Wasm command is an optimized `--no-default-features --features artifact-baker` build, so the Rust `profiling` feature and phase observer do not exist in the module. `pnpm scripts run release:size:check` rebuilds those artifacts and enforces the JavaScript/Wasm diagnostic-exclusion boundary alongside exact size identity. An optimized diagnostic run is deliberate: `pnpm scripts run text:mtsdf-baker-profile -- --case=small` compiles the native binary with `--features=profiling` and imports the private TypeScript diagnostic entry; `--case=all --write` is reserved for refreshing retained phase evidence. The profiling entry is neither a public package export nor transitively imported by a production entry. The only remaining `performance.now` calls in package production source belong to the Node bake API's documented `timingsMs` result; that observable output is part of the maintained host contract rather than a hidden debug path.

The retained SIMD decision evidence compares an equivalent four-texel scalar tile with a feature-gated adjacent-texel SIMD candidate. Both preserved every seven-case native-oracle hash, the complete 2,937-slot Inter checksum, rejection set, composite identity, warm allocation count, and steady-state Wasm memory. The candidate vectorized line-distance work across four neighboring texels while retaining the exact scalar quadratic and cubic solvers lane by lane. Adjacent SIMD improved the bounded Node corpus from 45.712 to 44.608 milliseconds (2.4%) and Chromium from 28.965 to 28.700 milliseconds (0.9%), but complete Inter was indistinguishable warm at 45.068 versus 45.066 seconds and its 50.110-second cold pass was slower than scalar's 44.089 seconds. Those bounded improvements did not justify a second target-specific artifact: optimized size grew from 52,633 to 63,549 bytes (20.7%) and Brotli size from 19,660 to 21,904 bytes (11.4%). The closed experiment runners are no longer maintained as product workflows; the accepted scalar kernel, independent native oracle, public baker tests, and package-size gate remain active.

The shaper, Bitmap baker, and MTSDF generator/artifact boundary define every direct-memory header and table as a fixed-width `#[repr(C)]` Rust type. Build-only Rust generators derive each JSON size, alignment, and field offset from `size_of`, `align_of`, and `offset_of!`, then emit exact typed `as const` TypeScript modules from that JSON. Rust readers/writers and production TypeScript therefore consume one compiler-led truth; CI compares regenerated output byte-for-byte and fails on stale checked-in modules. Production Wasm embeds no duplicate JSON and exports no ABI pointer/length bootstrap. This keeps QuickType, JSON Schema, runtime JSON parsing, and binding-generator code out of the shipping graph. Wasm linear memory is guaranteed little-endian; serialized GLB, KTX2, SFNT, and extension records continue to follow their own portable format contracts.

The first Rust text-engine foundation keeps that direct-memory rule and adds a renderer-neutral `no_std + alloc` policy
model to the existing shaper `rlib`, not a second Wasm module. Plain data and total validation functions bound program,
buffer, operation, register, field, vector-width, and store coverage before execution; technique variants share that one
verifier instead of owning parallel packers. The initial module is deliberately unreachable from the Wasm exports while
its fixed-width wire contract is built, and optimized dead-code evidence keeps the shipping shaper at 680,312 raw bytes.

The next boundary slice exposes policy registration through compiler-derived `#[repr(C)]` request, program, buffer, and
operation records. TypeScript consumes the generated offsets directly; Rust performs one bounded registration-time
decode and retains typed policy state, so frame updates do not parse policy records. The decoder rejects forged lengths,
overlapping tables, nonzero reserved fields, noncanonical operation records, invalid register flow, and incomplete
physical outputs. Registration is idempotent only for an identical handle and policy, conflicting reuse and missing
disposal are distinct statuses, and retained state survives release of the request allocation. The optimized reachable
module measures 698,238 raw / 260,228 gzip / 203,760 Brotli bytes on the same Darwin arm64 toolchain, a delta of
17,926 / 6,660 / 4,395 bytes over the preceding shaper. This is cold registration infrastructure; frame-path admission
and performance remain unclaimed until the retained update and executor land. The existing 25,515-glyph TypeScript path
remains within measurement variance: baseline-to-current cold/font-size/layout-width/text medians are
55.28→52.48 / 12.02→11.92 / 8.42→8.23 / 38.66→38.73 milliseconds.

The retained frame shell gives each engine session one 16-byte-aligned request arena and two 16-byte-aligned result
arenas. Cold creation and reservation may resize them; a warm update reads the already-pinned request and returns the
selected result pointer in that single call. The compiler-derived request header was 120 bytes in Stage 1 and is now 124
bytes after adding renderer-fence acknowledgment. Its section offsets cover
text/style mutations, constraints, regions, exclusions, inline objects, and policy parameters; Stage 1 accepts only the
canonical empty transaction and rejects a nonempty section until its Rust consumer exists. The 144-byte aligned result
header fixes revisions, base requirements, capacity watermarks, output slot and generation, policy handle, capability
set, policy fingerprint, plus semantic,
resource, physical-buffer, patch, primitive, draw, retirement, and diagnostic table locations. Successful publication
alternates A/B slots; a failed parse or revision check writes the inactive slot without advancing or modifying the active
publication. The real optimized-Wasm test proves that a warm update preserves `memory.buffer`, while an 8 MiB cold
reserve detaches the prior fixed buffer and requires re-reading the aligned request pointer. This shell measures 725,302
raw / 269,438 gzip / 210,867 Brotli bytes, adding 27,064 / 9,210 / 7,107 bytes to the policy-registration checkpoint.
Semantic tables remain empty, so no shaping or layout performance claim is attached to this stage. The current
25,515-glyph TypeScript path remains within run variance at 54.42/12.15/8.31/38.98 millisecond
cold/font-size/layout-width/text medians and 70.38/14.48/11.31/40.89 millisecond p95 values. The package's 186
integration tests and six fuzz targets pass, as do the benchmark application's 117 tests, 20/20 warmed headless
conformance scenarios, and 172,156-byte packed-consumer proof
(`af7bfb85f04a6a63c6462735a6e8ec6d739576adb354c07ca51e744814db2f7b`). The aggregate benchmark script still stops
at its deliberately stale checked package-size snapshot; this stage records the actual measured size without rewriting
that unrelated historical evidence.

The render-plan wire layer now gives those result tables concrete compiler-mapped records: semantic 44 bytes, resource
40, physical buffer 36, patch 36, primitive 64, draw 60, retirement 24, and diagnostic 24. Resource kind is independent
from create/update/retain action, and ordered-direct versus stable-indirect allocation is a dedicated buffer strategy.
Patch payload bytes live inside the same immutable publication and write records carry absolute rebased spans; allocate/
resize, fill, copy, and retire records do not carry a payload address. Serialization is allocation-free, canonical
little-endian, and explicitly field-wise rather than a raw Rust-struct copy. Validation proves finite geometry, known
tags, bounded table ranges, and exact payload spans before touching the inactive arena. The result header publishes the
registered policy fingerprint with the plan, while failure headers expose neither that identity nor partial table state.
The current shipping update still emits an empty plan until retained semantic compilation lands; these records prove the
wire and publication contract, not incremental-layout performance.

Policy registration now supplies the missing inputs to that compiler through the same compiler-mapped direct-memory
contract. Its 36-byte header addresses fixed 40-byte capability-set, 56-byte program, 16-byte buffer, and 16-byte
operation tables; registration decodes those bytes once into retained typed Rust state. Capability-set-specific lookup
validates backend flags, binding and draw limits, integer upload costs, resource-kind masks, independent storage/draw
keys, allocation strategy, and aligned padded buffer strides before a session revision can advance. The executor honors declared stride
without touching padding. Physical outputs remain disjoint independently bindable vector streams; policy operations
pack wider records instead of introducing aliased mutable interleaved fields. Thirty-six Rust unit tests and the focused
Node registration/frame tests pass. The optimized SIMD artifact is 739,647 raw / 272,532 gzip / 214,186 Brotli bytes,
14,075 / 3,272 / 3,173 bytes above the preceding executor artifact; this is registration/planner metadata, not a warm
layout performance result.

The native renderer-neutral core now contains the first retained ordered-direct storage planner. It groups glyphs by
validated technique/program/resource, assigns stable physical buffer identities, and uses stable instance IDs plus
semantic content revisions to select aligned dirty records without comparing buffer bytes. The registered gap/call
cost, fragmentation budget, and whole-buffer threshold coalesce writes; consecutive changed records execute as SIMD
runs, while resource interleaving produces smaller scalar tails only where contiguity is genuinely absent. Preparation
is separately viewable, committable, and abortable: no committed CPU mirror changes before immutable plan serialization.
Tests cover exact first publication, a one-record update, ordered suffix movement, no-op zero output, metadata-only tail
deletion, retirement generations, abort preservation, compiler-wire validation, and unchanged warm scratch capacities.
Dirty transactions additionally publish complete compact resource/buffer bindings and ordered glyph-span/draw tables;
the physical buffer payload remains range-minimal. A primitive span represents consecutive compatible physical records
and carries one 16-bit record count, so the compiler splits only on ordering/binding identity, physical discontinuity, or
the 65,535-record wire limit instead of emitting a 64-byte primitive per glyph. Draws carry numeric material, clip, and
depth identities and exact table ranges, never a renderer object or callback. Different material IDs split draws under
the first-party policy while retaining one shared physical glyph buffer. An interleaved `A, A, B, A` resource test
produces three ordered spans over two deduplicated resources and buffers. The policy program is restricted packing
bytecode executed by Rust; the render plan itself is data. The planner remains unreachable from the shipping Wasm update
and is LTO-stripped. Only the reachable draw-wire and policy-key expansion changes the optimized SIMD artifact to
739,909 raw / 272,607 gzip / 214,288 Brotli bytes. No planner latency claim is attached until session wiring makes it
reachable. Stable-indirect storage now compiles complete resource, physical-buffer, patch, glyph-span, draw, and
retirement tables. Semantic identities retain physical record slots; content revisions select writes; fixed 64-entry
`u32` chunks carry logical order through the generated reserved binding ID 65,535. In the one-stream fixture, a localized
insertion writes one new 4-byte physical record and one affected 16-byte order range, while a pure reorder emits no
physical write. Removed slots/chunks remain quarantined until an explicit renderer-fence acknowledgment; applying a plan
is not proof that queued GPU work completed. When physical order spans would exceed the capability fragmentation budget,
the compiler transactionally rebases only the order buffer, retires its prior generation, and preserves glyph-buffer
generations. Tests cover no-op, abort, mixed resources, shared and material-partitioned storage, fence-gated reuse, wire
validation, bounded order fragmentation, and unchanged nested scratch capacities after warm settlement. Session wiring
and the ABI acknowledgment field remain open. The planner remains LTO-stripped: raw Wasm stays 739,909 bytes; the
reachable binding identity shifts gzip 272,607→272,624 and Brotli 214,288→214,395 bytes. No planner-latency or end-to-end
claim is attached yet.

The allocation-strategy dispatcher now compiles one frame containing both ordered-direct and stable-indirect policy
programs without first copying glyphs or semantic fields into strategy-specific arrays. Homogeneous frames delegate
directly to one compiler; only mixed frames merge renderer-facing tables. Ordered buffers occupy the low `u32` ID half
and stable physical/order buffers the high half. The merge rebases patch payload offsets, validates/deduplicates shared
resources, removes resource retirements when another strategy keeps the same generation live, and restores the original
global draw order. Focused tests cover alternating strategies, allocation-strategy transitions, zero-output mixed
no-ops, and settled merge capacities. This dispatcher remains unreachable from `text_update`; it adds no end-to-end
timing claim before session integration. The required unchanged-path 25,515-glyph benchmark reports
57.18/12.44/8.58/39.28 ms median and 72.41/15.53/11.32/41.81 ms p95 for cold/font-size/width/text versus the prior
recorded 54.42/12.15/8.31/38.98 ms medians. The optimized Wasm remains 739,909 raw and 214,395 Brotli bytes, so the
dispatcher is still LTO-stripped and the table is baseline run variance rather than a planner performance result.

Engine sessions now own the Rust allocation-strategy dispatcher. The current compiler-derived request header is 124
bytes for `acknowledgedPublicationGeneration`, a renderer-fence field independent from `consumedPlanRevision`. Rust
requires acknowledgment to be monotonic and no newer than the last successful publication. The update path prepares and
views the session plan, stages it in the inactive result arena, commits planner and revision state only after successful
serialization, and aborts the planner on every failure. A session pins its first committed policy handle/fingerprint;
capability sets may change within that policy, but replacing the policy beneath retained buffers fails before mutation.
Focused compiled-Wasm tests cover accepted/future fences and unchanged A/B publication; host tests cover stale fences,
abort/retry, capability-set changes, and policy identity. A post-prepare Wasm abort cannot be induced until nonempty
semantic input exists, so that exact ordering remains an explicit test gap. The now-reachable planners increase the
optimized artifact from 739,909 / 272,624 / 214,395 to
822,443 / 308,033 / 242,447 raw/gzip/Brotli bytes. This is a measured shared-runtime cost and a pending optimization
target. Ordered UTF-16 replacements are now retained transactionally. Editorial constraints, regions, exclusions, and
inline objects now decode as borrowed one-call geometry; style upserts/removals are decoded and retained transactionally.
Sessions still publish an empty Rust plan because retained text is not yet shaped or laid out; there is no Rust
shaping/layout performance result yet, and the TypeScript layout table above remains baseline-only.

The semantic request now has compiler-derived record layouts without a handwritten TypeScript mirror: 24-byte UTF-16
text replacements, 88-byte stable style mutations, 52-byte constraints, 8-byte flow vertices, 56-byte regions, 48-byte
exclusions, and 56-byte inline objects. Region/exclusion rectangles use inline bounds, while bounded polygons reference
vertices inside the same request. Styles separate stable identity from authored cascade order and include current
shaping fields plus word spacing, target raster density, material/color, and decoration inputs. A field mask records
which values were authored so absent values inherit rather than being confused with zero-valued declarations. The
generated ABI and compiled-Wasm test pin every size, tag, and the inline-object
`baselineAlignment` offset. The generated engine vocabulary now also fixes axis, wrap, inline/block alignment, overflow,
writing, orientation, exclusion-side, and inline-object baseline tags rather than accepting renderer-local enum bytes.

Style decoding is borrowed and allocation-free. Session creation pre-reserves two flat 64-style arenas, 512 language
bytes and 128 OpenType feature records per arena, plus reusable mutation, cascade-order, and nesting scratch. A style
update sorts mutations by stable ID, retains only the final operation for each ID, and merge-walks them with committed
styles into the inactive arena; language and feature payloads are compacted during the merge rather than retained as a
`Vec` per span or allowed to accumulate stale bytes. Validation covers canonical absent fields, finite/positive values,
language/tags, feature and UTF-16 boundaries, registered font stacks, one complete root, unambiguous equal-range cascade order,
nested rather than partially overlapping ranges, and cross-section payload aliasing. Commit swaps arenas; abort clears
only pending lengths. Once styles exist, a text edit must leave all retained ranges valid and cannot remove the sole
root. A real-font compiled-Wasm transaction proves the first combined text/root update and an invalid root removal do
not grow memory after session creation. Reachability changes optimized Wasm from 856,831 / 319,003 / 252,236 to
888,423 / 332,740 / 262,748 raw/gzip/Brotli bytes (+31,592 / +13,737 / +10,512). Plans remain empty, so this is retained
state evidence, not a shaping/layout latency result.

The frame decoder now borrows ordered UTF-16 replacement records and their offset-addressed payloads directly from the
pinned request. It validates canonical empty offsets, opcode/encoding, reserved fields, bounds, alignment, arithmetic,
and record/payload non-overlap before the session transaction. Rust applies sequential replacements into retained
scratch, swaps them into committed text only after plan commit, and clears scratch on abort or a malformed later edit.
The compiled-Wasm test performs a cold reserve/re-pin, inserts text, edits a position that is valid only if the first
update was retained, rejects an out-of-bounds edit without changing the active A/B publication, and observes no memory
growth on the same-capacity edit. This is real Rust text retention, not shaping or layout; plan tables remain empty and no
latency result is claimed. Reachability changes optimized Wasm from 822,469 / 306,502 / 242,707 to
825,298 / 308,030 / 243,323 raw/gzip/Brotli bytes (+2,829 / +1,528 / +616 shared-runtime bytes).

Session creation also prewarms both retained UTF-16 buffers to 1,024 units by default, and the cold create/reserve ABI
accepts an explicit text capacity for known large paragraphs. This removes the observed second-buffer lazy allocation
without giving every text object the 25K-glyph benchmark footprint. Production analysis/shaping/layout scratch will be
one synchronous engine-global 32,768-record workspace, reserved once when those arrays land and shared by every session.
The compiler-published `initialize()` export is invoked by the standard host immediately after Wasm instantiation. It
now reserves both the plan-glyph arena and HarfRust's actual 32,768-codepoint internal info/position allocation plus one
equally sized decoded-context array. Each segment returns the same allocation through `GlyphBuffer::clear`, including
restoration after fallible setup. Initialization grows linear memory from 1,245,184 to 4,980,736 bytes (57 pages), and
a repeated call preserves buffer identity. Policy-specific gather lanes settle during cold registration. The optimized
artifact is 847,814 raw / 315,809 gzip / 249,629 Brotli bytes, +2,234 / +524 / +408 over the policy-gather checkpoint.
The old three-export batch result still allocates its temporary output vectors, while bidi/layout arrays remain open;
this is HarfRust workspace evidence, not yet a complete allocation-free `text_update` or latency result.

The frame path now accepts complete editorial geometry in the same update as text. Rust borrows constraint, region,
exclusion, polygon-vertex, and inline-object records directly from the pinned request; it validates request limits,
finite ordered bounds, enum/reserved fields, identity and region ownership, vertex containment, text anchors after
pending mutations, and cross-section non-overlap before session mutation. A placement-independent fingerprint omits raw
vertex offsets, so repacking equal geometry does not manufacture invalidation. The compiled-Wasm proof commits one
rectangle region with an exclusion and inline object, then rejects a forged region reference without advancing the
published A/B revision. Layout does not consume these records yet, plans remain empty, and no latency claim is attached.
The optimized module is 856,832 raw / 318,999 gzip / 252,620 Brotli bytes, +9,018 / +3,190 / +2,991 over the shaping
workspace checkpoint. The still-TypeScript 25,515-glyph baseline measures 54.02/12.29/8.50/39.12 millisecond medians
for cold/font-size/width/text; it does not execute this geometry decoder and remains target evidence only.

Ordered font stacks now have cold Rust lifecycle operations independent from frame updates. A stack is nonempty,
duplicate-free, idempotent only for the same ordered handles, and retains its already registered shaping fonts until
stack disposal. A compiled-Wasm integration test uses the real baked Inter shaping payload to prove that a retained
member cannot be disposed and becomes disposable after the stack is released. Per-font technique/resource binding and
fallback shaping remain the next slices; this registry alone makes no layout or timing claim. The selected compact
vector registry produces an optimized 828,401 raw / 309,252 gzip / 244,402 Brotli-byte Wasm. A rejected generic tree-map
version measured 837,865 / 312,057 / 246,478, so cold linear lookup avoids 9,464 raw and 2,076 Brotli bytes.

Render-policy registration now retains one exact input-source record per F32/U32 program field. Numeric scope tags
select semantic, glyph, resource, or strike lanes; source order is fingerprinted, so changing a gather recipe under an
existing policy handle fails atomically. The compiler-derived policy request/program/input layouts are 44/64/4 bytes,
and compiled-Wasm tests pin their offsets, tags, conflict behavior, and malformed-input rejection. The optimized module
is 829,906 raw / 309,646 gzip / 244,790 Brotli bytes, a +1,505 / +394 / +388 contract cost.

Per-font render bindings now cross a separate cold compiler-mapped ABI and become owned Rust engine state. A binding
contains one technique/program variant, dense field-major glyph lanes, scalable or strictly ordered physical strikes,
dense strike×glyph resource addresses and lanes, and a resource directory with its own field lanes. This admits mixed
Bitmap/MSDF/Slug stacks without a universal union record or a technique repeated by `Text`. Selection is one bounded
nearest-strike pass with the lower exact tie, and MSDF/Slug take the one scalable-strike branch. Rust hostile-input tests
cover table shapes, overlap, reserved data, nonfinite floats, invalid resources, and selection; compiled Wasm uses the
real baked Inter glyph count to prove owned/idempotent registration, conflict, stack retention, and disposal. The
optimized module is 838,060 raw / 312,606 gzip / 246,732 Brotli bytes, +8,154 / +2,960 / +1,942 from the preceding
policy-source checkpoint. Policy-directed gather and frame use remain open, so this is a size/ownership result rather
than a layout-latency claim.

The policy gather now resolves each glyph's program-specific recipe across semantic, font-wide glyph, selected-strike,
and selected-resource fields into shared field slots, then lends those lanes directly to the existing plan compiler.
F32/U32 lanes use 16-byte-aligned four-record blocks with scalar tails; programs with fewer fields receive zeroes only
in unused shared slots, avoiding a built-in-technique union. `initialize()` reserves the policy-independent 32,768 ×
60-byte `PlanGlyph` arena: compiled Wasm memory moves from 1,245,184 to 3,342,336 bytes once and a repeated initializer
does not grow. Registering the one-F32-field integration policy then settles its exact lane from 3,342,336 to 3,538,944
bytes; identical registration does not grow. Rust gathers all four source scopes through a nonempty ordered plan and
pins exact payload bytes without changing capacity. The production frame invokes the same gather but still supplies no
layout glyphs. The optimized artifact is 845,580 raw / 315,285 gzip / 249,221 Brotli bytes, +7,520 / +2,679 / +2,489
from the binding checkpoint. Nonempty frame latency remains unclaimed.

The asynchronous frame transport has a test-only, byte-opaque ownership proof. A functional worker-side state machine
copies the selected Wasm publication once into a capacity-classed `ArrayBuffer`, transfers it with a numeric ownership
token, and charges the actual transferred capacity against explicit outstanding-count and outstanding-byte bounds. A
missing return therefore produces observable backpressure instead of unbounded allocation. Renderer retirement
transfers the same storage back to the worker; only a valid token/capacity pair can re-enter the bounded best-fit pool,
and an over-limit return becomes unreachable on the worker for worker-side collection. Tests cover detachment in both
directions, exact bytes, reuse, missing returns, forged and duplicate returns, failed sends, oversize rejection, and
worker-side discard. The transport never decodes the compiler-defined frame layout, and it remains unwired from the
shipping asynchronous TypeScript path until the Rust semantic tables exist.

The retained-engine kernel lab now fixes the first storage choices before semantic chunks land. It captures the real
25,515- and 100,602-glyph paragraph arrays, derives deterministic metric/advance lanes, and compares scalar,
compiler-vectorized, and selected hybrid artifacts through one direct-pointer interface. Node 24 and Chromium 149
produce identical horizontal, vertical, partial-tail, and four-byte-aligned hashes with no warm allocation path or
memory growth. Compiler-vectorized straight-line source owns record packing because hand-written shuffle packing did not
beat it. Explicit `i8x16` break/bidi masks and integer-exact `i64x2` summaries pass the 20% phase threshold; the large
workload selects ABI-private 64-cluster, 16-byte-aligned SoA chunks over 32 and 128. The production policy executor
retains the validated program, resolves store-buffer indices once at registration, rejects structurally invalid calls
before writes, and executes four records per explicit SIMD bytecode dispatch with scalar tails. The representative
17-operation program over 25,515 glyphs measures 1.174→0.428 ms p95 in Node and 1.113→0.438 ms in Chromium; the 100,602-
glyph comparison measures 4.499→1.698 ms and 4.350→1.750 ms. Compiler auto-vectorization did not improve policy
execution. All compared artifacts preserve exact output bytes and warm memory identity. Direct regions must belong to a
live host allocation before the executor can borrow retained engine state. Binaryen output contains the intended vector
instructions. The selected lab artifact adds 4,185 raw / 1,096 Brotli bytes over scalar. The standard production
`+simd128` artifact measures 725,572 raw / 269,260 gzip / 211,013 Brotli bytes: 530 raw and 633 gzip bytes smaller, but
62 Brotli bytes larger, than the 726,102 / 269,893 / 210,951 scalar build. SIMD is the default build with no runtime
dispatch; `PMNDRS_TEXT_SHAPER_SIMD=0` produces the scalar release valve, whose disassembly contains no SIMD instructions.
Boundary search, native SIMD, and the complete hot-update contribution remain explicit open measurements until those
engine stages exist.

Item 8.3 promotes `@pmndrs/text/raster/msdf` from an identity-only contract to the browser module and adds the isolated `@pmndrs/text/bakers/msdf/validate` entry. The standalone path layers the pinned Khronos validator, byte-identical Draft-04 schema, and semantic checks for reciprocal identity, descriptor-authenticated generation values, `planeUnitsPerEm = emSize`, view ownership, exact dense records, page bounds, embedded/external length and SHA-256 authentication, single-level linear RGBA8 KTX2 structure and data-format metadata, arithmetic limits, and a 256 MiB padded-base-array residency ceiling. Canonical Inter's ten legacy-default pages round-trip through both packaging forms; field deletion, record/page mutations, KTX2 and DFD corruption, missing/tampered external pages, and budget failures are named negative controls.

The runtime repeats no parallel wire-format implementation. Bitmap and MTSDF renderers plus both standalone validators consume the same dependency-light KTX2 and dense-record rules; only the standalone layer imports Khronos/Ajv. The renderers also share the lossless-atlas adapter, unit quad, parallel-array checks, and resolved-paint lookup. The MTSDF resource uploads only its authenticated base levels into one padded texture array, samples them bilinearly, sizes reconstruction with screen derivatives, and owns one material per logical array; disposal releases materials and textures transactionally.

One instanced batch family handles fill, outline, opacity, and translated hard shadow. The version-matched TSL graph reconstructs the fill edge from the RGB median and consumes alpha's true signed distance for effects. Shadow offsets expand each instance's geometric bounds and shift the same authenticated atlas sample, while clamped sampling and an explicit in-glyph mask prevent neighboring atlas cells from bleeding into the result. V0 outlines are bounded to half of the resource's authenticated full `pixelRange`; the exported `MTSDF_MAX_OUTLINE_ATLAS_PIXELS` is specifically the four-pixel limit for the default 64/8 configuration, while non-default resources derive their limit from their own authenticated range. A larger request fails instead of silently clipping. Paint updates reuse geometry and rewrite only owned instance attributes. The canonical Inter integration test decodes all ten real legacy-default pages, creates and repaints a live batch, verifies normalized effect attributes, and proves idempotent batch/resource cleanup without loading baker Wasm into the runtime graph. A real 32/4 artifact accepts its exact two-atlas-pixel boundary, normalizes it to half of that resource's field range, and rejects `2.0001`, distinguishing the configured limit from the exported default.

The checked SIMD comparison builds scalar, compiler-auto-vectorized, and explicit-four-lane kernels from isolated target directories. Every variant preserves all seven corrected native-oracle hashes and the complete Inter result of 2,915 generated glyphs, 22 non-rendering rejected slots, checksum `a5a6aa6e`, and composite SHA-256 `f6381c2f…eef6`; an instrumented warm seven-call corpus records seven request allocations, zero reallocations, and seven deallocations, one owned output copy occurs per call, and Wasm memory does not grow after the cold corpus. On Node 24, scalar measured 46.462 milliseconds for seven warm calls versus 47.079 milliseconds for explicit SIMD. Chromium 149 measured 47.6 versus 48.1 milliseconds. Explicit SIMD improves the complete Inter warm pass from 48.13 to 45.38 seconds, a 5.7% stress/offline win, and saves 297 Brotli bytes. Because the supported runtime default is bounded interactive baking and the target feature would require an alternate artifact, scalar remains the only shipped baker kernel; item 8.6 retains the explicit variant as evidence for phase-led optimization rather than exposing a toggle now. The repository-local Vitexec capture and full-font request emitter preserve the experiment as repeatable evidence rather than product complexity.

The Three-backed `Text` object is a real Three.js `Group` over the portable transaction contract rather than making Three part of that contract. It validates one complete candidate state before committing a patch, resolves every distinct root/span font through registry-scoped loader and HarfRust caches, shares decoded raster resources through `RasterRuntime`, and owns the resulting paragraph and raster batches as one generation. The first incomplete generation stays hidden; a later load keeps the prior complete generation visible until every raster target can swap atomically. React Suspense owns cold font, shaper, raster decode, and page preparation. The loader, shaper, and raster runtime additionally expose package-internal synchronous cache peeks: once those dependencies and layout-required pages are resident, `setProperties` shapes, lays out, plans paint, and stages synchronously without a consumer readiness wait. The committed generation remains live until `updateMatrixWorld` or `updateWorldMatrix` publishes the candidate before traversing raster children, and the React adapter invalidates its R3F root after changing core properties. Revision-scoped cancellation prevents stale work from publishing. Semantic no-op updates preserve an in-flight cold generation, abort signal, queued warm publication, and their original readiness observations instead of restarting work. Callback-only updates also retain that work and the latest `onLayout` observes the committed layout; after a genuine generation failure, the same semantic input explicitly retries rather than becoming permanently inert. Terminal font-disposal invalidation is distinct: a semantic no-op matching the invalidated generation's input preserves its rejected readiness state, while replacing that input may schedule recovery. The terminal state is scoped to the invalidated generation's own input, so an already-staged replacement remains recoverable if the superseded font is disposed; disposing that old font preserves the valid candidate and its readiness observation. Explicit disposal clears that saved terminal state along with pending and committed ownership. Every committed replacement releases its superseded font-disposal subscription while preserving a shared paragraph when only constraints changed. Paint-only updates stage through the same lifecycle while reusing the positioned layout, resident pages, and one glyph-to-span paint-index plan while text and normalized shaping ranges are unchanged. Validation and staging receive the same resolved `GlyphPaint` value, and repeated same-range updates reuse its `Uint16Array` index storage instead of rebuilding a code-unit map, palette-key map, and glyph-index array. One reusable Three color converter removes transient `Color` objects without weakening public color validation. Semantic no-op paint updates skip staging, width updates reuse paragraph shaping, shaping changes replace the paragraph, and disposal releases every owned batch and paragraph. MTSDF batches retain outline-width and shadow-offset structure per instance: color-only updates write only paint attributes, while structural paint changes take the full geometry/UV path. Direct scalar attribute writes avoid short temporary arrays on both paths. Runtime performance instrumentation does not ship in this package; the benchmark measures public scheduling externally. Integration evidence proves the previous layout remains live until object traversal, publication precedes retained-child traversal, React performs no consumer `ready` wait, same-range paint storage retains identity, asynchronous multi-font preparation aborts after a sibling failure, superseded-font disposal preserves a resident replacement, commit-contract faults cannot abort sibling traversal, and MTSDF color-only updates preserve origin/size/UV structure. A raw span font inherits the root raster definition but resolves its own font-local resource, preventing cross-font atlas reuse.

The `@pmndrs/text/react` export now provides the thin runtime described by the accepted API. It flattens nested text nodes into one UTF-16 string plus ordered inherited spans, rejects nested object/layout props and non-text children, creates one core object only after React 19 dependencies resolve, forwards that object through its ref, and reconciles ordinary R3F transforms separately from core text properties. The forbidden source `text` and `spans` props remain explicit `never` fields because R3F v10's wider intrinsic-element types would otherwise weaken that public boundary. Semantic feature and inline-paint comparison prevents fresh-but-equal React values from scheduling layout or glyph-buffer work; a fresh `onLayout` callback updates ownership without repainting. `useFont`, `.preload`, `.clear`, and `lazyRaster` reuse the same loader, shaper, and raster dependencies as the core. A deterministic microtask-delayed disposal distinguishes React Strict Mode's setup/cleanup/setup cycle without sleeps or timer cushions.

React Three Fiber 10.0.0-alpha.2 declares compatibility with the repository's React 19.2 and Three.js 0.185.1 pins, and repository code imports only `@react-three/fiber/webgpu`. Two narrow package patches own upstream prerelease gaps: the WebGPU entry no longer eagerly imports and auto-extends Three's browser-only Inspector during module evaluation, and test renderer 9.1.0 resolves both Three and R3F through their WebGPU entries. Upstream should make Inspector registration lazy and publish a v10-aware WebGPU test-renderer entry; no renderer implementation is forked. The Node reconciler harness installs a no-op animation request surface required by `frameloop: 'never'` and restores every global after the file, without timers or readiness polling. It proves resolved reconciliation, span flattening, identity retention, ref forwarding, update classes, invalid nesting, and disposal. The shared benchmark-registry target mounts public nested `<Text>` through a real R3F root backed by `WebGPURenderer`, matches pinned paragraph oracles across reflow, retains one core object, and submits a renderer frame. A live-browser Vitexec probe separately owns pending Suspense evidence; no application workaround is carried for the package test renderer's uncached-suspension behavior.

The Node host rejects distinct source files that collapse onto one output path before any bake begins, reports mutually exclusive phase timings, and retries the lazily loaded default bitmap baker after a failed initialization instead of pinning a rejected promise. These rules keep batch publication deterministic and make measured phase totals honest. The loader also refuses URI-addressed external raster entries without SHA-256 authentication; resolver-only delivery remains explicit and hash-optional.

The browser-safe `@pmndrs/text/raster/bitmap` subpath now owns bitmap generator/format constants, the exact `1..=1022` ppem V0 range, runtime validation of the non-empty static strike tuple, ascending canonical strike order, the complete generator-versioned descriptor, RFC 8785 serialization, and SHA-256 raster-key derivation. Equivalent strike sets therefore produce one identity regardless of caller order, while duplicate, non-integral, non-finite, non-positive, or out-of-range values fail before baking. The implementation uses Web Crypto and imports no Node built-ins.[^bitmap-identity]

The optional `@pmndrs/text/bakers/bitmap` subpath wraps a `no_std + alloc` Wasm generator through its Rust-generated JSON ABI and direct linear-memory shim. The contract declares its sole `env.pmndrs_text_bake_progress(completed, total)` import so a Worker can report a long synchronous bake without polling, timers, or main-thread work. Fontations/Skrifa owns font and outline interpretation; a small pen bridge feeds Zeno's maintained antialiased rasterizer. The dependency-light `raster-artifact` crate owns the dense 20-byte record writer, channel-agnostic shelf atlas, lossless R8/RGBA8 KTX2 encoding, GLB framing, content hashing, and packaging enums shared by bitmap and MTSDF bakers. Bitmap output remains byte-for-byte identical after the extraction. Artifact and page filenames bind both `shapingHash` and `rasterKey`, preventing two fonts with the same raster configuration from overwriting one another. Glyph masks are placed as they are rasterized instead of retaining a second full-face bitmap set, fixed buffers reserve fallibly, and the atlas-compatible ppem bound rejects structurally impossible requests before font work. The bridge decodes borrowed response metadata while the allocation is live and copies only returned artifact ranges. Canonical path remapping plus Binaryen 129.0.0 `-Oz` produces a hardened distributed module of 621,645 raw bytes. The shared artifact boundary does not enter rendering or shaping bundles.

The isolated `@pmndrs/text/bakers/bitmap/validate` entry reuses the core package's strict GLB framing and pinned Khronos validator, evaluates byte-identical Draft-04 bitmap/resource schemas, parses every declared page variant with `ktx-parse` 1.1.0, and enforces reciprocal identity, exact strikes, dense records, page bounds, KTX2 dimensions/format/levels, GPU-format/feature/quality mapping, external length/hash, arithmetic limits, and GPU budgets. Rust independently parses every native-test KTX2 through `ktx2` 0.5.0. Canonical Inter source/artifact/report/record/page identities, the fixed optimized Wasm size, embedded/external parity, 65,535-glyph boundaries, generated/published ABI identity, deterministic arbitrary-font Rust fuzz smoke, and fixed-seed artifact mutation fuzz smoke are executable fixtures. The source-remapped macOS arm64 and Ubuntu x64 modules have identical lengths and exact product output but different internal function-index order, so a release hash identifies the canonical builder output rather than pretending native code generators are cross-architecture byte canonicalizers.[^bitmap-baker]

The internal generic composer authenticates every returned artifact, checks reciprocal shaping/glyph/raster identity, retains external companions and pages, and embeds package-owned companion data without interpreting its semantics. Integer glTF buffer-view references are rebased through the shared naming convention, so multiple distinct extension types compose without a closed registry. Exact Inter goldens cover combined embedded, combined external, and the identity-neutral empty raster set; both the core and bitmap validators round-trip the combined bytes.

The Node-only `@pmndrs/text/bake` subpath closes roadmap item 2.4 around the item-2.1 TypeScript 7 AST/symbol discovery engine. `bakeFont` handles an explicit filesystem input/output pair and retains each selected raster package's exact option type. `bakeProject` finds composed tokens and statically visible core/React raw forms across TypeScript, TSX, JavaScript, and JSX; reduces immutable font/raster expressions; maps URL pathnames into canonical asset roots; groups identical sources; and dynamically imports only the exact verified raster-package ESM entry. It never executes application modules. One internal compiler adapter owns every unstable TypeScript import, project snapshot, symbol handle, alias, and declaration-resolution operation; an exact-version assertion and source-boundary test make compiler upgrades explicit.

The native-ESM `pmndrs-text-bake` command is a thin `bakeProject` adapter. The host writes exclusive same-directory temporary files, backs up existing regular-file targets, publishes only after every artifact is staged, and restores all earlier targets if a later rename fails; process termination during the multi-file swap is not claimed as a filesystem transaction. It rejects lexical and filesystem-identity input/output overlap, non-regular existing targets, and unsafe package-owned filenames, then cleans temporary or backup files after success, cancellation, and ordinary failure. Its plugin type guard proves each required property with `in` checks before reading it rather than asserting a partial module shape. Discovery reports are sorted by source file and lexical AST offset after concurrent analysis. Its report adds phase/total timing, before/after RSS, explicitly process-lifetime peak RSS, output paths and hashes, and raw/gzip/Brotli transport sizes to the authoritative core/raster/container byte report.[^node-host]

The public `FontLoader` and `FontRegistry` close item 3.1. They normalize every accepted input form into deterministic source/baked URLs, deduplicate request promises and validated shaping identities, and run the same hostile-input validator before registration. The large pinned Khronos/Ajv validation graph is cached behind a separate dynamic import: package import stays small, while the first actual registration still validates before publishing anything. Registration owns the bytes and retains the extracted reduced SFNT, glyph extents/availability, metrics, Unicode/source provenance, source candidates, and opaque raster directory required by later stages. Exact Inter fixtures compare those retained shaping views byte-for-byte with independent GLB validation. Embedded and external raster delivery variants merge by raster identity; companion attachment authenticates generic framing, ranges, reciprocal identity, and hashes before package-owned decoding. Streaming limits precede allocation, lifecycle handles are registry-scoped and invalidated on disposal, and a deterministic loader mutation corpus is part of the ordinary fuzz smoke.[^loader]

Source inputs remain baked-first by default: a string, URL, or `{ source }` request derives and probes the canonical sibling asset. `{ source, baked: null }` is the explicit source/runtime form and performs no sibling request; omission and `null` have distinct React preload identities. Runtime raster generation authenticates the returned package against the caller-derived raster key, shaping hash, glyph count, glyph-ID width, extension, and version before attaching it to a source-only registered font. Public arbitrary companion attachment still requires a directory reference, so the runtime seam does not weaken the hostile-asset boundary. Integration tests cover both the fetch decision and the complete core-only font → generated bitmap → decoded raster path.

Milestone 7.1 strengthens that lifecycle at the asynchronous raster publication boundary. If a decode completes after its runtime or owning font generation has been disposed, the decoded resource is released exactly once and the awaiting caller receives `AbortError`; it can never observe a resource that was already torn down. Named tests also prove stale raster handles, same-artifact re-registration with a fresh font handle, stale-handle shaping rejection, and independent shape-plan ownership. The packed tarball is exercised as the consumer artifact: every declared JavaScript and Wasm/JSON subpath resolves as ESM, build-only `.tsbuildinfo` state is excluded, the executable CLI answers through its installed path, the fallback runs as a real module Worker from an isolated packed Vite consumer, and CommonJS loading fails rather than discovering a hidden compatibility build.

Paragraph instances retain only the 32 most recently used entries in each measurement, line-plan, positioning, geometry, and final-layout cache. Each registered font likewise retains at most 64 least-recently-used HarfRust shape plans. Equivalent hot calls still reuse the same results, while adversarial constraint or language/feature variation has a fixed retention ceiling; updating or disposing a paragraph and disposing a font release the respective caches immediately. Paragraph preparation indexes cluster starts plus spacing/space prefix sums once, and positioned fragments use binary bounds over monotone HarfRust clusters instead of rescanning the paragraph or complete shaped run at every glyph boundary.

The `@pmndrs/text/runtime-bake` boundary closes item 3.2. It is dynamically imported only after a missing, invalid, or incompatible baked probe; creates one named module Worker; transfers provenance-preserving owned byte ranges; and runs the exact portable `@pmndrs/text-font-baker` wrapper plus its package-owned optimized Wasm. Offline and Worker hosts share dependency-light V0 descriptor, sole-artifact, successful-promise-cache, and owned-transfer rules while keeping filesystem and fetch behavior separate. The host owns a strict FIFO with one active bake: queued cancellation removes only that job, active cancellation replaces the Worker before resuming queued work, and the Worker entry independently serializes accepted messages. This bounds active CPU/Wasm memory without relying on async message ordering. The host predicate promises only the message fields it proves and consumes instead of overclaiming the complete baker report. A failed core initialization is retryable in both hosts. Canonical Inter fixtures execute the offline host and Worker entry, compare their complete artifacts byte-for-byte with the direct portable core, and then send the Worker result through loader provenance and hostile-input validation. The current independent size lanes report a 9,524-byte minified runtime host, 8,936-byte Worker JavaScript, and one 422,538-byte Wasm artifact; reviewed ceilings prevent heavy validation, Node, discovery, composition, or raster dependencies from entering those runtime graphs.

Milestone 3 closes with browser-executed parity and cancellation. The benchmark product's public loader target first hashes the real module-Worker artifact against the canonical Node artifact, validates and registers it, then runs the complete missing-sibling fallback in Chromium. Shared loads now reference-count consumers: one abort detaches safely, the final abort reaches fetch/stream/Worker work, and an otherwise-idle Worker terminates immediately after the final success, failure, or cancellation and recreates on demand without timers. Stale events from a terminated Worker cannot settle requests owned by its replacement. The explicit queue keeps one active post under concurrent integration tests; two live Chromium evidence runs preserved the canonical hash while a three-font burst completed in 30.8–32.0 ms versus 68.3–88.6 ms for three separately initialized sequential Workers. These observations are recorded without a timing threshold. Shaping-identity deduplication retains source bytes only when their source hash matches the registered primary provenance; alternate URLs remain hash-qualified candidates.

Milestone 4 closes the package-owned HarfRust runtime. The Rust 1.97.1 module uses HarfRust 0.12.0 and matching `read-fonts` 0.41.0 under `no_std + alloc`, exposes a compiler-described direct-memory C ABI, and keeps its allocator private. Build-only output publishes JSON for tools and typed TypeScript for the host without embedding either representation in Wasm. Its request registry owns zero-initialized, caller-sized buffers capped at 64 MiB and accepts only exact live pointer/length pairs, eliminating reconstructed raw ownership. The TypeScript bridge releases earlier allocations if a later registration copy fails. Canonical Inter contributes 147,192 SFNT bytes, 23,496 dense-extents bytes, and 368 availability bytes, or exactly 171,056 retained bytes. Registration is registry-scoped and idempotent; font/shaper disposal releases owned data and plans.

The four parallel Bitmap, shaper, MTSDF, and Slug ABI producers share the font-baker package's causal command-capture boundary. Their successful process exit is not enough to publish a contract; the build waits for stdout EOF before validating and freshness-checking the complete compiler-generated JSON.

One `shapeBatch` or `reshapeRanges` call packs validated UTF-16, run, feature, language, and range records through offsets from the generated ABI. It returns aligned borrowed SoA views with absolute UTF-16 clusters, glyph IDs, four positions, and mapped flags. Result layout and arena publication reserve fallibly before writing, so allocation exhaustion returns `RESULT_TOO_LARGE` rather than trapping after shaping. Every pinned Inter case passes bit-for-bit through the complete source → baker GLB → validator → registry extraction → Wasm chain for both calls; multi-run batching, plan reuse/disposal, surrogate boundaries, extents conversion, malformed records, and forged release metadata are executable. The fixed-seed raw-ABI mutation lane registers real validated Inter views first, so seed and surviving mutated requests reach HarfRust while malformed variants remain deterministic. The browser product batches all eight cases into one 97-glyph call with exact output hash `dc30c21c`. The hardened dynamic-Talc optimized module is 680,312 bytes raw, 253,568 bytes gzip, and 199,365 bytes Brotli; its JavaScript bridge is 32,778 bytes minified, 9,288 bytes gzip, and 8,257 bytes Brotli.

Roadmap item 5.1 adds synchronous paragraph preparation and measurement. Unicode 17 Script/Script_Extensions tables are generated deterministically from the pinned UCD package; `unicode-segmenter` supplies extended grapheme boundaries and `@cto.af/linebreak` supplies line-break opportunities. The ordinary suite executes all 766 official grapheme vectors and all 19,338 official line-break vectors from hash-pinned gzip fixtures. Prepared text is split only at grapheme-safe style/script boundaries, shaped once through the existing GLB-retained HarfRust path, copied immediately out of its borrowed result arena, and measured into legal break clusters with explicit baselines. Equivalent width constraints reuse frozen measurement objects and width-only reflow performs zero Wasm calls.

The canonical integration lane derives its natural width directly from the checked-in HarfRust glyph advances, then compares exact natural, 720 px, and 360 px measurements after source TTF → baker GLB → validator → registry → Wasm shaping. A second paragraph invalidates the shaper's borrowed arena before the first is measured, proving paragraph ownership rather than accidental view lifetime. Chromium repeats the same three measurements with deterministic hash `79874b9d`, one preparation shape, zero reflow calls, and no positioned glyph arrays.

Item 5.2 implements final positioned `ParagraphLayout`. It caches line plans independently from full constraint results, materializes paragraph-owned typed arrays only when requested, scales the exact HarfRust advances/offsets through retained GLB metrics, and emits parallel glyph and line SoA arrays in top-left/positive-down coordinates. Boundary-sensitive line fragments are gathered into one `reshapeRanges` call per changed width with full shaping context and line BOT/EOT flags. The canonical fixture fixes every glyph ID, UTF-16 cluster, flag, line range, baseline, advance, x/y placement, and normalized byte hash for natural, wide, and narrow layouts. The live Chromium aggregate is 3,786 bytes with hashes `bb15bbcc:4f111a3f:e8c0e9d5`, one broad shape, and two reshape calls total. Registry-scoped handles are validated separately and deliberately excluded from the portable hash.

Item 5.3 now has a conformant Unicode 17 bidi foundation. The package-owned shaper reuses `unicode-bidi` 0.3.18's maintained post–Unicode-15 UAX #9 algorithm under `no_std + alloc`, disables its Unicode 16 tables, and supplies generated Unicode 17 `Bidi_Class` and normalized paired-bracket data through the crate's custom data-source seam. The Rust-generated JSON ABI describes one direct-memory UTF-16 analysis call and borrowed SoA levels/classes/paragraph arrays; no browser ICU, WASI, binding generator, or ambient Unicode version participates. Hash-pinned official inputs cover `DerivedBidiClass.txt`, `BidiTest.txt`, and `BidiCharacterTest.txt`. Ordinary integration tests expand the generic corpus to all 770,241 requested paragraph-direction cases and execute all 91,707 character-specific cases, comparing paragraph level, every specified resolved level, and complete visual order. Wasm integration separately proves supplementary-plane code units and explicit/automatic paragraph directions.

Item 5.3 completes paragraph-level bidi and line policy. Preparation resolves nested span properties through the shared per-property cascade, which folds covering spans from the outermost inward in one boundary sweep, then intersects the resulting style segments with UAX #24 script and precomputed UAX #9 runs in one interval pass rather than rescanning every cross-product. It shapes each run in its resolved direction, copies borrowed analysis/shaping data, applies line-specific L1 reset and L2 visual ordering, and batches only unsafe changed boundaries. Boundary validation occurs once while copying/normalizing public input; normalized shaping and layout loops do not repeat generic object checks. A pinned Amiri 1.002 fixture covers joining, combining marks, lam-alef forms, Arabic numbers, and Latin: HarfRust over the source font equals HarfRust over the reduced SFNT extracted from the validated GLB exactly, and pinned HarfBuzz 13 independently agrees on every glyph field.

The generated `paragraph-bidi-layout-v0.json` contract owns complete SoA values for two mixed-direction Amiri layouts plus exact start/center/end/justify, clip, max-lines, and width/height ellipsis policies over Inter. Alignment-only and height-only compatible layouts share cached boundary shaping; every changed boundary is reported as one batched reshape. Ellipsizing a line ending in a mandatory break removes that control cluster before inserting the ellipsis, so the visible range never crosses into the hidden line. Fixed-seed fuzzing mutates Unicode text—including expected malformed UTF-16 rejection—axis modes, widths/heights, wrapping, alignment, truncation, letter spacing, line height, and direction twice, requiring finite, internally consistent, deterministic output.

The current-uikit-shaped fixture lives in the benchmark application rather than core. It derives `CustomLayouting` intrinsics, maps Yoga Undefined/AtMost/Exactly modes, ignores the numeric `NaN` payload of undefined axes, preserves uikit's 1/100-point upward rounding, skips measurement for two definite axes, subtracts padding/border from the authoritative resolved box, and translates content-local positions into centered host coordinates. Twenty repeated measurements materialize no glyph arrays. Text and shaping-policy updates dirty layout; paint and raster updates do not. Chromium 149 fixes the twelve-layout aggregate hash at `8859ef19:8d5b98a3:e492fa7d:19a5a03e:32f8722c:0691e0de:e492fa7d:0132eed7:0ddc10b5:0ddc10b5:00f73fd9:c1a7730c`, with 8,098 output bytes, four broad shapes, and five reshape crossings; the GPU Vitexec lane repeats it with WebGPU active.

Roadmap item 5.4 completes this same bake → retained-SFNT → HarfRust → paragraph path with Noto Sans CJK JP Regular 2.004 at the 65,535-glyph V0 limit. Thirteen Simplified/Traditional Chinese, Japanese, Korean, supplementary-Han, SVS/IVS, punctuation, ideographic-space, and mixed-script cases match source/reduced HarfRust and authenticated HarfBuzz 13 field-for-field. Contextual Script_Extensions avoid assigning shared punctuation arbitrarily; valid language tags survive the Wasm boundary, malformed tags fail explicitly, and natural-width overflow uses the same Float32 geometry as final layout.

Four public-pipeline paragraphs produce twelve exact natural/wide/narrow contracts with grapheme- and UTF-16-safe runs, clusters, and lines, one broad shape per paragraph, and zero reshapes for the fixed corpus. Fixed-seed CJK mutations cover malformed surrogates, variation selectors, language tags, and constraints twice. Node, Chromium 149, and GPU-enabled Vitexec report one composite hash, 10,622 output bytes, 1,539,372 retained bytes, and 4,587,520 Wasm-memory bytes. The item adds no raster paging, rendering, fallback, or vertical layout.

Roadmap item 6.1 completes the optional bitmap runtime module. It validates reciprocal font/raster identity, exact dense 20-byte records, absent-glyph sentinels, square strikes, embedded lossless linear R8 KTX2 dimensions and format, and page references before publishing a resource. Decode is transactional across pages and strikes, so any later failure disposes every `DataTexture` already created. Public `Text.rasterPixelRatio` defaults to one and is supplied explicitly by a rendering integration; it is raster-only state, so changing it rebuilds draw batches while reusing the paragraph and preserving logical CSS geometry. Bitmap targets the maximum run CSS size multiplied by that ratio, chooses the nearest strike with deterministic lower-strike ties, exposes the selected `strikePpem` on each zero-copy draw batch, uploads each page once, preserves glyph order through contiguous page runs, and emits instanced position, size, UV, and linear-color attributes. The core never reads browser DPR or installs input listeners. The baker records Zeno's integer mask placement in strike-pixel units; at native density every quad dimension therefore equals its atlas rectangle dimension. The shared TSL vertex graph snaps each projected edge to a physical framebuffer pixel before the same graph emits WGSL or fallback GLSL. The package-owned `@types/three` patch corrects `modelViewProjection` to its runtime `Node<'vec4'>` type and replaces the pathological node conditional tree; the compile fixture guards both upstream gaps. Independently fetched density strikes and external page residency remain explicitly deferred to Milestone 13.

Roadmap item 7.2 adds an optional presentation seam to this bitmap subpath without changing core `Text`, React, paragraph layout, or the generic raster contract. A snapshot copies rendered glyph identities and their currently displayed origins but retains no renderer resources. A transition matches font handle, glyph ID, UTF-16 cluster, exact font-size bits, and occurrence ordinal, then updates only the target batch's existing origin attributes. Unmatched shaping changes stay at their newly committed positions; sizes, UVs, paint, shaping, line breaking, and the authoritative `ParagraphLayout` remain discrete. Target-origin storage is lazy, per-frame progress updates are allocation-free, stale batches reject mutation, and the unchanged TSL vertex graph applies the final physical-pixel snap. Integration tests cover exact midpoint interpolation, mid-transition continuation, topology changes, invalid progress, idempotent finish, and disposal.

The canonical composed Inter fixture proves GLB → registry → public `Text` → HarfRust → paragraph layout → bitmap decode → GPU upload → instanced draw in the benchmark product. The five-lane benchmark ipsum produces 120 visible glyphs, zero missing glyphs, and one draw on both backends. Density fixtures carry 16 and 32 ppem strikes; exact-strike rendering keeps public geometry at 16 CSS px while selecting 16 device pixels at 1× and 32 device pixels at 2×. A record-level Rust invariant proves atlas and native plane dimensions are identical. The benchmark independently CPU-composes decoded atlas texels at snapped placements and requires every normalized GPU byte to match for both the full frame and a resized, intentionally clipped frame; WebGPU and WebGL2 produce the same full-frame hash at each DPR. Bitmap accepts fill and opacity but rejects outline and shadow through the optional raster paint-validation seam instead of silently discarding them. Hinted grayscale and four-phase coverage packing remain measured research, while LCD/ClearType rendering is an explicit non-goal. The [roadmap](../roadmap/roadmap.md) remains the only completion ledger.

The five-line, 120-glyph text above is the bounded conformance specimen. The separate live benchmark ipsum exceeds 1,000 characters and renders 1,150 glyphs through the same one-draw public `Text` path.

Paragraph layout is tiered by what each product depends on, so a change enters at its own tier instead of rebuilding the paragraph. Text analysis follows the text and its base direction, shaping adds the fonts, spans, and style topology, metrics add font size and spacing, the line plan adds the content box, and geometry adds alignment. A retained layout session holds the prepared paragraph across updates, so a content-box change never enters preparation and reuses the caches the paragraph already keeps, while font fallback reads shaped glyph identity rather than laying the paragraph out to locate `.notdef`. Positioning writes its output into typed arrays sized from the shaped runs and resolves a text offset to a cluster through a table built once per preparation, replacing a lower-bound search that ran twice at every cluster boundary of every glyph. Both position axes accumulate in double precision and narrow once, because alignment and justification read an axis back after storing it.

`pnpm scripts run text:layout-benchmark` measures that path. It reports a median of warmed repetitions for each invalidation class separately, with the relative standard deviation beside it, because the classes invalidate different tiers and an average across them hides whichever one is slow. Boundary reshaping is gone: it requested the whole run as shaping context, which is the context the retained shape was produced with, so it returned the glyphs it already held on roughly every line of every layout. Measured on an identical workload against the pre-tiering commit at 25,515 glyphs, a reflow lays out in 8.12 ms against 110.40 ms, a resize in 11.98 ms against 103.54 ms, and a text edit in 31.85 ms against 109.66 ms, with the pinned layout hashes unchanged. Phase attribution came from opt-in spans that have since been removed once their evidence was recorded; reinstating them is a diagnostic change, not a shipped feature.

## Package scripts

| Script  | Purpose                                                                                                                                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build` | Check generated Unicode data, derive portable ABI contracts, emit ESM/declarations, compile the no-WASI Bitmap, MTSDF, Slug, and shaper Wasm modules, and optimize them with pinned Binaryen.                              |
| `check` | Run the complete test, main and Slug/TSL type-check, lint, and format gates.                                                                                                                                               |
| `test`  | Build once, then run compile-only public API fixtures, Rust/Wasm unit and integration gates, MTSDF evidence, Unicode 17 conformance, package/registration/golden tests, malformed artifacts, and deterministic fuzz smoke. |

Run `pnpm scripts list text` from the workspace root to discover Unicode, fixture, bake-evidence, and explicit MTSDF diagnostic workflows.

The [API contract](../planning/api-shapes.md) remains authoritative for public behavior; this concept explains the package that implements its current loading, baking, shaping, and paragraph surfaces. The [canonical roadmap](../roadmap/roadmap.md) alone owns program-wide completion status.

[^bitmap-identity]: Raster-specific descriptor fields remain owned by this subpath and never enter a closed core union.

[^bitmap-baker]: Artifact generation, validation, and generic composition are complete; GPU resource creation is deliberately deferred to the renderer milestone.

[^node-host]: The Node host trusts selected installed baker code but authenticates every returned artifact; hostile baked assets are independently revalidated at the loader boundary.

[^loader]: Raster-package schema and payload semantics remain in each module's `decode`; the generic registry validates only package-neutral container and reciprocal identity invariants.

[^slug-contract]: Slug V0 identity is fixed independently from the optional baker and renderer modules.

[^slug-validator]: Standalone validation authenticates embedded and external resource forms before runtime ownership begins.

[^slug-baker]: The Rust baker owns outline conversion, exact curve/band packing, and deterministic package construction.

[^slug-baker-host]: The TypeScript host owns direct-memory transfer, progress, errors, and cleanup without entering the renderer graph.

[^slug-runtime]: The public runtime subpath owns resource upload, batching, paint admission, and lifetime.

[^slug-shaders]: The internal shader directory preserves the copied analytic algorithm while adapting its storage and node graph to the package contract and installed Three.js release.

[^slug-outline-research]: The planning concept preserves the rejected mechanism, measurements, external implementation survey, uncertainty, and go/no-go criteria.

[^typescript-go-node-variance]: The upstream issue identifies stable type ordering and variance computation over Three's augmented `Node<TNodeType>` as the runaway checker path.

[^definitelytyped-node-extras]: The upstream patch replaces the nested conditional with a keyed lookup map while retaining the same extension intersections.
