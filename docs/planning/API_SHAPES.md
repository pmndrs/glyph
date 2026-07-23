# Runtime and bake API fixture V0

Status: contract candidate; names may be polished, ownership and data flow may not remain implicit
Scope: baked-first loading, lazy Worker baking, HarfRust Wasm shaping, JavaScript paragraph layout, and explicit presentation loading

## Package boundaries

```text
@pmndrs/text
  browser-safe loader, registry, shaping bridge, paragraph engine

@pmndrs/text/bake
  Node host and CLI over the shared bake core

@pmndrs/text/runtime-bake
  dynamically imported Worker host over the same bake core

@pmndrs/text/presentation/bitmap
@pmndrs/text/presentation/mtsdf
@pmndrs/text/presentation/slug
  independently imported generator/decoder/renderer modules
```

A baked core-font hit does not load the runtime baker or any unselected presentation engine.

## Identity

```ts
type FontKey = string
type PresentationId = string
type Sha256Hex = string

declare const fontHandleBrand: unique symbol
type FontHandle = number & { readonly [fontHandleBrand]: true }

declare const presentationHandleBrand: unique symbol
type PresentationHandle = number & { readonly [presentationHandleBrand]: true }

type LocalGlyphId = number
type FontSlot = number
```

`LocalGlyphId` is meaningful only with a font. Presentations attach only after matching the core font's shaping hash, glyph count, and ID width.

## Loader

```ts
type PresentationKind = 'bitmap' | 'distance-field' | 'slug'

interface FontSource {
  source: string | URL
  baked?: string | URL
}

interface PresentationSelection {
  id?: PresentationId
  kind?: PresentationKind
  required?: boolean
}

interface PresentationResolverContext {
  font: RegisteredFont
  reference: PresentationReferenceV0
  signal?: AbortSignal
}

type PresentationResolver = (
  context: PresentationResolverContext,
) => Promise<ArrayBufferView | undefined>

interface FontLoadOptions {
  presentations?: readonly PresentationSelection[]
  resolvePresentation?: PresentationResolver
  signal?: AbortSignal
}

interface FontLoader {
  load(source: FontSource | string | URL, options?: FontLoadOptions): Promise<RegisteredFont>
  loadPresentation(
    font: RegisteredFont,
    selection: PresentationSelection,
    options?: { resolve?: PresentationResolver; signal?: AbortSignal },
  ): Promise<RegisteredPresentation>
  attachPresentation(
    font: RegisteredFont,
    bytes: ArrayBufferView,
  ): Promise<RegisteredPresentation>
}
```

Resolution order for a selected presentation is fixed:

1. use the companion extension already embedded in the loaded GLB;
2. fetch the directory entry's external URI;
3. call the application resolver when no URI exists or application policy intercepts it;
4. if no baked presentation exists, dynamically import that technique's runtime generator and bake in the Worker;
5. reject when the selection is required and no conforming resource can be produced.

The main `load` call may request zero or more presentations. Loading or attaching one later never re-registers or reshapes the font.

There is no `forceRuntime`, `skipBaked`, or equivalent option. A missing baked core asset warns once in development, loads `runtime-bake`, bakes in a Worker, and feeds the result through the same validator.

## Registered resources

```ts
interface FontMetrics {
  unitsPerEm: number
  ascender: number
  descender: number
  lineGap: number
}

interface RegisteredFont {
  readonly key: FontKey
  readonly handle: FontHandle
  readonly shapingHash: Sha256Hex
  readonly glyphCount: number
  readonly glyphIdWidth: 16
  readonly metrics: FontMetrics
  readonly presentationReferences: readonly PresentationReferenceV0[]
  getPresentation(id: PresentationId): RegisteredPresentation | undefined
  dispose(): void
}

interface RegisteredPresentation {
  readonly id: PresentationId
  readonly handle: PresentationHandle
  readonly font: FontHandle
  readonly kind: PresentationKind
  dispose(): void
}

interface FontRegistry {
  registerAsset(bytes: ArrayBufferView): Promise<RegisteredFont>
  get(key: FontKey): RegisteredFont | undefined
  getByHandle(handle: FontHandle): RegisteredFont | undefined
}
```

Disposal increments the font generation and invalidates stale presentation, shape, layout, and GPU-resource cache entries.

## Shared bake core

```ts
interface BakeRequestV0 {
  source: Uint8Array
  descriptor: BakeDescriptorV0
}

interface BakeDescriptorV0 {
  formatVersion: 0
  fontFaceIndex: number
  presentations: readonly PresentationBakeDescriptorV0[]
}

type PresentationBakeDescriptorV0 =
  | BitmapBakeDescriptorV0
  | DistanceFieldBakeDescriptorV0
  | SlugBakeDescriptorV0

interface BitmapBakeDescriptorV0 {
  id: PresentationId
  kind: 'bitmap'
  ppemX: number
  ppemY: number
  oversample: number
  padding: number
  hinting: 'none'
  coverage: 'grayscale'
  packaging: 'embedded' | 'external'
}

interface DistanceFieldBakeDescriptorV0 {
  id: PresentationId
  kind: 'distance-field'
  technique: 'msdf' | 'mtsdf'
  emSize: number
  pixelRange: number
  padding: number
  edgeColoring: 'simple'
  edgeColoringAngle: number
  edgeColoringSeed: number
  overlapSupport: true
  packaging: 'embedded' | 'external'
}

interface SlugBakeDescriptorV0 {
  id: PresentationId
  kind: 'slug'
  bandCount: 16
  bandEpsilon: 0.0009765625
  textureWidth: 4096
  curvePageRowBudget: 2048
  curveFormat: 'rgba16float'
  bandFormat: 'u32-headers-u16-local-texel-offsets'
  packaging: 'embedded' | 'external'
}

interface BakeArtifactV0 {
  role: 'font' | 'presentation'
  id: string
  bytes: Uint8Array
  sha256: Sha256Hex
}

interface BakeResultV0 {
  artifacts: readonly BakeArtifactV0[]
  report: FontPayloadReportV0
  warnings: readonly BakeWarningV0[]
}
```

