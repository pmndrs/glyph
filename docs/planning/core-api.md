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
    resource: ../../packages/text/src/text-runtime.ts
    title: Current text runtime
  - id: current-font-selection
    resource: ../../packages/text/src/loaded-font.ts
    title: Loaded-font ownership and fallback
  - id: current-properties
    resource: ../../packages/text/src/text-properties.ts
    title: Current paragraph properties
  - id: current-layout-query
    resource: ../../packages/text/src/layout.ts
    title: Current layout-query values
  - id: current-three-api
    resource: ../../packages/text/src/three.ts
    title: Current Three.js exports
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-09T18:30:00Z'
---

# Core text API

`@pmndrs/text` owns portable font loading, raster-technique selection, font fallback, paragraph input types, and layout
query result types. Rust owns shaping, bidi, line composition, positioning, instance packing, and the renderer-directed
command buffer. A renderer integration owns synchronization and GPU realization.

Applications using Three.js normally import scene objects from `@pmndrs/text/three` or React components from
`@pmndrs/text/r3f`; they do not drive the Rust engine directly.

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

The default runtime instantiates the packaged `text_shaper.wasm`. Supplying `wasm` is intended for controlled builds,
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
fonts; disposing a leased font throws `FontLeaseError` instead of invalidating retained Rust state.

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

## Synchronization boundary

There is one engine update export, `text_update(requestOffset, requestLength)`. The TypeScript host writes a complete frame
request into retained Wasm staging memory; Rust applies mutations, shapes and lays out affected paragraphs, packs canonical
instance records, and emits the render-plan command buffer plus coalesced dirty ranges. Renderer policy is compiled data,
not a JavaScript callback executed from Rust.

The low-level engine session and wire format are package-internal during this foundation stack. This prevents applications
from binding to an unstable ABI while the maintained Three implementation proves the policy and command-buffer model.
The [Rust engine plan](rust-layout-engine.md) is the authority for the ABI, memory-growth discipline, SIMD layout, and
follow-on publishing features.

## Removed pre-cutover surfaces

The following experimental V0 surfaces are not part of the current API:

- `createParagraphEngine` and standalone JavaScript paragraph layout;
- `TextRuntime.createParagraphBatch`, `runtime.update`, and `runtime.updateAsync`;
- `analyzeBidi`, `shapeBatch`, and `reshapeRanges` exports;
- the text-preparation Worker protocol;
- `@pmndrs/text/typegpu` and its duplicate batch executor.

TypeGPU will be rebuilt against the Rust render plan rather than retaining the removed TypeScript batch model. Use the
[Three.js API](three-api.md) for the maintained renderer and `@pmndrs/text/r3f` for React.
