---
type: Implementation Plan
title: Superseded font and engine ownership plan
description: Historical ownership plan superseded by the root GlyphConfig, handle, and root integration contract.
tags: [fonts, engine, renderer, ownership, lifecycle, memory, disposal]
status: deprecated
sources:
  - id: current-loader
    resource: ../../../packages/glyph/src/loader.ts
    title: Current font loader and registry
  - id: current-loaded-font
    resource: ../../../packages/glyph/src/loaded-font.ts
    title: Current engine-bound loaded font
  - id: current-engine
    resource: ../../../packages/glyph/src/glyph-engine.ts
    title: Current Glyph engine
  - id: current-handle-state
    resource: ../../../packages/glyph/src/internal/handle-state.ts
    title: Current internal handle state and Wasm command transport
  - id: current-paragraph
    resource: ../../../packages/glyph/src/paragraph.ts
    title: Current renderer-free measurement path
  - id: current-font-contract
    resource: ../../../packages/glyph/src/font.ts
    title: Current declarative font and bake-discovery contract
  - id: current-bake-discovery
    resource: ../../../packages/glyph/src/discovery.ts
    title: Current static defineFont discovery
  - id: current-three-engine
    resource: ../../../packages/glyph/src/three/handle.ts
    title: Current Three.js configured handle
  - id: renderer-guide
    resource: ../guides/renderer-integration.md
    title: Current renderer integration guide
  - id: decisions
    resource: decision-register.md
    title: Architectural decision register
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-28T20:10:29Z'
---

# Font, GlyphEngine, backend, render-planner, and render-target ownership

> **Historical record — superseded.** This document preserves the engine-driving design that preceded D-306 and D-308.
> Integrators now use root `GlyphConfig`/`defineGlyphConfig`, Codec `encode`, the internal trusted projection to a borrowed
> `CommandBufferView` with ordered `DisplayList`, `GlyphRenderer.decode`, `glyph.handle`, and anonymous or named roots.
> See the [current renderer integration guide](../guides/renderer-integration.md). The backend, planner, target, and public
> `/core` examples below are not current API guidance.

This plan separates an immutable font asset from the mutable engine, backend, render planner, and GPU registrations that consume
it. It also makes the one relationship the renderer protocol already depends on explicit: one render planner advances one
acceptance frontier. The implementation must preserve the renderer-neutral policy and plan, the borrowed A/B publication
path, the owned worker path, and call-time validation.

This is the accepted target shape being implemented atomically. The current executable surface is documented in
[the renderer integration guide](../guides/renderer-integration.md); the dated codemod is the authoritative canary migration map.

## Why this correction exists

The pre-correction API conflated three different assets:

1. `FontRegistry` owns validated GLB data, raster attachments, cache identity, and mutable registered handles.
2. The former `TextRuntime.loadFont()` registered shaping bytes into one Wasm shaper and returned a runtime-bound `LoadedFont`.
3. The former renderer host compiled another font binding and realized device resources from that loaded value.

That shape admits relationships the implementation cannot honor:

- the former `TextRuntimeOptions.registry` permitted two runtimes to share mutable `RegisteredFont` and `RegisteredRaster`
  handles even though disposal was not reference-counted per runtime;
- the former raw `new TextEngineHost(textRuntimeShaper(runtime))` path lost the lifetime edge from host to runtime;
- the former raw session accepted caller-authored session, policy, revision, and acknowledgment fields without owning an
  abstract renderer acceptance target.
- the loader copies the complete input, slices the GLB BIN chunk, copies source bytes, and returns copied raster views.
  These copies hide ownership instead of expressing it.
- `LoadedFont` exposed separately disposable runtime-bound pieces. A consumer could invalidate a value another live layer
  still depends on.

The correction is ownership, not recovery. Malformed authored input still throws at the public call that receives it. A
malformed plan remains an engine defect. Renderer realization failure keeps the prior accepted renderer state because the
candidate did not commit; it never restores stale content or retries an unchanged frame.

## Target ownership graph

```mermaid
flowchart LR
  subgraph Assets[Application assets]
    F[Font\nimmutable GLB backing]
    FS[FontStack value\nordered Font references]
    F --> FS
  end

  subgraph Engine[Glyph engine domain]
    R[GlyphEngine\none Wasm shaper]
    H[GlyphBackend\none integration owner]
    RB[EngineFontBinding\nprivate shaping registration]
    HB[BackendFontBinding\nportable policy/resources]
    S[RenderPlanner\none desired-text set]
    R -->|owns and disposes| H
    R -->|deduplicates| RB
    H -->|owns| HB
    H -->|owns| S
    F -->|bindFont| RB
    RB --> HB
    FS -->|bind stack| HB
  end

  subgraph Renderer[Renderer-owned domain]
    T[PlanTarget\none acceptance frontier]
    P[Renderer-private realization pool\none per GPUDevice or WebGL context]
    C[Canvas, texture, or\nlockstep target group]
    S -->|publishes| T
    HB -->|portable payload lease| P
    T -->|prepare + commit| P
    P -->|draws| C
    T -->|accepts after commit| S
  end
```

The arrows define lifetime direction:

- a `Font` does not own a Glyph engine and can outlive or bind across engines;
- a Glyph engine owns every backend created through `glyphEngine.createBackend()`, so engine disposal closes backends and
  render planners before Wasm;
- a backend is permanently attached to one engine and cannot rebind;
- a render planner is permanently attached to one backend, one policy, and one abstract target;
- Canvas, WebGPU, Three.js, render passes, and GPU resources remain renderer-owned;
- a renderer may pool one immutable realization across render planners using the same authenticated payload and renderer
  resource domain.

### Backend, target, and device are different boundaries

`GlyphBackend` and `RenderPlanTarget` are `/core` integrator concepts. A GPU device is not:

- the backend owns one engine attachment, portable policy registrations, portable font-binding leases, IDs, and render planners;
  it owns no Canvas, `GPUDevice`, `GPUCanvasContext`, WebGL context, texture, buffer, bind group, material, or pipeline;
- the target is a renderer-implemented acceptance callback owned by one render planner; it tells core whether one candidate was
  actually committed so core can advance retention safely;
- a renderer-private realization pool owns physical resources and keys them by its own resource domain plus authenticated
  payload identity and variant. Core never constructs, stores, or names that pool or device.

The backend's “font binding” is therefore an engine binding, not a GPU bind group. It installs compact policy bytes and a
portable resource resolver. Each target asks its renderer pool to realize those payloads for the target's device/context.
Two targets may share the backend binding while sharing or duplicating physical resources according to their renderer domain.

| Renderer topology                                   | Backend and render-planner shape                                                               | Physical resource rule                                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Two canvases configured with one WebGPU `GPUDevice` | One backend; normally one render planner per independently advancing canvas                    | One renderer pool may share buffers, textures, samplers, bind groups, and pipelines; each canvas supplies its own current presentation texture. |
| Two canvases using different WebGPU devices         | One backend remains valid when they share a portable policy ABI; use independent plans/targets | Separate realization pools; no GPU object crosses devices.                                                                                      |
| Two WebGL canvases/contexts                         | One backend is still valid when policy ownership is shared                                     | Separate context-local realization pools; WebGL objects do not cross contexts.                                                                  |
| One canvas switching device/context                 | Keep or replace the render planner according to acceptance ownership                           | Discard the old physical pool and checkpoint that render planner against the replacement.                                                       |

A canvas alone is not the backend boundary. Create another backend when renderer integration, policy ownership, plugin trust,
or teardown must be independent. Creating one backend per canvas is valid, but duplicates backend registrations and is not
required for resource safety.

## Font memory and lease model

```mermaid
flowchart TD
  U[User Font lease] --> B[Canonical Font backing\none owned GLB ArrayBuffer]
  HB1[Backend binding lease] --> B
  HB2[Another backend binding lease] --> B
  D1[GPU-device realization lease] --> B
  B --> V1[Shaping table views]
  B --> V2[Raster metadata views]
  B --> V3[Embedded texture/geometry views]
  RB1[Engine A shaping registration\none Wasm-owned copy] --> V1
  RB2[Engine B shaping registration\none Wasm-owned copy] --> V1
```

The minimum resident representation is:

- one canonical CPU GLB backing per live `Font` asset;
- offset/length views into that backing for embedded shaping and raster payloads, plus one owned backing for each
  authenticated external raster artifact the selected technique actually resolves;
- one shaping copy per live engine that has bound the font, because distinct Wasm memories cannot share ordinary linear
  memory;
- one renderer realization per `(GPUDevice, authenticated payload identity, variant)`, shared by render planners through leases;
- no font-payload copy for a backend, render planner, canvas, or render pass.

`loadFont({ baked: URL }, technique)` may adopt the `ArrayBuffer` returned by its fetch because Glyph owns that response body.
Caller-supplied bytes need an explicit ownership mode:

```ts
type FontBytesInput =
  | { readonly bytes: ArrayBufferView; readonly ownership?: 'copy' }
  | { readonly bytes: ArrayBufferView; readonly ownership: 'transfer' };
```

The safe default establishes immutable ownership with one copy. The transfer form requires a non-shared view spanning its
entire `ArrayBuffer`; it throws for a subview or `SharedArrayBuffer`, then detaches the caller's buffer and adopts it as the
canonical backing. After that boundary, parsing and resource access use internal views rather than whole-BIN or
per-resource copies. Root application APIs do not expose a mutable view into the canonical backing. `/core` payload
leases expose borrowed upload bytes only to the trusted integrator that owns that lease; mutating them is a contract
violation, and the package revalidates their authenticated identity at every realm boundary.

## Implemented API shape

### Application surface

Applications load portable assets without constructing an engine:

```ts
import { createFontStack, loadFont } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';

const bitmap32 = { technique: bitmap, options: { strikes: [32] } };
const inter = await loadFont({ baked: new URL('./inter.glb', import.meta.url) }, bitmap32);
const emoji = await loadFont({ baked: new URL('./emoji.glb', import.meta.url) }, bitmap32);
const ui = createFontStack(inter, emoji);
```

`Font<Technique>` is immutable application vocabulary. One handle selects one raster technique, preserving the existing
compile-time relationship between technique, options, decoded data, backend policy, and renderer shader. A multi-raster load
returns a typed tuple of Font handles that share the same canonical backing; it does not create one ambiguous Font whose
rendering technique must be chosen later. Loading does not register with an engine or realize a renderer resource. Root
`Font` does not publish decoded payload bytes or a mutable `data` view; technique-owned decoded data is available only to
the `/core` portable font compiler under the binding lease.

```ts
interface Font<Technique extends AnyRasterTechnique> {
  readonly metrics: FontMetrics;
  readonly glyphCount: number;
  readonly technique: Technique;
  readonly disposed: boolean;
  dispose(): void;
}

interface FontStack<Technique extends AnyRasterTechnique> {
  readonly fonts: readonly [Font<Technique>, ...Font<Technique>[]];
}

type TechniqueOfFont<Value> = Value extends Font<infer Technique> ? Technique : never;
declare function createFontStack<
  const Primary extends Font<AnyRasterTechnique>,
  const Fallback extends readonly Font<AnyRasterTechnique>[],
>(primary: Primary, ...fallback: Fallback): FontStack<TechniqueOfFont<Primary | Fallback[number]>>;

// Existing names remain the AOT discovery contract; source/baked objects gain explicit byte forms.
interface BakedFontSource {
  readonly baked: string | URL | FontBytesInput;
  readonly source?: never;
}

interface FontSourceOverride {
  readonly source: string | URL | FontBytesInput;
  readonly baked?: string | URL | FontBytesInput | null;
}

type LoadFontInput =
  | FontInput
  | {
      readonly source: string | URL | FontBytesInput;
      readonly runtimeBake: RuntimeFontBake;
      readonly unicodeRanges?: readonly RuntimeBakeUnicodeRange[];
    };

type FontRasterInputs = readonly [
  RasterTechniqueInput<AnyRasterTechnique>,
  ...RasterTechniqueInput<AnyRasterTechnique>[],
];

type TechniqueOfRasterInput<Input> = Input extends AnyRasterTechnique
  ? Input
  : Input extends { readonly technique: infer Technique }
    ? Technique
    : never;

type Fonts<Rasters extends FontRasterInputs> = {
  readonly [Index in keyof Rasters]: Font<TechniqueOfRasterInput<Rasters[Index]>>;
};
```

