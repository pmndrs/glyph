---
type: API Specification
title: Core text API
description: Reference for renderer-neutral font loading, raster selection, mixed-technique fallback, paragraph inputs, and explicit layout-query values.
documentation_type: reference
tags: [api, fonts, shaping, paragraphs, layout, rendering]
status: stable
sources:
  - id: decision-register
    resource: decision-register.md
    title: Accepted architectural decisions
  - id: rust-engine
    resource: rust-layout-engine.md
    title: Rust text engine and render-plan ABI
  - id: current-runtime
    resource: ../../packages/glyph/src/text-runtime.ts
    title: Current text runtime
  - id: current-font-selection
    resource: ../../packages/glyph/src/loaded-font.ts
    title: Loaded-font ownership and fallback
  - id: current-properties
    resource: ../../packages/glyph/src/text-properties.ts
    title: Current paragraph properties
  - id: current-layout-query
    resource: ../../packages/glyph/src/layout.ts
    title: Current layout-query values
  - id: current-three-api
    resource: ../../packages/glyph/src/three.ts
    title: Current Three.js exports
  - id: core-host
    resource: ../../packages/glyph/src/core/host.ts
    title: Renderer-neutral host and session lifecycle
  - id: example-renderer
    resource: ../../packages/glyph-example-renderer/src/engine.ts
    title: Complete external renderer integration
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-26T18:18:53Z'
---

# Core text API

`@pmndrs/glyph` owns portable font loading, raster-technique selection, font fallback, paragraph input types, and layout
query result types. Rust owns shaping, bidi, line composition, positioning, instance packing, and the renderer-directed
command buffer. A renderer integration owns synchronization and GPU realization.

Applications using Three.js normally import scene objects from `@pmndrs/glyph/three` or React components from
`@pmndrs/glyph/react`; they do not drive the Rust engine directly.

> **Accepted ownership migration:** this reference describes the currently implemented API. The next breaking migration
> is specified in [Font, runtime, host, session, and render-target ownership](font-runtime-ownership.md): root font loading
> becomes runtime-independent, `/core` attaches hosts to runtime owners, sessions bind one abstract acceptance target, and
> explicit leases remain the correctness mechanism. Finalizers are unnecessary: unused fonts are not strongly cached,
> while deterministic owners retain and release backing state directly.

## Runtime and font loading

```ts
interface TextRuntimeOptions {
  readonly registry?: FontRegistry;
  readonly wasm?: BufferSource | WebAssembly.Module;
}

interface TextRuntime {
  readonly registry: FontRegistry;
  readonly disposed: boolean;

  loadFont<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFont<Technique>>;

  dispose(): void;
}

declare function createTextRuntime(options?: TextRuntimeOptions): Promise<TextRuntime>;
```

The default runtime instantiates the packaged `text-shaper.wasm`. Supplying `wasm` is intended for controlled builds,
tests, and compile-time SIMD variants. A runtime owns its Rust registration domain and all fonts loaded through it.

```ts
type LoadedFontInput =
  | { readonly baked: string | URL }
  | { readonly source: string | URL; readonly runtimeBake: RuntimeFontBake };

interface LoadedFontRequest<Technique extends AnyRasterTechnique> {
  readonly input: LoadedFontInput;
  readonly raster: {
    readonly technique: Technique;
    readonly options: RasterOptionsOf<Technique>;
  };
}
```

`baked` loads a portable GLB artifact. `source` requires an explicit runtime baker and never silently adds a baker to the
consumer graph. The request selects Bitmap, MSDF, Slug, or a third-party raster technique independently for each loaded
font.

## Loaded fonts and fallback

```ts
interface LoadedFont<Technique extends AnyRasterTechnique> {
  readonly runtime: TextRuntime;
  readonly font: RegisteredFont;
  readonly technique: Technique;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
  readonly disposed: boolean;
  dispose(): void;
}

interface FontStack<Technique extends AnyRasterTechnique> {
  readonly fonts: readonly [LoadedFont<Technique>, ...LoadedFont<Technique>[]];
}

declare function createFontStack<Primary, Fallback extends readonly LoadedFont<AnyRasterTechnique>[]>(
  primary: LoadedFont<Primary>,
  ...fallback: Fallback
): FontStack<Primary | TechniqueOf<Fallback>>;
```

Fallback order is explicit. Every member must belong to the same runtime, but members may use different raster
techniques. This permits, for example, an MSDF prose font followed by a Slug color-emoji font. The active renderer must
have a policy program and material implementation for every selected technique; the maintained Three integration ships
Bitmap, MSDF, and Slug support.

A loaded font retains its registered font, raster resource, and runtime until disposed. Live `Text` objects lease their
fonts; disposing a leased font is a no-op that warns in development builds instead of invalidating retained Rust state (D-255).

## Paragraph input

