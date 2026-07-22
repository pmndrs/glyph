# Runtime API shapes

Status: current hardening target; provisional and not a public API commitment  
Scope: one-font vertical slice with multi-font-safe identities

## Design constraints

The first implementation must:

- shape at runtime with HarfRust Wasm at reasonable speed;
- parse/register a font once and reuse its shaping state and plans;
- cross the JS/Wasm boundary in coarse batches, never per glyph;
- lay out constrained paragraphs in TypeScript/JavaScript;
- render through an explicitly selected presentation plugin;
- complete one font end to end before implementing fallback or automatic selection;
- avoid global glyph IDs so multiple fonts can be introduced without an API break;
- keep compiler, subsetting/remapping, compiled IR, SIMD specialization, and runtime baking out of the current slice.

Names below communicate ownership and invariants. They may change before implementation.

## Identity model

```ts
type FontKey = string

declare const fontHandleBrand: unique symbol
type FontHandle = number & { readonly [fontHandleBrand]: true }

type LocalGlyphId = number
type FontSlot = number
```

`LocalGlyphId` is meaningful only inside one registered font. In the first slice it is the source OpenType glyph ID returned by HarfRust. Public/runtime identity is therefore:

```text
(FontHandle, LocalGlyphId)
```

Paragraph output can encode `FontSlot` once per run or instance batch rather than repeating an opaque handle in every internal operation. The layout owns a font table mapping slots back to handles.

No API may assume that glyph `42` in two fonts is the same glyph. A future baker may remap glyph IDs internally, but that must not change the public identity model.

## Text system

```ts
interface TextSystemOptions {
  shaper: RuntimeShaper
  presentations?: readonly PresentationPlugin[]
}

interface TextSystem {
  readonly fonts: FontRegistry

  createParagraph(input: ParagraphInput): Paragraph
  dispose(): void
}
```

The core package should not import all presentation engines. Callers construct the system with the engines they use.

## Font registration

```ts
interface FontDefinition {
  key: FontKey
  opentype: ArrayBufferView
  presentations?: readonly PresentationSource[]
}

interface RegisteredFont {
  readonly key: FontKey
  readonly handle: FontHandle
  readonly metrics: FontMetrics
  readonly capabilities: FontCapabilities

  dispose(): void
}

interface FontRegistry {
  register(definition: FontDefinition): Promise<RegisteredFont>
  get(key: FontKey): RegisteredFont | undefined
  getByHandle(handle: FontHandle): RegisteredFont | undefined
}
```

Registration:

1. validates the source bytes and presentation descriptors;
2. copies or transfers the font bytes into Wasm-owned memory once;
3. creates cached HarfRust font/shaper state;
4. retains presentation ranges for lazy GPU preparation;
5. returns an opaque handle.

The first fixture registers one font. Registry keys, handles, disposal, and run records must already permit many.

## Runtime shaper boundary

```ts
interface ShapeRunRequest {
  font: FontHandle
  textStart: number
  textEnd: number
  direction: 'ltr' | 'rtl'
  script: number
  language: number
  featureStart: number
  featureCount: number
  flags: number
}

interface ShapeBatchRequest {
  textUtf16: Uint16Array
  runs: readonly ShapeRunRequest[]
  features: readonly FontFeature[]
}

interface RuntimeShaper {
  shapeBatch(request: ShapeBatchRequest): ShapedBatchViews
  reshapeRanges(request: ReshapeBatchRequest): ShapedBatchViews
}
```

The bridge will eventually encode requests into persistent Wasm memory rather than marshal these object forms literally. The public rule is one call per batch.

```ts
interface ShapedBatchViews {
  readonly fonts: Uint16Array
  readonly runGlyphStarts: Uint32Array
  readonly runGlyphCounts: Uint32Array

  readonly glyphIds: Uint16Array | Uint32Array
  readonly clusters: Uint32Array
  readonly xAdvances: Int32Array
  readonly yAdvances: Int32Array
  readonly xOffsets: Int32Array
  readonly yOffsets: Int32Array
  readonly flags: Uint16Array
}
```