`font.dispose()` closes the user lease and prevents new bindings. Existing engine, backend, stack, and device leases remain
valid until their owners release them. The canonical backing is released only after the final lease ends. A `FontStack`
value does not itself retain; the text or bound stack that adopts it does.

`createFontStack()` preserves the existing ordered union-technique inference and rejects a duplicate Font object at the
call. It no longer checks same-engine membership because Fonts have no engine. `backend.bindFontStack()` validates that its
policy supports every member technique before registering any member, then acquires the stack atomically. One text may
therefore fall back across several Fonts or techniques without exposing IDs or weakening draw order; compatible members
share renderer resources and batching where their program/geometry/resource keys permit it.

Renderer packages may expose a convenience `loadFont()` that delegates to the root loader and chooses default raster
requirements. They do not parse, cache, or bake fonts independently.

The package has no strong global font cache. Applications that want URL/content deduplication create an explicit root
`FontLibrary`, use `library.loadFont()`, and dispose that library's cache lease independently of every returned Font user
lease. Every load returns an independent Font lease over shared backing state. Disposing the library never disposes a Font
still retained by its user or an engine.

```ts
interface FontLibraryOptions {
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string | URL;
  readonly development?: boolean;
  readonly runtimeBake?: RuntimeFontBake;
  readonly onDiagnostic?: (diagnostic: FontLoadDiagnostic) => void;
  readonly onWarning?: (diagnostic: FontLoadDiagnostic) => void;
  readonly maxArtifactBytes?: number;
  readonly maxBufferViews?: number;
  readonly maxRasters?: number;
  readonly maximumEntries?: number;
}

interface FontLoadOptions {
  readonly signal?: AbortSignal;
}

interface FontLibrary {
  readonly disposed: boolean;
  loadFont<Technique extends AnyRasterTechnique>(
    token: FontToken<Technique>,
    options?: FontLoadOptions,
  ): Promise<Font<Technique>>;
  loadFont<Technique extends AnyRasterTechnique>(
    input: LoadFontInput,
    raster: RasterTechniqueInput<Technique>,
    options?: FontLoadOptions,
  ): Promise<Font<Technique>>;
  loadFont<const Rasters extends FontRasterInputs>(
    input: LoadFontInput,
    rasters: Rasters,
    options?: FontLoadOptions,
  ): Promise<Fonts<Rasters>>;
  clear<Technique extends AnyRasterTechnique>(token: FontToken<Technique>): void;
  clear<Technique extends AnyRasterTechnique>(input: LoadFontInput, raster: RasterTechniqueInput<Technique>): void;
  clear(input: LoadFontInput, rasters: FontRasterInputs): void;
  dispose(): void;
}

declare function createFontLibrary(options?: FontLibraryOptions): FontLibrary;
declare function loadFont<Technique extends AnyRasterTechnique>(
  token: FontToken<Technique>,
  options?: FontLoadOptions,
): Promise<Font<Technique>>;
declare function loadFont<Technique extends AnyRasterTechnique>(
  input: LoadFontInput,
  raster: RasterTechniqueInput<Technique>,
  options?: FontLoadOptions,
): Promise<Font<Technique>>;
declare function loadFont<const Rasters extends FontRasterInputs>(
  input: LoadFontInput,
  rasters: Rasters,
  options?: FontLoadOptions,
): Promise<Fonts<Rasters>>;
```

The top-level `loadFont()` is the no-library convenience path. It coalesces identical in-flight requests and removes that
entry when the request settles; it retains no resolved Font or backing. The package derives request identity from the
normalized input URL or byte-source object/range, technique identity, canonical options, Unicode ranges, and baker
identity. Callers never author a cache key or numeric ID. `FontLibrary` retains resolved backing explicitly. Every load
preserves the existing `AbortSignal` boundary.

`LoadFontInput` preserves both input modes. A baked input validates an existing GLB. A source input carries the
existing runtime-baker function, Unicode ranges, and all requested raster technique/options. Baking completes one immutable
artifact before `Font` publication; the source buffer is released after the artifact is owned, and late raster attachment
is not supported. The existing `FontInput`, `FontToken`, and `defineFont(input, raster)` names and source/baked
discriminants survive as the static `glyph bake` discovery anchor. `BakedFontSource.baked` and
`FontSourceOverride.source`/`baked` widen to explicit `FontBytesInput`; a bare byte object is never sniffed or guessed.
`loadFont(defineFont(...))` is the direct engine-loading form. There is no second type named `FontInput`, and the
discovery traversal is migrated and tested in the same commit as any source-file move.
External raster artifacts remain separately authenticated owned backings rather than copies of the primary GLB.

### Entry-point ownership audit

The root remains the canonical barrel for renderer-neutral application and technique-provider vocabulary. Applications
may import directly from it even when an integration also names those types. An integration re-exports a root name only
when that name appears in its own public signatures; it does not mirror the root barrel.

| Entry                                            | Target contents                                                                                                                                                                                                                        | Migration disposition                                                                                                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@pmndrs/glyph`                                  | `Font`, `FontStack`, `loadFont`, `FontLibrary`, `createFontStack`, `txt`, `span`, formatted-text, paint, layout/measurement, font-feature, raster-technique, raster-resource, and baker contracts plus errors an application can catch | Canonical home. Keep a useful barrel; replace engine-bound loader/registry vocabulary with immutable Font/library vocabulary.                                                        |
| `@pmndrs/glyph/core`                             | `createGlyphEngine`, `GlyphEngine`, `GlyphBackend`, target/render planner types, policy authoring, portable compilation, plan readers, and integrator-only errors                                                                      | Engine-driving surface. It imports root types but does not re-export them. Raw frame mutation/acknowledgment compilers and application-invisible dynamic IDs become package-private. |
| `@pmndrs/glyph/three` and `/react`               | Three/R3F objects, materials, loaders, hooks, props, and integration errors                                                                                                                                                            | Re-export only root names actually present in those signatures, such as `Font`/`FontStack` where needed. Root remains their canonical home.                                          |
| raster, shader, baker, and runtime-bake subpaths | technique-owned side effects, shader-language modules, baker modules, and explicit runtime-bake tooling                                                                                                                                | Remain explicit tree-shakable capability entries; they do not become alternate homes for root application vocabulary.                                                                |

The current and target entry groups have these explicit dispositions:

| API group                                                                                                                                          | Disposition                                                                                                   | Reason                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Font`, `FontStack`, `FontMetrics`, `FontInput`, `FontToken`, `defineFont`, `loadFont`, `createFontStack`, `FontLibrary`, and load errors/options  | Keep or replace in place at root                                                                              | These are portable assets, declarative bake inputs, and failures an application encounters. `defineFont` remains the static baker anchor.                                                                                                   |
| Root `txt`, `span`, formatted text, paint, paragraph properties, measurements, layouts, placements, and carets                                     | Keep at root                                                                                                  | Applications author or receive these values without implementing a renderer.                                                                                                                                                                |
| Current `/core` `Paragraph`, `ParagraphOptions`, and `ParagraphUpdate`                                                                             | Move their application-facing forms to root and add async `createParagraph`; make direct construction private | Detached measurement is application vocabulary even though its engine render planner remains private.                                                                                                                                       |
| raster-technique, raster-resource, coverage, feature, and baker contracts                                                                          | Keep at root or their existing explicit capability subpath                                                    | Technique and baker providers author them; they are renderer neutral. Shader-language implementations remain explicit subpaths.                                                                                                             |
| `FontRegistry`, `RegisteredFont`, `RegisteredRaster`, `LoadedFont`, engine-bound `FontLoader`, and their mutable handles/options                   | Withdraw or replace                                                                                           | They expose mutable registration internals rather than portable application assets.                                                                                                                                                         |
| `GlyphEngine`, `createGlyphEngine`, backend/render planner/plan/policy types, policy/wire IDs, and portable realization readers                    | Move or remain in `/core`                                                                                     | Only an integration constructs or drives them. Root types may appear in their signatures, but `/core` does not re-export the root barrel.                                                                                                   |
| `textShaperAbi`, raw frame compilers, raw shaper constructors, and dynamic registration layouts                                                    | Withdraw from JavaScript declarations                                                                         | Renderer integrations consume retained backend/render planner and plan-reader contracts. Alternate-language bindings implement the versioned ABI from its generated schema and Rust contract rather than depending on JavaScript internals. |
| `/core` `acquireFontSelectionForRuntime`, `assertFontSelectionForRuntime`, `concreteFonts`, `observeLoadedFontDispose`, and `releaseFontSelection` | Withdraw from declarations and make any surviving mechanics package-private                                   | They expose the engine-bound `LoadedFont` model being removed and are not integrator contracts.                                                                                                                                             |
| `FontHandle`, `RasterHandle`, `FontKey`, and `RasterKey`                                                                                           | Withdraw unless a surviving root output still exposes one                                                     | Dynamic registration identity is package-managed. Output identities such as `FontSlot` or `LocalGlyphId` remain root only when an application-visible layout type names them.                                                               |

The packed declaration test is the authority: root and `/core` export-name sets are disjoint, and an integration may
re-export a root name only when its own declaration signatures reference that name. This preserves convenient barrel
imports without turning `/three` or `/react` into shadow copies of the root API.

The root migration withdraws `LoadedFont`, mutable `FontRegistry`, engine-bound `FontLoader`, `RegisteredFont`/
`RegisteredRaster`, and raw engine handles that no application API accepts or returns. `FontLoadError` and equivalent
application-observable errors remain at root. Before removing any remaining name, search declarations and packed consumers
across the whole repository and classify whether applications encounter it, technique providers author it, or only an
integrator constructs it. The final declaration audit records every surviving root export and its owner; no name survives
only because it was historically present.

Root `Paragraph` remains renderer-independent, but a ready synchronous paragraph cannot be constructed before its Wasm
measurement engine exists. Replace the public constructor with async `createParagraph(options)`. The factory acquires a
package-private, per-realm measurement service and returns a ready `Paragraph`; its measurement and layout methods remain
synchronous. The service uses the same engine/backend machinery internally, owns a target-less measurement render planner that
cannot publish, and releases its font binding and service lease when the Paragraph disposes. The final Paragraph in a
realm releases the measurement engine; a later `createParagraph()` may initialize another one. `loadFont()` itself stays
engine-independent, and neither `GlyphEngine` nor a measurement target enters the root signature.

### Integrator surface

#### Approved lifecycle vocabulary migration

The public lifecycle is `createGlyphEngine() → GlyphEngine → createBackend() → GlyphBackend → createPlanner() →
RenderPlanner → createText() → RetainedText`. The first two owners use the package vocabulary; the lower two describe the
retained text lifecycle. A render planner is not a draw batch or typographic run: one publication may contain many resource,
storage, primitive, and draw batches.