```ts
type ParagraphAxisConstraint =
  | { readonly mode: 'unconstrained' }
  | { readonly mode: 'at-most'; readonly size: number }
  | { readonly mode: 'exact'; readonly size: number };

interface ParagraphContentBox {
  readonly width?: ParagraphAxisConstraint;
  readonly height?: ParagraphAxisConstraint;
  readonly maxLines?: number;
  readonly wrap?: 'none' | 'word' | 'character';
  readonly align?: 'start' | 'center' | 'end' | 'justify';
  readonly overflow?: 'visible' | 'clip' | 'ellipsis';
}

interface ParagraphStyle {
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly language?: string;
  readonly direction?: 'auto' | 'ltr' | 'rtl';
  readonly features?: readonly FontFeature[];
}
```

`ParagraphContentBox` is layout-system-neutral. Omitted axes are unconstrained. `exact` fixes the resolved box dimension;
`at-most` clamps it. `contentWidth` and `contentHeight` in query results still report the intrinsic laid-out requirement.

Text may be a string plus explicit spans, or a `FormattedText` value created with `txt` and `span`. Styles cascade at
extended-grapheme boundaries. Paint and `material` are rendering values; they do not alter shaping or line composition.

The foundation stack currently implements horizontal text, font size, line height, letter spacing, language, direction,
OpenType features, wrapping, alignment, clipping policy, line limits, and ellipsis. The publishing-feature stages in the
[Rust engine plan](rust-layout-engine.md) own vertical writing, decorations, editorial regions/exclusions, and the
remaining admitted typography features; this reference does not claim those future inputs as shipped.

## Layout query values

Rendering does not carry layout arrays in every command buffer. An integration may expose explicit, demand-driven Rust
queries using these public result types.

```ts
interface ParagraphMeasurement {
  readonly width: number;
  readonly height: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly firstBaseline: number;
  readonly lastBaseline: number;
  readonly overflowed: boolean;
}

interface ParagraphLayoutSummary extends ParagraphMeasurement {
  readonly glyphCount: number;
  readonly lineCount: number;
  readonly missingGlyphCount: number;
}
```

`width` and `height` are the resolved paragraph box. `contentWidth` and `contentHeight` are the intrinsic extents required
by the complete paragraph before box clamping. Viewport clipping does not destroy layout outside the viewport. `maxLines`
and ellipsis are semantic truncation: positioned output contains the retained visible result, while intrinsic extents and
`overflowed` continue to report that additional content existed.

Baselines are distances from the paragraph box's top edge. Summary counts include retained non-rendering glyphs such as
spaces; `missingGlyphCount` counts positioned `.notdef` glyphs.

```ts
interface ParagraphLayoutInspection extends ParagraphLayoutSummary {
  readonly fontHandles: Uint32Array;
  readonly glyphFontSlots: Uint16Array;
  readonly glyphIds: Uint16Array;
  readonly glyphStableIds: Uint32Array;
  readonly clusters: Uint32Array;
  readonly glyphFontSizes: Float32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly glyphFlags: Uint16Array;
  readonly lineTextStarts: Uint32Array;
  readonly lineTextEnds: Uint32Array;
  readonly lineGlyphStarts: Uint32Array;
  readonly lineGlyphCounts: Uint32Array;
  readonly lineBaselines: Float32Array;
  readonly lineAdvances: Float32Array;
}
```

Inspection preserves font fallback identity, glyph IDs, UTF-16 cluster offsets, stable glyph identities, line membership,
and positioned geometry. It is a copied semantic view for measurement, hit testing, selection, and directed presentation
augmentation—not GPU instance storage. Repeated unchanged queries may reuse the same result object.

## Renderer integration lifecycle

`@pmndrs/glyph/core` is the published integration surface. A custom renderer imports the root package for font loading
and `/core` for engine driving. Four owners participate:

| Owner                | Lifetime                                       | Holds                                                                                             |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `TextRuntime`        | application or font-library lifetime           | loaded fonts and one `RuntimeShaper`                                                              |
| `TextEngineHost`     | one renderer integration over that shaper      | policies, compiled font bindings, font stacks, sessions, and ID provenance                        |
| `TextEngineSession`  | one independently revisioned paragraph batch   | hot paragraph state, A/B publications, physical buffer generations, and engine resource residency |
| renderer device pool | renderer-defined, normally one device lifetime | realized textures, buffers, geometry, pipelines, and reference counts                             |

A session is not a scene, render pass, or GPU device. One host may create many sessions, and multiple hosts may share one
`RuntimeShaper`, but each numeric registration is claimed by exactly one host. A frame naming another host's policy or
font stack is rejected before the session invalidates its last accepted publication. Separate Wasm instances have
independent registration domains.

### Cold registration

Policy IDs are stable authored constants. Runtime-created binding, stack, and session IDs come from the host:

```ts
const shaper = textRuntimeShaper(runtime);
const host = new TextEngineHost(shaper);

const POLICY = id('policy', 'my-renderer/default');
host.registerPolicy(POLICY, rendererPolicyBytes(host.wireIdentities));

const compiled = compileRasterFont(loadedFont, host.wireIdentities);
if (compiled === undefined) throw new Error(`unsupported technique: ${loadedFont.technique.id}`);

const binding = host.id('font-binding', 'my-renderer/font/1');
host.registerFontBinding(binding, loadedFont.font.handle, compiled.binding);

const stack = host.id('font-stack', 'my-renderer/stack/1');
host.registerFontStack(stack, [binding]);

const session = host.createSession({
  handle: host.id('session', 'my-renderer/main'),
  requestCapacity: 4096,
  resultCapacity: 128 * 1024,
});
```

`compiled.resources` contains immutable portable payloads and `compiled.declaredResources` maps shader-facing names to
their retained keys. Glyph does not turn those payloads into GPU objects. The renderer realizes each payload for its
device, normally pooling by `(device, referenceId, generation)`, and leases that realization to every session that uses
it. A plan resource row names the same stable `referenceId`; the renderer joins the row to its pool and binds the named
payload to the selected shader. Releasing a session releases its lease, not an atlas still used by another session.

The example renderer's `device.prepareResources()` is one concrete renderer-owned transaction, not another core API. It
validates and prepares portable payloads before `registerFontBinding`, commits them only after binding registration
succeeds, and discards the candidate on failure. Three owns an equivalent device-local realization layer.

### Hot frame updates

The integration owns text-instance state and converts its changes into one frame request:

```ts
const request = compileTextEngineFrameUpdate({
  sessionId: session.handle,
  policyHandle: POLICY,
  expectedEngineRevision,
  consumedPlanRevision,
  acknowledgedPublicationGeneration,
  limits,
  paragraphMutations,
  textMutations,
  styleMutations,
  constraints,
  regions,
});

const borrowed = session.update(request);
```

Paragraph, style, flow, and region handles are host-scoped IDs. Creating a text instance emits its initial paragraph,
text, style, constraint, and region mutations; later application updates emit only changed sections. Disposing the text
emits a paragraph removal before its IDs are recycled. `packages/glyph-example-renderer/src/engine.ts` is the complete
reference for this loop.

The returned publication borrows Wasm A/B memory. A synchronous renderer applies the plan before its next session call
without copying. A renderer that crosses an async submission, later engine call, or retained same-realm scene handoff uses
`session.copyPublication(publication)` once and passes the returned `OwnedTextEnginePublication`; package-private provenance
prevents JavaScript from forging that ownership by copying fields. `assertOwnedTextEnginePublication()` is the runtime gate
for a same-realm API that stores the publication. For a worker boundary, copy before posting and transfer the self-owned
buffer; the receiving realm validates the untrusted bytes with `TextEngineRenderPlanView.bindBytes()` because the runtime
ownership witness is deliberately realm-local. Binding is transactional and rejects an ABI mismatch, a non-success status,
and malformed render or semantic table framing before replacing the reader's prior valid publication.

A renderer carries its last device-accepted `consumedPlanRevision` and `acknowledgedPublicationGeneration` in the next
frame request; copying a candidate is not the same event as committing it to the device. If realization fails, those values
stay unchanged. A device-owning renderer requests a checkpoint after it has rebuilt its resource pool. Three waits for an
explicit material or other renderer-relevant invalidation before requesting that checkpoint; it neither retains the failed
publication nor retries unchanged frames.

### Disposal and failed calls

Explicit incremental teardown runs in dependency order: session, font stack, font binding, renderer resource lease, and
policy. `host.dispose()` performs the host-owned steps automatically. A policy or stack still named by committed session
state fails with `registrationInUse`; a binding still named by a stack also fails. Failed disposal keeps host bookkeeping
and ID provenance intact so the owner can release the dependency and retry. Successful individual disposal releases its
registration ID provenance; repeated host and session disposal is a no-op.

Malformed or foreign frame input throws at the TypeScript call before the previous publication expires. Rust performs the
complete wire and semantic validation before committing state. A malformed emitted plan is an engine defect, not a
recoverable renderer condition. A renderer-realization failure advances engine state but not device acceptance; an explicit
renderer-state update uses the last accepted plan revision and generation to request a complete checkpoint.

The [Rust engine plan](rust-layout-engine.md) remains the authority for the ABI, memory-growth discipline, SIMD layout,
and render-plan transaction.

## Removed pre-cutover surfaces

The following experimental V0 surfaces are not part of the current API:

- `createParagraphEngine` and standalone JavaScript paragraph layout;
- `TextRuntime.createParagraphBatch`, `runtime.update`, and `runtime.updateAsync`;
- `analyzeBidi`, `shapeBatch`, and `reshapeRanges` exports;
- the text-preparation Worker protocol;
- the pre-Rust `@pmndrs/glyph/typegpu` batch executor.

The current `/typegpu` subpath is a shader library consumed through the Rust render plan; it is not the removed duplicate
layout and batching engine. Use the [Three.js API](three-api.md) for the maintained renderer and
`@pmndrs/glyph/react` for React.