All size, range, padding, oversample, and ppem values are finite and positive; `padding` may be zero. `edgeColoringAngle` is radians, `edgeColoringSeed` is an unsigned 32-bit integer, and the generator must produce identical edge colors for identical outlines and descriptors. Slug V0 constants are literal contract values derived from the reviewed uikit packer; changing one requires a descriptor/format version analysis.

`packaging: 'embedded'` places the companion extension in the core font GLB. `external` produces a core font GLB plus one presentation GLB; their internal shaping and presentation bytes are identical to the embedded form. The core is host-independent. Node and Worker hosts add no font-domain defaults. V0 implements the bitmap descriptor first, while the MTSDF and Slug descriptors already fix the configuration and dynamic-module boundary their implementations must honor.

## Node host

```ts
interface NodeBakeOptions {
  input: string | URL
  output: string | URL
  descriptor: Omit<BakeDescriptorV0, 'formatVersion'>
}

declare function bakeFont(options: NodeBakeOptions): Promise<FontPayloadReportV0>
```

For external packaging, `output` names the core artifact and presentation artifact names are deterministically derived from presentation IDs. The Node host owns filesystem work only.

## Worker protocol

```ts
interface RuntimeBakeRequestV0 {
  type: 'bake-font-v0'
  id: number
  source: ArrayBuffer
  descriptor: BakeDescriptorV0
}

interface RuntimeBakeSuccessV0 {
  type: 'bake-font-result-v0'
  id: number
  ok: true
  artifacts: readonly {
    role: 'font' | 'presentation'
    id: string
    bytes: ArrayBuffer
    sha256: Sha256Hex
  }[]
  report: FontPayloadReportV0
}

interface RuntimeBakeFailureV0 {
  type: 'bake-font-result-v0'
  id: number
  ok: false
  error: SerializedBakeErrorV0
}
```

Source and artifact buffers are transferred. The Worker imports only the generators named by the descriptor.

## Shaping API

```ts
interface FontFeature {
  tag: string
  value: number
  start: number
  end: number
}

interface ShapeRunRequest {
  font: FontHandle
  textStart: number
  textEnd: number
  direction: 'ltr' | 'rtl'
  script: string
  language?: string
  clusterLevel: number
  flags: number
  featureStart: number
  featureCount: number
}

interface ShapeBatchRequest {
  textUtf16: Uint16Array
  runs: readonly ShapeRunRequest[]
  features: readonly FontFeature[]
}

interface ReshapeRange {
  run: number
  itemStart: number
  itemEnd: number
  contextStart: number
  contextEnd: number
  flags: number
}

interface ReshapeBatchRequest extends ShapeBatchRequest {
  ranges: readonly ReshapeRange[]
}

interface RuntimeShaper {
  shapeBatch(request: ShapeBatchRequest): ShapedBatchViews
  reshapeRanges(request: ReshapeBatchRequest): ShapedBatchViews
}

interface ShapedBatchViews {
  readonly fontHandles: Uint32Array
  readonly runFontSlots: Uint16Array
  readonly runGlyphStarts: Uint32Array
  readonly runGlyphCounts: Uint32Array
  readonly glyphIds: Uint16Array
  readonly clusters: Uint32Array
  readonly xAdvances: Int32Array
  readonly yAdvances: Int32Array
  readonly xOffsets: Int32Array
  readonly yOffsets: Int32Array
  readonly glyphFlags: Uint16Array
}
```

The implementation packs these public values into the exact 16-byte feature and 32-byte run records in the [shaping ABI](SHAPING_DATA_CONTRACT.md). One API call crosses into Wasm per batch.

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

The JavaScript engine selects breaks in UTF-16 source coordinates. Width changes always reflow. A simple reflow makes zero Wasm calls; all boundary-sensitive line ranges are reshaped in one batch.

## Presentation module boundary

```ts
interface PresentationModule<Resource, DrawBatch> {
  readonly kind: PresentationKind
  decode(
    font: RegisteredFont,
    presentation: RegisteredPresentation,
    signal?: AbortSignal,
  ): Promise<Resource>
  buildBatches(layout: ParagraphLayout, resource: Resource): DrawBatch
  dispose(resource: Resource): void
}
```

`decode` validates and uploads flat records and texture variants. It may dynamically import a KTX2 transcoder when the chosen variant requires one. It cannot alter shaping metrics, glyph identity, line breaks, or layout positions.

## Cache keys

- core loads: source URL/hash + core format + baker version;
- runtime bakes: source hash + descriptor hash + baker/generator versions;
- shape plans: font generation + direction + script + language + features;
- shaped runs: font generation + text range/content + run properties;
- layouts: paragraph version + constraints;
- presentations: font generation + presentation ID + artifact hash + device capability key.

Persistent storage is not required in the first slice; in-flight and completed in-memory deduplication is required.