| Final name               | Contract                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `GlyphEngine`            | Owns one Wasm shaping/layout domain, engine-local font registrations, child backends, and the borrowed-plan gate. |
| `GlyphBackend`           | Owns one renderer integration's policy, font and renderer bindings, IDs, and render planners.                     |
| `RenderPlanner`          | Owns desired text, one target, capacities, revisions, publications, and one acceptance frontier.                  |
| `RetainedText`           | Owns one mutable desired text instance inside a render planner.                                                   |
| `PlanTransport`          | Package-private request/result arena owner used by the render-planner implementation and direct ABI tests.        |
| policy authoring `scope` | Tracks DSL value provenance; it is not a render planner and never enters the wire protocol.                       |

The pre-alpha Rust/Wasm ABI changes in the same commit. Export keys use `createPlanner`, `reservePlanner`,
`disposePlanner`, and `plannerCount`; frame fields use `plannerId`; status names use
`plannerConflict` and `plannerMissing`; the default capacity is `defaultPlannerTextCapacity`. The Rust ABI
contract generates the TypeScript declaration, so no session-named compatibility aliases survive.

TypeScript, TSX, MTS, JavaScript, and MJS use the dated symbol-aware `ts-morph` migration in
`.agents/skills/codemod/codemods/2026-08-28-text-engine-vocabulary/`. It is the authoritative old-to-new map. It rewrites
wire-contract identifiers at proven call sites while leaving unrelated persisted strings unchanged; the two old JavaScript
status-code strings are listed as explicit manual migrations. Generated ABI artifacts are regenerated, never edited.

The implementation also creates a repository-local codemod skill and a dated canary migration archive. Each archived
codemod is the authoritative migration recipe: it records removed or renamed exports, methods, types, and import paths;
deterministic ts-morph transforms; before/after call sites; ownership and behavior invariants; ambiguity guidance; and
verification gates. The agent applies the automatic transforms and uses the same recipe for call sites that require
judgment. Later canary changes add another ordered codemod instead of rewriting history. Public migration prose is rendered
from or links to those recipes rather than copying a second rename table that can drift.

#### Branded ID authoring

After the lifecycle migration, the numeric ID API becomes one callable namespace:

```ts
const applicationId = id('studio/selection');
const bufferId = id.buffer('three/stable-glyph');
const techniqueWireId = id.technique(msdf);
const programWireId = id.program(msdf, 'three', 'shadow');
const resourceWireId = id.resource(atlasResource);
```

`id()` returns a domainless brand. Each method selects a required canonical domain and a distinct numeric brand; there is
no optional domain argument. Standalone `techniqueId`, `programId`, and `resourceId` exports are removed. Every lowering
records canonical provenance and rejects collisions in the shared rendering domain used by all backends that can feed one
target/device. Backends do not salt portable IDs: equal semantic identities remain equal across backends, while different
identities that collide cannot be installed together. Backend-generated policy, binding, stack, render-planner, material,
and transform handles remain automatic and absent from ordinary user input.

#### Font-request simplification

The repository inventory found three different authoring shapes for one operation:

| path                   | pre-simplification input                                                  | behavior preserved                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root and `FontLibrary` | `{ input, raster }` or `{ input, rasters }`                               | exact technique inference, tuple-preserving multi-raster results, synchronous validation, cancellation, byte ownership, in-flight coalescing, and explicit library caching |
| static discovery       | `defineFont(input, raster)` followed by `loadFont(token)`                 | build-time discovery and the token's exact input/technique types                                                                                                           |
| React                  | `useFont(input, technique, options?)` plus matching `preload` and `clear` | R3F cache identity, typed technique options, and deterministic font-lease release                                                                                          |
| Three `Loader` adapter | one `{ input, raster, signal? }` value                                    | conformance to Three's one-request `Loader.load(request, callbacks)` method                                                                                                |

Root loading adopts the already-established positional shape. `loadFont(input, raster, options?)` returns one typed
`Font`; `loadFont(input, rasters, options?)` returns a position-preserving tuple when `rasters` is a nonempty tuple.
`FontLibrary.loadFont()` and `FontLibrary.clear()` use the same input-plus-raster arguments. `loadFont(token)` and the
matching library operations remain valid for `defineFont()` discovery tokens. The public `FontRequest`,
`MultiRasterFontRequest`, and request-only raster tuple names are removed; they existed only to wrap arguments that every
caller immediately unpacked.

The Three override keeps a Three-owned one-object request because that cardinality belongs to `THREE.Loader`, not to the
portable font API. Its `raster` accepts the same `RasterTechniqueInput` as `defineFont`, while its separate multi-raster
method uses the root positional form. React's user surface is already canonical and does not change. Internal prepared
requests may remain structured values, but they are not exported and never make applications author cache keys or IDs.

`GlyphEngine` and `GlyphBackend` are both `/core` integrator vocabulary. Applications load and retain `Font` values
through the root package or an integration's convenience loader; they never need an engine merely to hold a font:

```ts
import { createGlyphEngine } from '@pmndrs/glyph/core';

const glyphEngine = await createGlyphEngine();
const backend = glyphEngine.createBackend({
  integration: 'my-webgpu-renderer',
});

const rendererPolicy: BackendPolicyFactory = (ids) => ({
  capabilitySets: [rendererCapabilities],
  programs: createRendererPrograms(ids),
});
const policy = backend.installPolicy(rendererPolicy);
const stackBinding = backend.bindFontStack(ui);
```

The method states the lifetime direction in the only surface where either object is public: the engine constructs, claims,
and later disposes the backend before returning it. `createGlyphEngine` and `GlyphEngine` move from root to `/core`, where
`GlyphBackend` already lives; first-party renderer entries construct them internally. There is no raw-shaper constructor,
detached backend factory, public owner parameter, or backend rebind operation.

`backend.bindFont(font)` performs two deduplicated steps:

1. the engine obtains or creates one private shaping registration for the font;
2. the backend resolves the registered portable program for `font.technique`, gives its `compileFont` callback a
   package-private technique-data reader plus `retain()`, then registers only the returned binding bytes and validated
   constrained portable resources needed by its policy domain.

The compiler callback never receives a Three resource or a public mutable `Font.data` object. The technique/provider owns
the portable program and shader subpaths; the backend owns registration and the renderer owns realization.

Repeated `bindFont()` calls are idempotent in underlying state but return independent leases. Disposing one caller's
lease does not invalidate another caller, a bound stack, or a device realization. `bindFontStack()` calls that same
operation for each portable Font, retains those leases in declared fallback order, and returns one opaque backend-owned
token; callers do not author numeric handles.

The shared API never calls physical resource creation “font realization.” `bindFont()` is the core registration action.
An integration that eagerly creates or reuses its renderer-owned font resource set may call that helper `initFont()`;
`allocateFont…` is reserved for a lower-level operation that always creates fresh storage. Lazy per-plan pools need no
font-level method at all. No public `realizeFont()` name is introduced.

The target-bound public render planner does not expose `update(request)` and never accepts a caller-authored plan, policy,
revision, or acknowledgment field. It exposes `planner.createText()`, `text.update()`, `text.dispose()`, and
`planner.publish()`. Core allocates every paragraph/style/flow/region ID, validates
each option at the call that receives it, coalesces desired mutations, inserts the render planner/policy/cursor fields, and
compiles the one wire update internally. Three and the neutral example wrap these exact handles rather than compiling a
second request shape. The old raw frame compiler remains package-internal test/fuzz infrastructure; alternate language
bindings implement the documented ABI rather than preserving a second JavaScript ownership model.

`RetainedTextOptions` is the renderer-neutral authored model, not a geometry or material API. Existing root `TextInput`,
`ParagraphContentBox`, `ParagraphStyle`, and `GlyphPaintInput` cover formatted spans, columns, ordinary layout, paint,
`order`, and `rasterPixelRatio`. Flow regions, exclusions, and inline objects currently exist only as raw `/core` frame
records, so the retained surface strips every engine-owned ID/revision/index and replaces material/resource numbers with
backend-issued opaque bindings. The region's renderer-owned transform-table slot is preserved through
`BackendTransformBinding`: core encodes its compact wire index, while a target resolves that index back to the binding and
the integration's private transform object. Async candidates pre-resolve those bindings for the source endpoint, which
maps them to its renderer-defined transport keys just as it builds the payload manifest. A backend stack binding similarly
replaces every font/stack number. The implementation
must expose every currently supported authored frame field through these ID-free retained inputs before privatizing
`compilePlannerFrameUpdate`; no feature may disappear into an unreachable ABI field.

Policy installation takes the complete renderer-owned `PolicyDescriptor`, not one `PolicyProgram`. RenderPlanner creation
receives the selected descriptor-owned `PolicyCapabilitySet` object and validated maximum limits; the backend verifies set
membership and creates the D-281 owner-bound wire selection internally. `publish()` maps named semantic-view and
compositing options to internal masks and derives exact per-frame counts from retained state. Callers never author a
capability ID, raw semantic mask, frame revision, or acknowledgment.

### Planner and target surface

One render planner owns desired text and exactly one acceptance target. The private measurement-only exception
is defined below. A target is abstract protocol behavior, not a Canvas or GPU object:

```ts
type RenderPlanTarget = PlanTarget | AsyncPlanTarget;

declare const planOriginBrand: unique symbol;
interface PlanOrigin {
  readonly [planOriginBrand]: true;
}

type RenderPlanTableName = 'resources' | 'buffers' | 'patches' | 'primitives' | 'draws' | 'retirements' | 'diagnostics';

interface PortablePayloadLease {
  readonly payload: PortableResource;
  readonly disposed: boolean;
  dispose(): void;
}

interface ResolvedPlanPayload {
  readonly referenceId: ResourceHandle;
  readonly payload: PortableResource;
}

interface ResolvedPlanTransform {
  readonly transformIndex: number;
  readonly binding: BackendTransformBinding;
}

interface RenderPlanReader {
  table(name: RenderPlanTableName): RenderPlanTable;
  record(table: RenderPlanTable, index: number): number;
  u8(offset: number): number;
  u16(offset: number): number;
  u32(offset: number): number;
  f32(offset: number): number;
  bytes(offset: number, byteLength: number): Uint8Array;
}

interface BorrowedRenderPlan extends RenderPlanReader {
  readonly delivery: 'borrowed';
}

interface OwnedRenderPlan extends RenderPlanReader {
  readonly delivery: 'owned';
}

interface PlanCandidate {
  readonly origin: PlanOrigin;
  readonly plan: BorrowedRenderPlan;
  acquirePayload(referenceId: ResourceHandle): PortablePayloadLease;
  resolveTransform(transformIndex: number): BackendTransformBinding;
}

interface AsyncPlanCandidate {
  readonly origin: PlanOrigin;
  readonly plan: OwnedRenderPlan;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly payloads: readonly ResolvedPlanPayload[];
  readonly transforms: readonly ResolvedPlanTransform[];
}

interface PlanTargetControl {
  requestCheckpoint(): void;
}

interface PlanTarget {
  readonly delivery: 'borrowed';
  accept(candidate: PlanCandidate, signal: AbortSignal): PlanAcceptance;
  dispose(): void;
}

interface AsyncPlanTarget {
  readonly delivery: 'owned';
  readonly maximumPlanBytes: number;
  accept(candidate: AsyncPlanCandidate, signal: AbortSignal): Promise<AsyncPlanTargetResult>;
  dispose(): void;
}

interface BackendFontStackBinding {
  readonly disposed: boolean;
  dispose(): void;
}

interface BackendFontBinding<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly disposed: boolean;
  dispose(): void;
}

interface BackendMaterialBinding {
  readonly disposed: boolean;
  dispose(): void;
}

interface BackendResourceBinding {
  readonly disposed: boolean;
  dispose(): void;
}

interface BackendTransformBinding {
  readonly disposed: boolean;
  dispose(): void;
}

interface BackendPolicy {
  readonly disposed: boolean;
  dispose(): void;
}

type RetainedTextRegionInput = Omit<
  PlannerRegion,
  'id' | 'geometryRevision' | 'transformIndex' | 'exclusionStart' | 'exclusionCount'
> & {
  readonly transform: BackendTransformBinding;
};

type RetainedTextExclusionInput = Omit<PlannerExclusion, 'id' | 'regionId' | 'geometryRevision'>;

interface RetainedTextFlowRegionInput {
  readonly region: RetainedTextRegionInput;
  readonly exclusions?: readonly RetainedTextExclusionInput[];
}

interface RetainedTextFlowInput {
  readonly regions: readonly RetainedTextFlowRegionInput[];
}

type RetainedTextInlineObjectInput = Omit<
  PlannerInlineObject,
  'paragraphId' | 'id' | 'contentRevision' | 'materialId' | 'resourceId' | 'resourceGeneration'
> & {
  readonly material: BackendMaterialBinding;
  readonly resource: BackendResourceBinding;
};

interface RenderPlannerLimits {
  readonly maxParagraphs: number;
  readonly maxClusters: number;
  readonly maxLines: number;
  readonly maxRegions: number;
  readonly maxExclusions: number;
  readonly maxInlineObjects: number;
  readonly maxSlotsPerBand: number;
  readonly maxOutputBytes: number;
}

interface RetainedTextOptions {
  readonly font: BackendFontStackBinding;
  readonly text: TextInput;
  readonly order?: number;
  readonly rasterPixelRatio?: number;
  readonly contentBox?: ParagraphContentBox;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly flow?: RetainedTextFlowInput;
  readonly inlineObjects?: readonly RetainedTextInlineObjectInput[];
}

type RetainedTextUpdate = Partial<Omit<RetainedTextOptions, 'font'>> & {
  readonly font?: BackendFontStackBinding;
};

type AsyncPlanTargetResult =
  | { readonly accepted: true; readonly returnedBytes: Uint8Array<ArrayBuffer> }
  | {
      readonly accepted: false;
      readonly error: unknown;
      readonly returnedBytes?: Uint8Array<ArrayBuffer>;
    };

interface RetainedText {
  readonly disposed: boolean;
  update(update: RetainedTextUpdate): void;
  layout(): ParagraphLayoutSummary;
  glyphs(): ParagraphLayoutInspection;
  dispose(): void;
}

interface RenderPlannerPublishOptions {
  readonly semanticViews?: 'none' | 'measurement' | 'layout-inspection' | 'all';
  readonly compositing?: 'ordered' | 'independent';
}

interface RenderPlanner {
  createText(options: RetainedTextOptions): RetainedText;
  publish(options?: RenderPlannerPublishOptions): PlanAcceptance;
  dispose(): void;
}

interface AsyncRenderPlanner {
  createText(options: RetainedTextOptions): RetainedText;
  publish(options?: RenderPlannerPublishOptions): Promise<PlanAcceptance>;
  dispose(): void;
}

type RenderPlannerFor<Target extends RenderPlanTarget> = Target extends AsyncPlanTarget
  ? AsyncRenderPlanner
  : RenderPlanner;

interface RenderPlannerOptions<Target extends RenderPlanTarget> {
  readonly policy: BackendPolicy;
  readonly capabilitySet?: PolicyCapabilitySet;
  readonly target: (control: PlanTargetControl) => Target;
  readonly limits: RenderPlannerLimits;
  readonly requestCapacity: number;
  readonly resultCapacity: number;
  readonly textCapacity: number;
}

interface GlyphBackend {
  installPolicy(factory: BackendPolicyFactory): BackendPolicy;
  bindFont<Technique extends AnyRasterTechnique>(font: Font<Technique>): BackendFontBinding<Technique>;
  bindFontStack<Technique extends AnyRasterTechnique>(stack: FontStack<Technique>): BackendFontStackBinding;
  createMaterialBinding(): BackendMaterialBinding;
  createResourceBinding(): BackendResourceBinding;
  createTransformBinding(): BackendTransformBinding;
  createPlanner<Target extends RenderPlanTarget>(options: RenderPlannerOptions<Target>): RenderPlannerFor<Target>;
  dispose(): void;
}

interface GlyphEngine {
  readonly disposed: boolean;
  createBackend(options: GlyphBackendOptions): GlyphBackend;
  dispose(): void;
}

interface GlyphBackendOptions {
  /** Stable diagnostic namespace; never a wire ID or lookup key. */
  readonly integration: string;
}

declare class RenderPlannerDisposedError extends Error {}
declare class RenderPlannerBackpressureError extends Error {}
declare class PlanTransportCapacityError extends Error {}
declare class PlanTransportError extends Error {}

const planner = backend.createPlanner({
  policy,
  capabilitySet: rendererCapabilities,
  target: (control) =>
    renderer.createPlanTarget({
      control,
      delivery: 'borrowed',
    }),
  limits: rendererLimits,
  requestCapacity: PLAN_REQUEST_BYTES,
  resultCapacity: PLAN_RESULT_BYTES,
  textCapacity: PLAN_TEXT_BYTES,
});

const title = planner.createText({
  font: stackBinding,
  text: txt`Hello ${span({ color: '#f80' })`Glyph`}`,
  constraints: { width: { mode: 'at-most', size: 480 } },
});
title.update({ constraints: { width: { mode: 'at-most', size: 360 } } });
const metrics = title.measure();
const positionedGlyphs = title.glyphs();
planner.publish();

title.dispose();
planner.dispose();
stackBinding.dispose();
policy.dispose();
backend.dispose();
glyphEngine.dispose();
```

`createText()` and `text.update()` snapshot bindings and reject malformed authored values at those calls, but do not
shape, measure, or serialize a trial frame. `measure()` and `glyphs()` are explicit synchronous queries: asking before a
publish pays for the paragraph-scoped Wasm query once and caches its copied result until the next semantic mutation.
`publish()` remains the ordinary coalescing boundary and performs one frame encode for every dirty text together.
`PolicyDescriptor` is complete at installation; publish accepts no untyped policy-parameter bytes because the current
policy ABI defines no parameter schema that could validate or consume them.

Publishing with `semanticViews: 'measurement'` or `'layout-inspection'` asks the same frame transaction to emit copied
semantic sidecars and fills those same caches before target acceptance. This keeps a renderer's ordinary path to a
current local bounding box at one Wasm hop: Three may install the returned bounds for culling before GPU submission.
Mutation invalidates the box immediately, and an explicit pre-render bounding-box request measures lazily rather than
returning stale data. Two Wasm hops are required only when the caller demands metrics before publish or feeds those
metrics back into constraints or positioning that must alter the pending plan. The early query leaves Rust's existing
speculative transaction available: a matching publish adopts its prepared paragraph instead of shaping twice, and a
geometry-only mismatch reuses the matching semantic prefix before recomputing flow and positioning. The default remains
`semanticViews: 'none'`; sidecar overhead is measured separately from both no-op publication and paragraph-scoped early
measurement.

In this example, `renderer` already owns its surface and physical device/context. Neither enters `createPlanner()` or any
other core signature.

The render planner constructs one opaque `PlanTargetControl` and passes it to the target factory. This resolves the lifecycle
cycle without a raw setter or manual registration: the renderer's device pool retains controls for its attached live
targets, calls `control.requestCheckpoint()` on loss, and releases the control when the target/render planner disposes. A target
factory is invoked exactly once, and a returned target cannot attach to another render planner.

The backend validates its active state, policy, and capacities before invoking the factory. If the factory throws, it
invalidates the new control before rethrowing. It then validates the returned target object and its literal `delivery`
value at engine before allocating a Wasm render planner. A private `WeakSet` claims each new target before allocation and records
it forever. Returning an already claimed target throws without disposing it, because it belongs to the first render planner. Any
later validation or Wasm-allocation failure invalidates the new control and disposes the newly claimed target exactly once
before rethrowing. Type inference maps the factory's delivery discriminant to the
only valid synchronous or asynchronous render planner return type; callers do not select that type independently, and engine
validation prevents an `any` cast or widened discriminant from selecting the wrong call path.

An `AsyncPlanTarget` reports the exact transfer-pool ceiling as `maximumPlanBytes`. `createPlanner()` requires it to be a
positive safe integer at least as large as `limits.maxOutputBytes`; otherwise it disposes the newly claimed target and
throws before Wasm allocation. Result-capacity growth can therefore never produce a valid plan that the attached target
is permanently unable to transfer.

Every target has an idempotent `dispose()`. RenderPlanner disposal aborts pending acceptance, calls `target.dispose()` so the
renderer detaches the control from its pool, invalidates the control, and then releases render planner state. A later
`requestCheckpoint()` throws; that call-time failure identifies a renderer pool that violated the detach contract and is
not converted into a recoverable render result. Device-loss fan-out iterates a stable control snapshot, records a stale
control defect, continues signaling every live sibling, then reports the integration defect after fan-out; one bad entry
cannot strand unrelated render planners.

RenderPlanner capacities are validated initial reservations, not permanent public identities. Request growth happens before the
Wasm call. If the engine returns its non-publishing `resultTooLarge` capacity header, core may reserve the exact reported
size and execute that same authored transaction once more; no plan, revision, acceptance cursor, or renderer state existed
to retry. A second sizing failure is an engine defect and throws. This bounded arena negotiation is distinct from retrying
an unchanged renderer rejection, which remains forbidden. Public `reserve()` and raw capacity-result handling stay hidden.

`PlanTarget` is the ordinary zero-copy path. It must validate, prepare, enqueue, commit, and answer before its callback
returns and before any backend call can grow the shared Wasm memory. GPU execution may complete later; renderer acceptance is
the synchronous CPU transaction that publishes renderer state after submission. `AsyncPlanTarget` is only for a genuinely
deferred boundary such as a worker round trip. It receives one package-created copy and returns a Promise. The engine
coordinates one Wasm-memory-wide borrow gate across every attached backend, because a call through any sibling backend/render planner
can grow memory and expire every view into the old buffer. Re-entering any call on that engine from a `PlanTarget`
callback throws before crossing into Wasm.

For WebGPU, acceptance is not delayed on `popErrorScope()`: the target completes all synchronous schema/limit checks,
uses already-ready shader/pipeline implementations, creates or updates resources, submits commands, and atomically swaps
its CPU-visible live state before returning. `device.lost`, uncaptured validation errors, or an asynchronously reported
scope error are renderer/device faults after submission; the renderer marks that resource domain lost, keeps unrelated
render planners correct, rebuilds, and requests a checkpoint. They cannot retroactively turn a returned acceptance into a
rejection. The neutral example's current awaited error-scope path must migrate to this rule and test both synchronous
rejection-before-commit and asynchronous device-fault recovery.

