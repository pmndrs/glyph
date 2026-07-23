# Runtime and bake API shapes

Status: current hardening target; provisional and not a public API commitment  
Scope: one-font vertical slice with required offline baking and automatic worker fallback

## Design constraints

The first implementation must:

- use one portable bake core from both a Node host and a browser Worker host;
- make a pre-baked `PMNDRS_font` sidecar the normal loader path;
- dynamically import the Worker host and presentation generator only after a sidecar miss;
- warn once in development when runtime baking was required;
- feed offline and fallback output through the same canonical asset loader;
- provide no `forceRuntime`, `skipBaked`, or equivalent public option;
- shape at runtime with HarfRust Wasm in coarse batches;
- lay out constrained paragraphs in TypeScript/JavaScript;
- render through an explicitly selected, optional presentation plugin;
- avoid global glyph IDs so multiple fonts remain additive;
- defer subsetting, dense remapping, compiled lookup IR, SIMD specialization, and generalized compiler optimization.

The baker is required infrastructure. The advanced OpenType compiler discussed in the research is not required for V0.

## Package and import boundaries

```text
@pmndrs/text
  loader, registry, shaper bridge, paragraph API

@pmndrs/text/bake
  Node-only host and CLI surface

@pmndrs/text/runtime-bake
  browser Worker host; imported internally only on sidecar miss

@pmndrs/text/presentation/bitmap
@pmndrs/text/presentation/mtsdf
@pmndrs/text/presentation/slug
  independently selectable/importable presentation engines
```

The main entry must not statically reach Node modules, the bake Wasm, atlas generators, Slug conversion, or MTSDF tooling. Package-graph tests enforce this.

## Identity model

```ts
type FontKey = string

declare const fontHandleBrand: unique symbol
type FontHandle = number & { readonly [fontHandleBrand]: true }

type LocalGlyphId = number
type FontSlot = number
```

`LocalGlyphId` is meaningful only inside one registered font. V0 may preserve the source OpenType glyph ID. Public/runtime identity is always:

```text
(FontHandle, LocalGlyphId)
```

A later baker may remap IDs internally without changing paragraph or renderer APIs.

## Loader API

```ts
type PresentationKind = 'bitmap' | 'mtsdf' | 'slug'

interface FontLoadOptions {
  presentation: PresentationKind
  signal?: AbortSignal
}

interface FontLoader {
  load(sourceURL: string | URL, options: FontLoadOptions): Promise<RegisteredFont>
}
```

There is deliberately no option that forces the runtime path. `load` follows one state machine:

```text
derive and fetch baked sidecar
  hit  → validate canonical bytes → register
  miss → development warning once
       → dynamically import runtime-bake Worker host
       → fetch/transfer source font
       → bake canonical bytes
       → validate canonical bytes → register
```

The selected presentation is explicit. Selection determines which optional generator the fallback imports; it does not change shaping or paragraph data.

## Shared bake request

This host-independent contract is used by the Node host and Worker host:

```ts
interface BakeRequestV0 {
  source: Uint8Array
  presentation: PresentationBakeRequestV0
  sourceName?: string
}

type PresentationBakeRequestV0 =
  | { kind: 'bitmap'; ppem: number }
  | { kind: 'mtsdf'; emSize: number; pixelRange: number }
  | { kind: 'slug' }

interface BakeResultV0 {
  bytes: Uint8Array
  diagnostics: BakeDiagnosticsV0
}

interface BakeDiagnosticsV0 {
  sourceHash: string
  glyphCount: number
  outputBytes: number
  presentationBytes: number
  elapsedMs: number
  warnings: readonly BakeWarningV0[]
}
```

V0 implements one complete bitmap request first. The union fixes the extensibility seam without requiring every generator.

## Node bake surface

```ts
interface NodeBakeOptions {
  input: string | URL
  output?: string | URL
  presentation: PresentationBakeRequestV0
}

declare function bakeFont(options: NodeBakeOptions): Promise<BakeDiagnosticsV0>
```

The Node host owns filesystem and CLI concerns only. It calls the shared core used by the Worker and writes the returned canonical bytes. A standalone `text-font-bake` command and any future dispatcher call the same function.

## Internal Worker protocol

```ts
interface RuntimeBakeMessageV0 {
  id: number
  source: ArrayBuffer
  request: Omit<BakeRequestV0, 'source'>
}

interface RuntimeBakeSuccessV0 {
  id: number
  ok: true
  bytes: ArrayBuffer
  diagnostics: BakeDiagnosticsV0
}

interface RuntimeBakeFailureV0 {
  id: number
  ok: false
  error: SerializedBakeErrorV0
}
```

Source and result buffers are transferred, not cloned. The Worker host is an implementation detail of the loader, not an alternate user-facing font API.

## Font registration

```ts
interface RegisteredFont {
  readonly key: FontKey
  readonly handle: FontHandle
  readonly metrics: FontMetrics
  readonly capabilities: FontCapabilities
  dispose(): void
}

interface FontRegistry {
  registerAsset(bytes: ArrayBufferView): Promise<RegisteredFont>
  get(key: FontKey): RegisteredFont | undefined
  getByHandle(handle: FontHandle): RegisteredFont | undefined
}
```

Only canonical asset bytes enter registration. There is no second registration path for raw OpenType data.

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

Clusters are UTF-16 offsets. Positions remain signed design units. No presentation data crosses this boundary.

## Paragraph API

```ts
interface ParagraphInput {
  text: string
  font: FontHandle
  spans?: readonly TextSpan[]
  style?: ParagraphStyle
}

interface ParagraphConstraints {
  width: number
  height?: number
  maxLines?: number
  wrap?: 'none' | 'word' | 'character'
  align?: 'start' | 'center' | 'end' | 'justify'
  overflow?: 'visible' | 'clip' | 'ellipsis'
}

interface Paragraph {
  layout(constraints: ParagraphConstraints): ParagraphLayout
  update(input: ParagraphInput): void
  dispose(): void
}
```

Width changes reflow in JS. Boundary-sensitive ranges are reshaped in one batched Wasm call when required.

## Presentation boundary

```ts
interface PresentationPlugin<Resource = unknown, DrawBatch = unknown> {
  readonly kind: PresentationKind
  supports(font: RegisteredFont): boolean
  prepare(font: RegisteredFont): Promise<Resource>
  buildBatches(layout: ParagraphLayout, resource: Resource): DrawBatch
  dispose(resource: Resource): void
}
```

Preparation consumes flat asset ranges. It must not reconstruct a glyph map or repeat shaping metrics.

## Caching and warnings

Required V0 caches:

- in-flight and completed loads keyed by source URL, bake descriptor, and format/compiler version;
- registered HarfRust state and reusable shape plans;
- broad shaped runs and width-dependent layouts;
- GPU resources by `(FontHandle, PresentationKind)`.

Persistent browser storage is a later optimization. The first fallback may use memory caching.

On a sidecar miss, the loader emits one development-only warning per source URL. It names the source, states that worker baking occurred, and points to the Node bake command. Production does not warn. Corrupt or incompatible sidecars produce a structured diagnostic before fallback rather than masquerading as a normal miss.

## Deliberately absent now

- subsetting and shaping closure;
- dense glyph remapping;
- compiled GSUB/GPOS IR or alternate HarfRust lookup provider;
- SIMD or per-font generated Wasm;
- runtime variable axes;
- automatic font fallback;
- automatic presentation switching;
- progressive or incremental baking;
- stable React/Three adapter API.