Invariants:

- clusters are UTF-16 offsets into the original paragraph text;
- glyph IDs are local to the font slot referenced by their shaped run;
- positioning remains in signed design units;
- output views are immutable to callers and valid for a documented lifetime;
- no presentation bounds, atlas data, or rendering technique appears here.

## Paragraph API

```ts
interface ParagraphInput {
  text: string
  font: FontHandle
  spans?: readonly TextSpan[]
  style?: ParagraphStyle
}

interface TextSpan {
  start: number
  end: number
  font?: FontHandle
  fontSize?: number
  language?: string
  features?: readonly FontFeature[]
}

interface Paragraph {
  layout(constraints: ParagraphConstraints): ParagraphLayout
  update(input: ParagraphInput): void
  dispose(): void
}

interface ParagraphConstraints {
  width: number
  height?: number
  maxLines?: number
  wrap?: 'none' | 'word' | 'character'
  align?: 'start' | 'center' | 'end' | 'justify'
  overflow?: 'visible' | 'clip' | 'ellipsis'
}
```

V0 exercises a single default font span. Optional span-level font handles are included now so explicit multi-font content does not require changing paragraph ownership later. Automatic fallback is deferred.

## Layout output

```ts
interface ParagraphLayout {
  readonly fontTable: readonly FontHandle[]
  readonly lines: LayoutLineViews
  readonly runs: LayoutRunViews
  readonly glyphs: LayoutGlyphViews
  readonly width: number
  readonly height: number
  readonly overflowed: boolean
}

interface LayoutGlyphViews {
  readonly fontSlots: Uint16Array
  readonly glyphIds: Uint16Array | Uint32Array
  readonly clusters: Uint32Array
  readonly x: Float32Array
  readonly y: Float32Array
  readonly scale: Float32Array
  readonly flags: Uint16Array
}
```

The paragraph engine may store font identity at run granularity internally. The presentation boundary receives a normalized view with an explicit font slot so it can batch instances by `(font, technique, resource page)`.

## Presentation boundary

```ts
type PresentationKind = 'bitmap' | 'mtsdf' | 'slug'

interface PresentationSource {
  kind: PresentationKind
  data: ArrayBufferView
  metadata: Readonly<Record<string, unknown>>
}

interface PresentationPlugin<Resource = unknown, DrawBatch = unknown> {
  readonly kind: PresentationKind

  supports(font: RegisteredFont): boolean
  prepare(font: RegisteredFont): Promise<Resource>
  buildBatches(layout: ParagraphLayout, resource: Resource): DrawBatch
  dispose(resource: Resource): void
}
```

Selection is explicit:

```ts
const batches = bitmap.buildBatches(layout, bitmapResource)
```

A future recommendation helper may suggest a technique. It must not silently switch engines or make unselected engines part of the core bundle.

## Caching and lifetime

The first implementation needs these cache boundaries:

- registered font state keyed by `FontHandle`;
- HarfRust reusable data and shape plans keyed by font plus segment properties;
- broad shaped runs keyed by text/style/font identity;
- width-dependent layouts keyed separately from broad shaping;
- GPU presentation resources keyed by `(FontHandle, PresentationKind)`.

Disposing a font invalidates paragraphs, layouts, and resources that reference its handle. Stale-handle behavior must be a checked error in development builds.

## Deliberately absent now

- font compiler/baker API;
- subsetting or shaping closure;
- dense glyph remapping;
- compiled shaping lookup provider;
- SIMD or per-font generated Wasm;
- worker baking and persistent baked cache;
- automatic font fallback;
- automatic presentation switching;
- stable React/Three adapter API.

The shapes above leave lanes for these features without requiring them in the one-font path.