`PlanCandidate.plan` is a package-created lease-bound read-only facade over the current Wasm A/B result slot and expires
when `accept()` returns. It exposes no `bind()`/`bindBytes()` mutator. Every later read through a retained facade throws
`PlanPublicationExpiredError`; expiry is not merely prose and cannot silently read a newer slot. The reusable
`RenderPlanView` remains available for an integrator to bind independently owned boundary bytes, but it is not
the object passed as a borrowed candidate.
`AsyncPlanCandidate.bytes` is one package-created, full-span, non-shared `ArrayBuffer` view; its `plan` is bound to those
same owned bytes. The async target may transfer `bytes.buffer`, which detaches both views in the source realm until the
buffer returns. Before calling the target, the render planner walks the copied plan and resolves every referenced portable payload
into `payloads`; no resolver callback survives the yield. No public constructor allows a caller to forge either candidate
mode.

This is exactly one plan-byte copy. The source publication is a range inside engine-owned Wasm memory: transferring its
backing would detach the engine's whole memory, and a shared Wasm backing is not transferable. The package therefore
copies only the publication range into an exact-size standalone buffer. The existing bounded transfer pool is adapted
from power-of-two/best-fit capacities to exact-byte-length buckets: `minimumCapacity` is removed, and it may reuse only a
returned allocation whose `byteLength` equals the next publication length. Backpressure, pooled-count, and pooled-byte
limits remain; oversized allocations are rejected. Thus the candidate view always spans its complete backing, repeated stable-size frames still
reuse allocations, and no helper can silently copy an oversized subview. The target must pass that buffer in the `postMessage`
transfer list; structured-cloning it or copying it again is a contract violation. The receiving endpoint transfers the same
allocation back. A successful result requires `returnedBytes`; the render planner validates its full-span backing and original
publication identity, consumes the acceptance, and may recycle the allocation for a later async copy. A rejected result
returns the allocation when the endpoint still owns it; worker termination may lose that transport allocation without
affecting Wasm storage or the previous acceptance fence.

Returned exact-size buffers enter a least-recently-returned queue. The pool evicts from the oldest end until both
`maximumPooledBuffers` and `maximumPooledBytes` hold; an allocation used for one unusual frame cannot pin capacity ahead of
hot sizes forever. Package tests drive stable-size and deliberately variable-size traces through the pool and assert
full-span ownership, bounded pooled bytes, deterministic LRU eviction, allocation/pool-hit/discard counters, and no more
allocations than an exact-size fresh-buffer baseline. A worker microbenchmark records copy, transfer, return, allocation,
and hit-rate evidence separately from shaping/render-plan benchmarks.

`acquirePayload()` returns an independent disposable backing lease owned by the synchronous target. It transfers that
lease into its realization pool or disposes it before returning. For async delivery, the render planner acquires and privately
holds source-realm leases, exposes only their identity/payload borrows in `AsyncPlanCandidate.payloads`, and releases them
when the transaction settles or aborts; the receiving realm acquires its own cache lease after digest validation. No
candidate-scoped resolver closure or source lease survives a worker yield accidentally.

A render planner permits at most one asynchronous publication/acceptance transaction in flight. A second update while an
`AsyncPlanTarget` is pending throws at that call. Ordinary `PlanTarget` acceptance completes within `publish()`.
Independent render planners may progress concurrently, subject to the renderer's own device-pool synchronization.

Transfer-pool outcomes are call-bound and never retried automatically. Bounded shared-pool backpressure returns
`{ accepted: false, error: RenderPlannerBackpressureError }` with the cursor unchanged; the caller may publish the still-dirty
desired state later. An exact-size publication above the configured maximum rejects `publish()` with
`PlanTransportCapacityError` before the target is called. Sender failure, failure to detach, malformed return, and
lost correlation reject `publish()` with `PlanTransportError`; they invalidate that transaction and leave the prior
cursor authoritative. A detached buffer may be lost, but no hidden retry or second copy occurs.

The target answers one of two call-bound results:

```ts
type PlanAcceptance = { readonly accepted: true } | { readonly accepted: false; readonly error: unknown };
```

Acceptance advances only after the renderer transaction commits. Rejection leaves the previous renderer state and
acceptance cursor unchanged. Recoverable renderer transitions such as device replacement use each attached target's
`PlanTargetControl.requestCheckpoint()` after rebuilding the device pool. Invalid plan bytes are never a recoverable target
result; they throw as an implementation defect at the decoding call.

Checkpoint requests advance a private target-control generation rather than marking authored text dirty. The next
publication presents a zero consumed-plan cursor, causing Rust to publish its complete render planner without manufacturing
paragraph/style mutations or exceeding authoring limits. Acceptance satisfies only the generation captured before target
delivery, so a device-loss request raised during `accept()` survives for the following publication.

An `AsyncPlanTarget` that crosses a worker remains one target with two renderer-owned endpoints. Its source endpoint
resolves every resource referenced by the candidate and transfers an envelope containing the package-created plan buffer,
a transaction token, and a manifest from backend-scoped `referenceId` to package-authenticated payload digest, descriptor
metadata, and either dedicated payload-transfer bytes or a renderer-defined fetch key. A bare view into canonical Font
backing is never placed in a transfer list: on a receiving-cache miss the source copies only that payload range into a
standalone transfer buffer, then transfers the copy. This payload copy is distinct from the exactly-one plan copy and is
required only when the other realm cannot reuse or fetch authenticated content. The receiving endpoint validates the plan
with `RenderPlanView.bindBytes()` and validates every supplied payload against that manifest before realization.
A cache hit may omit payload bytes only when the receiving endpoint already holds the same authenticated digest and
descriptor.

Within one handle, `RasterResourceId` is the authoritative renderer-realization key: equal IDs mean equal format, schema
role, companion set, metadata, and bytes. The handle retains the first immutable payload and reference-counts later uses
without hashing or comparing its bytes. Cross-realm FontFace transfer carries content-addressed artifact dependencies; the
receiving registry reuses those inputs and the selected raster decoder reconstructs its authored resource IDs. After commit
or rejection, the receiving endpoint transfers the command buffer back with the transaction token and result. The source
endpoint correlates that return to its one pending candidate, reclaims or recycles the returned buffer, and resolves
`accept()`. Only an accepted result advances the renderer cursor and makes older engine storage eligible for retirement.
Same-realm ownership provenance is not serialized.

Disposing a render planner aborts an in-flight async target signal, invalidates that transaction, settles the public `publish()`
promise with `RenderPlannerDisposedError` from a core-owned abort race, and ignores every late answer. Correct worker
targets also settle rejection from deterministic `error`, `messageerror`, and worker-exit events; no timer or retry is a
correctness mechanism. A target that otherwise never settles is an integration bug, but disposal is always a bounded
escape that does not depend on target cooperation. A late `{ accepted: true }` can never advance a disposed render planner's
cursor. If the worker terminates without returning the buffer, the transport copy is lost but no engine or renderer
acceptance fence advances; the previous accepted publication remains authoritative.

The worker transport has one explicit ownership state machine:

| State              | Buffer owner                                 | Permitted action                                                                                                         |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| candidate created  | source `AsyncPlanTarget`                     | build the manifest from resolved payloads, install abort/response correlation, then transfer                             |
| request in flight  | receiving endpoint                           | validate bytes and manifest, realize resources, prepare and commit renderer state                                        |
| response in flight | source endpoint after transfer completes     | validate the transaction/result envelope and recover the returned buffer                                                 |
| settled accepted   | render planner async-copy pool               | return the buffer and `{ accepted: true }`; render planner validates both, then advances its cursor and retirement fence |
| settled rejected   | render planner async-copy pool when returned | return `{ accepted: false, error }` and the buffer when available; render planner keeps its previous cursor              |

The transaction token is renderer-private correlation state created inside the target; it is not a render planner ID, wire ID,
or acknowledgment supplied by the application. A malformed response throws as an integration defect. Worker termination,
device loss, or an explicit renderer rejection settles as not accepted and leaves the previous renderer publication live.
Portable resource payloads are separate from the plan transport: an endpoint must never detach the canonical Font backing.
It reuses a receiving-realm digest cache, fetches by an authenticated renderer key, or makes one dedicated transfer copy
for a missing payload.

## Application update loop

```mermaid
sequenceDiagram
  participant App
  participant RenderPlanner
  participant Wasm as Engine/Wasm
  participant Target
  participant Device as Renderer device

  App->>RenderPlanner: createText / updateText / removeText
  App->>RenderPlanner: publish()
  RenderPlanner->>Wasm: validated mutations + last accepted cursor
  Wasm-->>RenderPlanner: borrowed A/B publication
  RenderPlanner->>Target: borrowed callback or owned copy
  Target->>Device: prepare resources, buffers, geometry, draws
  Device-->>Target: commit succeeds or rejects
  alt committed
    Target-->>RenderPlanner: accepted
    RenderPlanner->>RenderPlanner: advance opaque acceptance cursor
  else rejected
    Target-->>RenderPlanner: renderer error
    RenderPlanner->>RenderPlanner: retain prior accepted cursor
  end
```

Text creation and mutation are part of the render-planner lifecycle, not incidental render work. The common integration
owns stable text handles and offers operations such as `createText()`, `text.update()`, and `text.dispose()`. Those calls
update desired state. The next render planner publication emits only changed paragraph, text, style, constraint, flow, and region
sections. Removing a text emits its paragraph removal before recycling any internal ID.

`text.measure()` and `text.glyphs()` synchronously answer from the current desired state, including mutations not yet
published. They require only the engine, backend bindings, policy, and authored text inputs already retained by the render planner.
They never call the plan target, realize renderer resources, inspect a Canvas/device, traverse a scene, or read a world
matrix. The query does not commit desired state or advance the render-plan acceptance cursor; the next `publish()` still
submits the same authored mutation. `measure()` returns allocation-light metrics, while `glyphs()` explicitly pays for and
returns a caller-owned positioned inspection. Integrations such as Three delegate detached `Text.measure()` to this path;
scene attachment and matrices affect later placement only.

### Measurement-only Paragraph path

The exactly-one-target rule applies to render planners. A retained text in such a render planner may synchronously query its
current desired layout without invoking that target. Root `createParagraph()` uses a separate package-private
measurement planner that has no target, no acceptance cursor, no draw publication, and only the synchronous
`measureParagraph` query. It is not exported from `/core`, cannot be converted into a render planner, and shares the same
validated retained text-input implementation so Paragraph does not regain the raw frame compiler. Three may query
measurement through its ordinary render planner before publishing, but the query does not advance its plan revision or
acceptance frontier.

```mermaid
sequenceDiagram
  participant App
  participant Factory as createParagraph
  participant Service as Private measurement service
  participant Wasm as Engine/Wasm

  App->>Factory: await createParagraph({ font, text, ... })
  Factory->>Service: acquire realm service + bind Font
  Service->>Wasm: create target-less measurement planner
  Factory-->>App: ready Paragraph
  App->>Service: paragraph.measure(constraints) or glyphs(constraints)
  Service->>Wasm: validated retained update + measureParagraph
  Wasm-->>App: owned metrics/layout value
  App->>Service: paragraph.dispose()
  Service->>Service: release binding; dispose engine at final Paragraph
```

## Deployment topologies

### One application, one canvas

Use one engine, one renderer backend, and one render planner when all text shares one ordering and acceptance frontier. The renderer
owns one device pool and one target for the canvas.

```mermaid
flowchart LR
  F[Font assets] --> R[Engine]
  R --> H[Backend]
  H --> S[RenderPlanner]
  S --> T[Plan target]
  T --> D[GPU device pool]
  D --> C[Canvas]
```

### Two independent canvases on one page

Share the engine, backend, font bindings, and device pool when compatible. Use one render planner per independently advancing
canvas so each has its own revisions, retirements, and acceptance cursor.

```mermaid
flowchart LR
  R[Engine] --> H[Backend]
  H --> S1[RenderPlanner A] --> T1[Target A] --> D[Shared GPUDevice pool]
  H --> S2[RenderPlanner B] --> T2[Target B] --> D
  D --> C1[Canvas A]
  D --> C2[Canvas B]
```

### Mirrored canvases that must advance together

One renderer-owned composite target may fan a render planner publication into several surfaces. It accepts only after every
surface prepares successfully. Commit is all-or-nothing at the target contract: no member mutates accepted state until
every member is prepared. If a backend failure occurs after any physical commit, the whole group becomes lost, rejects the
candidate, rebuilds every member, and calls its `PlanTargetControl.requestCheckpoint()` before accepting another publication. A boolean
acceptance is therefore sufficient because partial acceptance is not a representable state. If either surface may advance
alone, replace the group with separate render planners.

```mermaid
flowchart LR
  S[One render planner] --> T[Lockstep target/barrier]
  T --> C1[Canvas A]
  T --> C2[Canvas B]
  C1 --> A[Accept only when both commit]
  C2 --> A
```

### Onscreen and transferred OffscreenCanvas

When the `OffscreenCanvas`, engine, backend, render planner, and renderer all live in one worker, use the ordinary borrowed path
inside that worker. Application messages carry authored text state, not plan bytes. When shaping stays in a worker but the
renderer stays on the main thread, use an owned target and transfer the publication buffer; the main thread validates
with `bindBytes()`.

```mermaid
flowchart LR
  UI[Main-thread authored state] -->|messages| WR[Worker engine]
  WR --> WH[Worker backend] --> WS[Worker render planner]
  WS --> WT[Worker borrowed target] --> OC[Transferred OffscreenCanvas]
```

```mermaid
flowchart LR
  WR[Worker engine + render planner] -->|owned transferable bytes| MT[Main-thread target]
  MT -->|bindBytes + realize| C[Onscreen Canvas]
```

### Independent onscreen and offscreen products

Use separate render planners. They may share one engine only when they live in the same JavaScript realm. A worker requires its
own engine and therefore its own Wasm shaping copy; the portable `Font` backing can be transferred or loaded independently,
but engine registrations and backend tokens never cross realms.

### Several renderer integrations

Use one backend per integration or policy ownership boundary. Two backends can share one engine shaping registration through
the engine-private binding cache, while each owns its own policy, portable binding, and render planners. Targets and renderer
pools—not backends—own physical resources. A second canvas alone does not require another backend, though separate policy or
teardown ownership may justify one.

Cross-handle realization sharing never uses `referenceId`, which is only a compact handle-scoped wire identity. A renderer
that pools physical resources outside a handle keys them by its device/context, the authored `RasterResourceId`, and its
renderer variant. The serialized FontFace dependency manifest preserves content-addressed source dependencies when data
crosses realms; the receiving decoder deterministically reconstructs the authored IDs.

### React and Suspense ownership

> Historical design note: D-301 and the current `/react` implementation supersede this `useLoader` model. Hooks now
> declare through `glyph.fontFace`, load through the selected FontFace member, and use provider context only as an optional
> immutable handle or named-FontFace override boundary.

`/react` delegates promise and resolved-value caching to R3F's canonical `useLoader`/`suspend-react` cache. Generic
`useFont(input, technique, options?)` is the extension point; `useBitmapFont`, `useMSDF`, and `useSlug` are thin typed
wrappers over that same key. Their `.preload()` methods populate the same cache and `.clear()` removes that cache entry.
Glyph keeps only a deterministic resource-ownership ledger beside it: a cached font owns one lease, each mounted consumer
clones an independent lease, and clearing the cache cannot dispose a mounted font. The memoized R3F loader delegates each
request to a disposable child Three loader so a cache entry does not pin its shaping engine after release. StrictMode
mount/unmount/remount therefore cannot dispose a sibling consumer's lease or attempt to bind a disposed wrapper. Root
`FontLibrary` remains available to imperative applications, but is not a second React cache and is not required by these
hooks.

### Device-loss fan-out

A device realization pool tracks every target/render planner attached to that device. On loss it stops accepting candidates,
aborts pending target transactions, rebuilds physical state, resumes in checkpoint-required mode, and calls
`control.requestCheckpoint()` exactly once for each attached live target/render planner. Each target then blocks only its own
render planner's deltas until that render planner has supplied and the target has accepted its complete checkpoint; an idle sibling
render planner cannot block an active one. Portable payload leases survive; physical GPU objects do not.

## Cardinality and rules

| Relationship                           | Allowed cardinality    | Rule                                                                                                    |
| -------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `Font` → engine                        | many-to-many over time | Each live engine binding holds an independent lease and one Wasm registration.                          |
| engine → backend                       | one-to-many            | Engine owns and cascades disposal; backend cannot rebind.                                               |
| backend → render planner               | one-to-many            | RenderPlanner cannot move between backends.                                                             |
| backend → policy                       | one-to-many            | RenderPlanner chooses one policy at construction.                                                       |
| render planner → target                | exactly one            | Target defines the one acceptance frontier.                                                             |
| private measurement planner → target   | zero                   | It cannot publish draws or acknowledgments and exists only behind root `createParagraph()`.             |
| target → surface                       | one or lockstep-many   | Independent surfaces require independent render planners.                                               |
| renderer resource domain → realization | one pool per domain    | Pool by package-supplied payload identity and variant; wire reference IDs are never cross-backend keys. |
| engine → JavaScript realm              | exactly one            | Engine/Wasm memory and borrowed views do not cross realms.                                              |

Use another engine for another realm, Wasm build, hard memory/failure boundary, or independent teardown. Use another backend
for another renderer integration, policy ownership domain, or plugin trust boundary. Use another render planner for another
desired-text set, ordering domain, capacity budget, update schedule, or acceptance frontier.

## Deterministic disposal without finalizers

Every resource-owning public handle implements idempotent `dispose()` and, where language support permits,
`Symbol.dispose`. Correctness never depends on garbage collection.

Do not add finalizers to engine, backend, binding, stack, render planner, publication, GPU, or Font wrappers. Their owner graph
already supplies deterministic teardown, and a nondeterministic callback cannot improve dependency ordering.

An unused Font needs no special callback: when the application drops its final reference, the wrapper and canonical
backing become unreachable and ordinary GC reclaims both. Engine binding leases retain the backing state directly rather
than retaining the Font wrapper. The package keeps no strong global cache; an explicit application-owned `FontLibrary`
has its own deterministic cache leases. `font.dispose()` exists for deterministic early release while the wrapper is
still reachable and to reject new bindings, not to make eventual collection possible.

Engine and backend maps are lookup indexes, not owners beyond their counted leases. The engine shaping-registration entry
is retained by live backend binding states and is disposed from Wasm immediately when the final binding lease reaches zero.
The backend portable-binding entry is likewise removed when its final caller, bound-stack, target/device, and committed-plan
lease ends. No package-, engine-, backend-, React-, or renderer-scoped lookup cache may retain a Font backing after all of
its explicit leases are released.

## Implementation sequence

### Repository work map

| Area                                   | Primary implementation owners                                                                                                                                 | Required outcome                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| immutable Font and loading             | `packages/glyph/src/loader.ts`, `loaded-font.ts`, `glyph-engine.ts`, and internal registered-font/cache modules                                               | Replace engine-bound `LoadedFont` with one canonical root `Font` backing, explicit library leases, and engine-independent loading.                                                                                                       |
| declarative bake discovery             | `packages/glyph/src/font.ts`, `packages/glyph/src/discovery.ts`, `packages/glyph/src/node/bake.ts`, bake fixtures, and package exports                        | Preserve `defineFont`/`FontToken` as the statically discoverable root contract; reuse the existing `FontInput` name and prove source discovery after migration.                                                                          |
| engine and backend ownership           | `packages/glyph/src/glyph-engine.ts`, `core/backend.ts`, `core/retention.ts`, and `core/plan-view.ts`                                                         | Engine-owned backend factory, hidden registrations, target-bound render planners, engine-wide borrow gate, and unforgeable candidate modes.                                                                                              |
| retained engine and ABI                | `packages/glyph/rust/shaper/src/engine`, generated ABI, TypeScript frame/compiler internals, and `internal/frame-transfer-pool.ts`                            | Keep the numeric wire format and A/B publication; add retained text handles, privatize caller-authored render planner/acknowledgment inputs, and adapt the existing bounded transfer/return pool rather than creating a second protocol. |
| renderer-free measurement              | `packages/glyph/src/paragraph.ts` and a package-private per-realm measurement service                                                                         | Replace sync construction with async `createParagraph`, keep later queries synchronous, and use a target-less non-publishing render planner without exposing engine ownership at root.                                                   |
| Historical Three reference integration | Removed `three/engine-coordinator.ts` plus then-current `engine-plan-target.ts`, `font-loader.ts`, and `text.ts`                                              | Superseded implementation sequence; current integration uses root `GlyphConfig`, `GlyphRenderer.decode`, handles, and roots.                                                                                                             |
| React integration                      | `packages/glyph/src/react.ts`                                                                                                                                 | Replace module-global loader/promise ownership with provider or application `FontLibrary` leases and prove StrictMode lifecycle safety.                                                                                                  |
| external renderer proof                | `packages/glyph-example-renderer/src` and its tests                                                                                                           | Keep TypeGPU/WebGPU device ownership external, implement ordinary zero-copy `PlanTarget`, and add a real worker-backed `AsyncPlanTarget` round trip.                                                                                     |
| applications, labs, and size entries   | every consumer under `apps/`, including module-scope `useFont.preload`, benchmark labs, conformance targets, proof routes, and `apps/benchmarks/size-entries` | Migrate all call sites in the same atomic package change; preserve module-scope preload through an explicit library-bound contract, replace withdrawn export anchors, and keep root checks plus comparable size graphs reachable.        |
| package cleanup                        | package manifests, exports, boundary tests, and obsolete example adapters                                                                                     | Remove engine-bound and renderer-leaking compatibility surfaces; permit Three only in `glyph-example-raster`'s explicit `/tsl` implementation subpath and never in its neutral entry or in `glyph-example-renderer`.                     |
| docs and evidence                      | README, package concepts, renderer guide, this plan, HTML report, benchmark workflows, and size evidence                                                      | Make current APIs, ownership graphs, worker transfer, performance, and deferred work agree at the final source head.                                                                                                                     |

Each step is one coherent commit and remains green before the next.

1. **Introduce immutable font backing.** Add root `Font`/`loadFont`, optional application-owned `FontLibrary`, one canonical
   backing buffer, internal buffer views, explicit copy/transfer input ownership, refcounted backing state, and no
   independently disposable raster child.
   Preserve `defineFont` and the existing `FontInput`/`FontToken` discovery surface; add token-loading overloads and AOT
   discovery fixtures before changing loader ownership.
2. **Privatize engine registration.** Remove public `GlyphEngineOptions.registry` and `engine.registry`; make engine
   registration a private `WeakMap` keyed by the canonical backing object and retained only by counted backend-binding leases;
   release the Wasm registration at lease zero; separate engine-independent loading from `bindFont`.
3. **Attach backends through their engine.** Move `createGlyphEngine`/`GlyphEngine` from root to `/core`, replace the public
   raw-shaper constructor with `engine.createBackend()`, register owner-cascade teardown, and reject all calls after
   either owner dies.
4. **Add backend binding leases.** Implement idempotent underlying `bindFont`/`bindFontStack`, independent caller leases,
   hidden dynamic IDs, exact technique/policy validation, and engine/backend/device reference chains.
5. **Bind render planners to policy and target.** Move policy selection and one abstract target into render-render planner construction;
   add core-owned retained text handles, opaque acceptance cursors, delivery-specific render planner methods, engine validation
   of delivery, lease-bound borrowed readers, failure-path target disposal, the engine-wide borrowed-view gate,
   pending-acceptance cancellation, the existing bounded transferable-buffer return machinery, render planner-owned checkpoint
   control, and per-device render planner fan-out.
6. **Preserve renderer-free measurement.** Make retained text synchronously answer current desired metrics and positioned
   glyphs before publication without invoking its target, Canvas/device, scene, or matrix. Add async root
   `createParagraph()`, a private per-realm measurement service, and a target-less render planner that can only measure. Reuse the
   retained authored-input path and release the service/engine at the final Paragraph lease.
7. **Migrate every maintained consumer.** Make Paragraph, Three, React, the example renderer, and every `apps/` consumer
   consume only the public
   root and `/core` paths. React moves Suspense caching into an explicit FontLibrary. Three pools immutable font
   realizations per device and batches compatible font-stack members without changing visual order. The example renderer
   uses a real font and real WebGPU/TypeGPU resource realization.
8. **Prove cache reachability.** Add deterministic cache/lease counters showing that no strong package-global root retains
   an unused Font, and that explicit disposal releases reachable-but-unused backing; reject finalizers everywhere.
9. **Remove compatibility cruft.** Delete engine-bound `LoadedFont`, raw `textRuntimeShaper`, public raw render planner updates,
   caller-authored acceptance fields, external mutable registry ownership, numeric IDs from convenience APIs, stale docs,
   and temporary adapters in one breaking migration.

## Type and engine acceptance gates

### Type tests

- a root application can load and compose fonts without importing `/core` or constructing an engine;
- existing `defineFont` calls remain valid, statically discoverable bake inputs, and `loadFont(token)` preserves their
  technique type without introducing a second `FontInput` declaration;
- baked byte input requires `{ baked: { bytes, ownership } }`, source bytes require the source discriminant, and a bare
  byte object is not assignable;
- the root declaration contains the reviewed renderer-neutral barrel and excludes engine, backend, render planner, mutable registry,
  engine-bound loaded-font, and application-invisible engine-handle names;
- an optional root `FontLibrary` owns only explicit cache leases and cannot dispose a returned live Font;
- a Font handle carries exactly one technique type, while a multi-raster load returns a position-preserving typed tuple;
- root exports no engine or backend construction API; `/core` creates a backend only through a package-created live engine;
- a backend installs one complete multi-program `PolicyDescriptor`; a render planner requires that BackendPolicy, one
  descriptor-member capability set, validated limits, and one target;
- a render planner exposes retained `createText`/`update`/`dispose` input handles but no raw planner, policy, numeric-ID,
  revision, acknowledgment, or frame-byte fields;
- retained text exposes synchronous `measure()` and `glyphs()` over current desired state without exposing a target,
  renderer, scene, matrix, or publication cursor;
- root `createParagraph()` returns a ready Paragraph without exposing `/core`; no public target-less render planner is nameable;
- every target is idempotently disposable, and its factory delivery discriminant infers the matching render planner return type;
- `PlanTarget` publishes synchronously from the borrowed A/B slot, while only `AsyncPlanTarget` copies and returns a Promise;
- `AsyncPlanCandidate` exposes a full-span `Uint8Array<ArrayBuffer>` while `PlanCandidate` exposes no transferable bytes;
- `AsyncPlanCandidate` contains every resolved payload referenced by its copied plan and exposes no deferred resolver;
- a target, policy, font binding, stack, acceptance cursor, or render planner from another owner is not assignable;
- a target-bound render planner exposes no raw update accepting caller-authored revisions or acknowledgments;
- retained text options include `order` and `rasterPixelRatio`; advanced regions, exclusions, and inline objects cannot
  accept IDs/revisions/indices or raw material/resource numbers;
- renderer-owned region transforms use an opaque BackendTransformBinding that targets can resolve; a raw transform-table
  index is not accepted or lost;
- publish options accept only named semantic/compositing choices, never policy bytes, a numeric mask, or ownerless
  capability selection, and can request measurement plus layout inspection together through `semanticViews: 'all'`;
- convenience APIs never accept raw numeric registration IDs;
- renderer-specific Canvas, Three.js, TypeGPU, WebGPU, material, and device types do not enter root or portable policy
  declarations.
- `/core` and root declarations remain disjoint, while each integration re-exports only root names used by its own
  signatures; packed-package tests prove every documented entry and withdrawn name.

### Engine tests

- one `Font` binds to two engines; disposing either engine does not invalidate the font or the other engine;
- repeated `bindFont` calls share one engine registration and one backend binding while returning independent leases;
- the final backend-binding lease immediately disposes the engine's Wasm registration even while the engine stays live;
- a font marked disposed rejects a new binding but remains valid through every existing lease;
- binding a Font whose technique is unsupported by the backend policy throws at `bindFont` before registration or allocation;
- engine disposal closes render planners and backends before Wasm, while font assets remain reusable;
- backend disposal cannot invalidate another backend's binding to the same font;
- render planners cannot cross backends, targets, policies, acceptance cursors, or storage namespaces;
- no call through a sibling render planner or sibling backend can re-enter Wasm while a borrowed target callback is active;
- a second update while one async-target acceptance is pending throws without crossing into Wasm;
- disposing a render planner aborts its pending target transaction and ignores a late accepted answer;
- an async worker target transfers one package-created plan buffer out and back, then resolves acceptance; worker
  termination before the return leaves the cursor unchanged and requires no borrowed-memory recovery;
- the worker transfer detaches the source buffer, performs no structured-clone or second plan copy, returns the same
  publication identity on success, and lets the render planner reuse or release the returned allocation;
- the bounded pool reuses only an exact-length returned buffer; non-bucket publication sizes remain full-span and never
  route through a subview-copy helper;
- exact-size pooling obeys deterministic least-recently-returned eviction and bounded allocation/hit/discard counters for
  stable and variable publication traces;
- returning one target object from two render planner factories throws before the second Wasm render planner allocation;
- a factory throw invalidates its control; a newly returned target is claimed before Wasm allocation and disposed exactly
  once if later construction fails, while a reused target is rejected without disposing the first render planner's live target;
- an `any`-cast target whose engine `delivery` or `accept()` shape contradicts the inferred render planner type throws before
  Wasm allocation;
- async target creation rejects a non-safe or insufficient `maximumPlanBytes` before Wasm allocation;
- disposing a render planner disposes its target exactly once, removes its checkpoint control from the device pool, and does not
  interrupt loss fan-out to a live sibling;
- an owned publication survives later calls and worker transfer but is revalidated in the receiving realm;
- every read through a retained borrowed-plan facade throws after `accept()` returns, after memory growth, and after
  disposal; an independently bound owned plan remains readable;
- every acquired portable payload lease is released on commit, rejection, abort, target disposal, and device-pool
  retirement; receiving-realm caches own independent leases;
- a worker transport resolves every referenced payload before transfer, validates its digest/descriptor manifest in the
  receiving realm, never detaches canonical Font backing, and never treats a wire `referenceId` as a cross-realm identity;
- two independent canvases cannot acknowledge through one render planner; a lockstep composite target cannot advance past its
  slowest member;
- a lockstep target prepares every member before any commit; a post-prepare partial backend failure marks the group lost;
- device loss discards physical realizations, preserves portable payload leases, and requests exactly one checkpoint from
  every render planner attached to the pool; each render planner independently resumes after its own checkpoint commits;
- an active render planner completes replacement-device recovery while an attached idle sibling publishes nothing;
- equal numeric resource references from different backends cannot alias in a shared pool, while an identical
  package-authenticated payload may share one realization;
- concurrent top-level loads coalesce while pending and retain no settled global entry;
- source/runtime-baked loading releases source bytes after publishing the immutable artifact and cannot attach a raster
  later;
- transfer input rejects a subview and `SharedArrayBuffer` before detaching anything;
- worker payload transfer never detaches canonical Font backing; cache misses use one exact-range standalone payload copy,
  while cache hits and authenticated fetch keys transfer no payload bytes;
- worker `error`, `messageerror`, exit, and render planner disposal deterministically settle pending publication without a retry
  or timer; late success cannot advance a disposed render planner;
- transfer backpressure returns a typed rejection with the cursor unchanged; oversize and transfer/correlation defects
  reject the publish call, and none retries automatically;
- synchronous WebGPU acceptance does not await an error scope; a later device/validation fault enters the documented lost
  path and requests a checkpoint without corrupting an unrelated render planner;
- root Paragraph creation, measurement, disposal, and service recreation prove the target-less path; measurement never
  advances a render plan revision or acceptance cursor;
- retained text measures before its first publication and immediately after mutation; neither query calls the target or
  requires scene attachment, a world matrix, Canvas, device, or renderer resource;
- `glyph bake` discovers migrated `defineFont` calls and emits the same artifact; every `apps/` package type-checks after
  module-scope preload migrates to an explicit library-bound helper;
- malformed authored input throws at the receiving call and malformed emitted plans fail as engine defects;
- one engine-reported result-capacity growth reserves the exact size and republishes before any cursor exists; a second
  sizing failure throws and no renderer rejection is retried;
- explicit disposal is idempotent and ordered;
- one stale checkpoint control cannot interrupt device-loss fan-out to live siblings; the integration defect is reported
  only after the remaining controls are signaled;
- no package-, engine-, backend-, React-, or renderer-scoped lookup cache retains Font backing after its final explicit lease,
  while every live engine, backend, stack, and device lease retains exactly the backing state it needs.

### Memory, performance, and package gates

- a large embedded GLB retains one canonical backing; buffer-view access does not allocate payload-sized copies;
- one font bound by many render planners adds no shaping or immutable payload copy;
- one font bound by two engines adds exactly one Wasm shaping registration per engine;
- binding and releasing hundreds of fonts against one long-lived engine returns Wasm registration and backing counters to
  baseline without disposing that engine;
- one font used by many render planners on one device realizes each immutable payload once;
- disposed engine/backend/render planner churn returns registrations, caches, and device leases to baseline;
- hot unchanged and incremental shaping/render-plan benchmarks remain within the existing noise envelope;
- worker-transfer microbenchmarks record copy/transfer/return time, allocations, pool hits, and bounded pooled bytes for
  stable-size and variable-size publication traces;
- WebGPU/Three lab benchmarks retain draw count, visible-pixel, idle-submit, CPU-submit, and GPU-time gates;
- size entries are rewritten around stable feature scenarios rather than historical export homes: portable root
  application use, `/core` integrator use, each built-in engine technique, Three, and root-plus-core combined. The
  pre-migration equivalents are measured before changing entries, and moving a name from root to `/core` cannot reset the
  comparable combined or feature baseline;
- Wasm, renderer-neutral, and complete Three package-size gates are measured. Correct code is reviewed and the recorded
  ceiling is updated when a justified ownership implementation exceeds it; no baseline is silently replaced by a
  different import graph.

## Documentation and migration acceptance

Before merge:

- `README.md` shows the application path without engine/backend/render planner concepts and routes integrators to `/core`, the only
  entry that exports `createGlyphEngine`, `GlyphEngine`, or `GlyphBackend`;
- the root API reference groups every surviving export by application, technique-provider, or shared authoring purpose and
  integrations document whether callers may import the canonical root name or the signature-required convenience re-export;
- `core-api.md` becomes the exact implemented reference rather than preserving this proposed shape;
- `renderer-integration.md` shows one complete current API flow for single canvas, independent canvases, lockstep targets,
  and worker transfer;
- the Three and example-renderer package concepts map their renderer objects to engine, backend, render planner, target, and device
  lifetimes;
- the HTML implementation report uses the same ownership graph and clearly labels current versus proposed calls;
- all canonical source digests, docs checks, focused tests, repository checks, benchmarks, size gates, and CI checks pass.

## Opus High adversarial review disposition

Opus reviewed committed target `7cd3f250a65fc6170093c9b4824c48755fff7699` in an isolated detached worktree
and verified the standalone report at SHA-256 `ac1feddf960d0e8b55b9640fa5839b40bec528ca97fbbb1fdd13531b748219a8`.
The initial process stalled after source collection; the same resumable review session was continued to its authoritative
result. Every finding was checked against this source before changing the plan.

| Finding                                                           | Disposition                                   | Validated correction                                                                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1 runtime cache could retain every once-bound font               | Accepted                                      | Runtime lookup is weak/non-owning; Wasm registration is released at final binding lease even while runtime stays live.                           |
| F2 `/react` owns module-scope strong loader/promise caches        | Accepted, failure example narrowed            | Migrate React to an explicit provider/library resource with independent mounted leases and StrictMode coverage.                                  |
| F3 target checkpoint direction is impossible and absent from type | Accepted with a factory-bound control         | Session construction passes one opaque `PlanTargetControl`; the device pool signals that control rather than calling a method on its own target. |
| F4 one device loss has no multi-session fan-out                   | Accepted                                      | Device pool enumerates attached sessions; each session independently blocks until its own checkpoint commits.                                    |
| F5 raw update preserves caller-authored acceptance                | Accepted with stronger correction             | Remove the public raw session path; workers use an owned target message transport, not a second session model.                                   |
| F6 host-local gate cannot protect runtime-wide Wasm memory        | Accepted                                      | Borrow gate belongs to runtime and covers every attached host.                                                                                   |
| F7 cross-host device-pool key was undefined                       | Accepted                                      | Candidate resolution supplies an opaque authenticated payload identity; wire IDs are never pool keys.                                            |
| F8 lockstep target could partially commit                         | Accepted; generation-type claim rejected      | Prepare all members before any commit; partial backend commit marks the group lost. Boolean acceptance remains sufficient.                       |
| F9 raster and runtime-bake contract missing                       | Accepted, proposed extra source copy rejected | Keep singular typed Font handles/tuple loads; source bake publishes a complete immutable artifact and then releases source bytes.                |
| F10 no-library path lost in-flight coalescing                     | Accepted                                      | Coalesce only pending requests and drop entries on settlement.                                                                                   |
| F11 pending owned acceptance could outlive session                | Accepted                                      | Dispose aborts and invalidates the transaction; late answers cannot advance state.                                                               |
| F12 transfer input lost view bounds                               | Accepted                                      | Require a full non-shared view and reject before detaching.                                                                                      |
| F13 normative target/library types were incomplete                | Accepted                                      | Define candidate origin, payload lease/identity, FontLibrary, error payload, and `textCapacity`.                                                 |
| F14 plan `draft` versus accepted decision                         | Rejected as a defect                          | OKF `draft` is implementation-document lifecycle; D-286 records the accepted decision with implementation pending.                               |
| F15 dated report path/head creates provenance ambiguity           | Accepted as presentation only                 | Report footer distinguishes the portability evidence head and ownership review target; the final handoff records the report hash.                |

The follow-up verification at `457e0495deeb05718e0b97fd52182f9b3a6d1799` found three gaps in the newly introduced
control machinery. They are accepted here: targets are explicitly disposable so sessions can detach pool controls;
device-loss barriers are per session rather than pool-wide; and cross-realm owned targets transport an authenticated
resource manifest because a realm-local resolver closure cannot cross `postMessage`.

Opus re-reviewed the exact corrected target `ffbe16642ab2e1c64768fff7113c9208622bafda` and reported no remaining
actionable blocker. The implementation must still make the delivery-to-session conditional return and target claim check
concrete as specified above; they are acceptance details, not alternate ownership choices.

Opus High then reviewed the complete ownership target at `ff4cbea0330593061cf967888965b19eff3537c2` in isolated worktree
`/private/tmp/glyph-opus-review-ff4cbea0` under resumable session
`7759b062-8911-4b66-bab2-60a137759fe5`. The review verified the ownership thesis but rejected the plan as not yet
implementable. Each finding was checked against the cited source before this correction:

| Finding                                                                | Disposition                              | Correction in this plan                                                                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No public authored-input protocol after privatizing the frame compiler | Accepted                                 | Render sessions now own retained text handles and compile IDs/cursors internally; every existing authored frame field must migrate before the raw compiler closes. |
| Paragraph has no target-free measurement position                      | Accepted, scoped package-private         | Root adds async `createParagraph()` over a private per-realm measurement service/session; render sessions retain exactly one target.                               |
| `defineFont` AOT discovery and `FontInput` collide with the proposal   | Accepted                                 | Reuse the existing `FontInput`/`FontToken`; preserve `defineFont` as discovery anchor and add direct token loading plus discovery fixtures.                        |
| Worker payload transfer could detach canonical backing                 | Accepted                                 | Only dedicated exact-range payload copies may transfer on a receiving-cache miss; canonical views never enter a transfer list.                                     |
| `apps/` migration was absent but part of root checks                   | Accepted                                 | The work map and gates cover every app, including explicit-library module-scope React preload.                                                                     |
| Target factory leaks on post-factory failure                           | Accepted, reused-target cleanup narrowed | Validate and claim before Wasm allocation; dispose only the newly claimed target on later failure, never another session's claimed target.                         |
| Borrowed plan expiry was prose-only                                    | Accepted                                 | Candidate gets a lease-bound non-rebindable facade whose every read checks expiry.                                                                                 |
| Payload lease had no release                                           | Accepted                                 | Payload acquisition returns independently disposable leases with commit/reject/abort/pool-retirement gates.                                                        |
| Load cancellation disappeared                                          | Accepted                                 | Root and library load overloads retain `FontLoadOptions.signal`.                                                                                                   |
| Delivery could contradict runtime behavior                             | Accepted                                 | Runtime validates the target discriminant and callable shape before Wasm allocation.                                                                               |
| Async target could wedge forever                                       | Accepted with bounded core guarantee     | Core-owned abort race settles on disposal; worker lifecycle events must settle rejection; retries and timers remain forbidden.                                     |
| Synchronous WebGPU acceptance changed error-scope semantics silently   | Accepted                                 | Acceptance is defined at synchronous CPU commit; later WebGPU faults enter device-loss/checkpoint recovery and receive direct tests.                               |
| Proposed names/types were incomplete                                   | Accepted                                 | `PortableResource`, `FontLibraryOptions`, reader, binding, retained-text, and disposal shapes are now named.                                                       |
| Global `Disposable`/`using` assumptions were unstated                  | Accepted                                 | Normative handles declare `dispose()` explicitly; examples use ordinary deterministic teardown.                                                                    |
| Existing frame transfer pool and capacity growth were omitted          | Accepted                                 | Reuse the bounded pool; retain internal result-capacity growth and test it without exposing `reserve()`.                                                           |
| Neutral raster wording denied the legitimate `/tsl` dependency         | Accepted                                 | Three is allowed only in the explicit `/tsl` implementation subpath, never the neutral technique or renderer entries.                                              |

The same Opus session must review the next committed target. Implementation starts only after every new blocker is either
fixed in the contract or rejected with source evidence.

The resumed Opus High pass reviewed exact commit `904063b67fd9e5e015a7b888d24508b680464973` under session
`d6c50b1b-f6c5-429a-ab2f-7f245e3faaef`. It confirmed ten prior findings closed and found three local blockers plus seven
medium inventory/documentation gaps. Their source-validated disposition is:

| Finding                                                                                                                         | Disposition  | Correction                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full-span exact copy contradicted the power-of-two/best-fit transfer pool                                                       | Accepted     | Adapt the existing bounded pool to exact-length buckets; full-span ownership, one copy, return validation, and stable-size reuse now agree.                        |
| `installPolicy(PolicyProgram)` could not express maintained multi-program policies; capability selection and limits disappeared | Accepted     | Install a full `PolicyDescriptor`; session creation receives one descriptor-member capability object and maximum limits, while core owns the D-281 wire selection. |
| Bare `FontBytesInput` could not distinguish a baked GLB from source bytes                                                       | Accepted     | Widen existing source/baked object discriminants to byte inputs; bare byte sniffing is forbidden.                                                                  |
| Root text options falsely claimed flow/inline coverage and omitted `order`/`rasterPixelRatio`                                   | Accepted     | Add the live fields and explicit ID-free `/core` flow/exclusion/inline forms with opaque host bindings.                                                            |
| Export moves made size-entry graphs incomparable                                                                                | Accepted     | Migrate size entries and gate stable feature graphs plus the combined root/core graph against pre-migration equivalents.                                           |
| Entry inventory put current Paragraph at root and omitted dying LoadedFont helpers                                              | Accepted     | Record the actual `/core` origin, move Paragraph application types to root, and withdraw five runtime-bound helper exports.                                        |
| Host options/errors were unnamed                                                                                                | Accepted     | Declare host options and session/transport errors in the normative surface.                                                                                        |
| FontLibrary options dropped loader/registry capabilities                                                                        | Accepted     | Classify and retain base URL, development, runtime bake, diagnostics/warnings, and resource bounds under the library owner.                                        |
| Transfer-pool failure outcomes had no call-bound result                                                                         | Accepted     | Backpressure rejects acceptance without advancing; oversize and transport defects reject the publish call; no retry or second copy occurs.                         |
| Report extracted `candidate.acquirePayload` unbound                                                                             | Accepted     | Use an owning closure in the worked target example.                                                                                                                |
| Redundant token union and post-disposal checkpoint fan-out                                                                      | Not blockers | The token union may simplify during implementation; loss fan-out must continue across a stale-control defect and report it after signaling live siblings.          |

The bounded verification of `1825fb735` confirmed BL1-BL3 and M1-M7 closed. It found one final renderer-ownership gap and
three bounded transport details: renderer-owned `transformIndex` needed an opaque replacement, semantic views needed the
combined `all` case, async transfer capacity needed construction-time compatibility, and exact-size pooling needed an
eviction/counter-performance contract. This revision adds `BackendTransformBinding` plus candidate resolution, the `all`
choice, `maximumPlanBytes >= limits.maxOutputBytes` validation, deterministic least-recently-returned eviction, and
stable/variable trace gates. No finding changes the ownership graph.

Opus High performed the final diff-only verification at exact commit
`c94f30933333ec85110dc59b0bf933f92bcee02a` under session `276d7607-e9bd-419c-a168-b25ed4fd10a5`. It verified all four
items closed against source and reported: **no actionable blocker; the implementation plan is implementable.** This final
evidence-only note does not alter the reviewed contract.

No compatibility adapter may keep both ownership models alive. The migration may stage private implementation pieces, but
the published package changes from the old surface to the new surface atomically.
