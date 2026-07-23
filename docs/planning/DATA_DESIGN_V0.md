# Runtime data design V0

Status: current hardening target; experimental  
Goal: carry one font through offline or fallback baking, runtime shaping, paragraph layout, and one renderer while keeping identities multi-font-safe

## Scope decision

V0 always produces a canonical `PMNDRS_font` asset before registration. The same portable bake core runs behind:

- a Node host used by the CLI and development tooling; and
- a dynamically imported runtime baker library whose browser host executes the core in a Worker after a baked-asset miss.

V0 baking is intentionally simple: validate the source, retain the OpenType data HarfRust needs, generate one bitmap presentation, write deterministic ranges, and stamp provenance. It does not subset, compute shaping closure, densely remap glyphs, or compile GSUB/GPOS into a new IR.

The source OpenType glyph ID is the font-local glyph ID in V0. That choice is contained inside the font asset so later remapping does not change paragraph or renderer APIs.

## Convergent load graph

```text
Node baker library / CLI ───────────────────┐
                                           ▼
                                     shared bake core
                                           ▲
loader baked-asset miss                    │
  → runtime baker library → Worker host ───┘
                                           │
                                           ▼
                               canonical PMNDRS_font bytes
                                           │
                                           ▼
                                    canonical loader
                                      │          │
                                      ▼          ▼
                               HarfRust shaper  GPU presentations
```

No raw-source registration path survives beyond the baker. Offline and runtime-fallback assets use the same validation and registration path.

## Canonical asset envelope

```ts
interface FontAssetV0 {
  version: 0
  font: {
    opentypeBufferView: number
    glyphCount: number
    glyphIdWidth: 16 | 32
    unitsPerEm: number
  }
  provenance: {
    sourceHash: string
    formatVersion: number
    bakerVersion: string
    harfrustVersion: string
    harfbuzzReferenceVersion: string
    unicodeVersion: string
    descriptorHash: string
  }
  presentations: readonly PresentationDescriptorV0[]
}
```

One asset contains one font face. A registry supports many assets. The source font bytes retained here may later be replaced by shaping-only or compiled sections without changing the envelope’s ownership model.

## Runtime font record

```ts
interface FontRecordV0 {
  handle: FontHandle
  key: FontKey
  opentypeBytes: WasmRange
  unitsPerEm: number
  glyphCount: number
  glyphIdWidth: 16 | 32
  ascender: number
  descender: number
  lineGap: number
  capabilities: FontCapabilityBits
  presentations: readonly PresentationRecordV0[]
}
```

The loader validates the asset, copies or transfers the retained shaping bytes into Wasm once, and retains direct typed views over presentation records. It does not construct glyph objects or maps.

## Bake descriptor and determinism

```ts
interface BakeDescriptorV0 {
  formatVersion: 0
  fontFaceIndex: number
  variationInstance: readonly [tag: string, value: number][]
  presentation: { kind: 'bitmap'; ppem: number }
}
```

The descriptor has a canonical serialization and hash. Given identical source bytes, descriptor, bake-core version, and generator version, Node and Worker hosts must produce byte-identical authoritative binary sections. If the surrounding GLB writer introduces non-semantic variation, tests compare normalized sections and hashes until byte determinism is achieved.

Host concerns are excluded from the core:

- filesystem paths and writes;
- URL fetching;
- Worker lifecycle and messaging;
- console warnings;
- CLI argument parsing.

## Presentation directory

```ts
interface PresentationDescriptorV0 {
  kind: 'bitmap' | 'mtsdf' | 'slug'
  version: number
  metadataBufferView: number
  payloadBufferViews: readonly number[]
  required: boolean
}
```

Rules:

- records are keyed by font-local glyph ID;
- presentation metadata never duplicates shaping advances or kerning;
- unknown required kinds reject the asset; unknown optional kinds are skipped;
- each plugin validates its own ranges;
- payloads declare final GPU component formats, strides, dimensions, row layouts, and alignment.

## First bitmap presentation

```ts
interface BitmapPresentationV0 {
  ppemX: number
  ppemY: number
  textureFormat: 'r8unorm'
  atlasWidth: number
  atlasHeight: number
  pageCount: number
  glyphCount: number
  records: BufferRange
  pages: readonly ImageRange[]
}
```

Dense record indexed by local glyph ID:

```text
plane bounds   4 × i16
atlas bounds   4 × u16
page           u16
flags          u16
-------------------
20 bytes per glyph
```

`page = 0xffff` marks no visible bitmap. Plane bounds use a declared fixed-point em convention. Shared OpenType advances remain authoritative for layout.

## Shaped and paragraph data

Shaped output is structure-of-arrays:

```text
run font slots      u16[runCount]
run glyph starts    u32[runCount]
run glyph counts    u32[runCount]
glyph IDs           u16|u32[glyphCount]
clusters            u32[glyphCount]
x/y advances        i32[glyphCount]
x/y offsets         i32[glyphCount]
flags               u16[glyphCount]
```

The JS paragraph engine separates stable text/style analysis and broad shaping from width-dependent line selection, boundary reshaping, placement, ellipsis, and presentation batching.

## Multiple-font invariants

1. Every span refers to a `FontHandle`.
2. Every shaped run carries a font slot.
3. Glyph IDs are never global keys.
4. Layout exposes its font-slot table.
5. Resource lookup uses `(FontHandle, PresentationKind)`.
6. Caches include font handle and asset generation/version.
7. Disposal detects stale references.
8. Each canonical asset contains one face, while a registry holds many.

## Loader state and caching

```text
unresolved
  → baked asset probe
    → baked hit → validate/load
    → miss      → warn in development → import Worker host → bake → validate/load
    → invalid   → structured diagnostic → Worker fallback policy → validate/load
```

V0 deduplicates in-flight and completed work in memory. Cache identity includes source URL or source hash, descriptor hash, format version, and bake-core version. Persistent Cache Storage or IndexedDB is a later addition.

## Copy and allocation budget

Allowed:

- source `ArrayBuffer` transfer to the Worker;
- one final compacting write inside the baker;
- result transfer to the main thread;
- one bulk copy of shaping bytes into Wasm if direct shared ownership is unavailable;
- required GPU upload copies.

Not allowed:

- source parsing or rasterization on the main thread;
- per-run font copies;
- per-glyph JS object output;
- reconstruction of presentation maps;
- numeric repacking before GPU upload;
- a distinct runtime-only font model.

## Validation and resource limits

The baker validates source format and face selection. The canonical loader then independently:

- bounds-checks every range;
- validates version, descriptor hash, glyph count, and ID width;
- validates record stride, count, page indices, dimensions, and alignment;
- rejects unknown required capabilities;
- caps input size, output size, glyph count, atlas dimensions, Worker memory, and elapsed work;
- emits structured errors.

Missing baked assets are ordinary development fallback. Corrupt or incompatible baked assets are diagnostics, not silent misses.

## Future-compatible seams, not V0 work

- subsetting and shaping closure;
- dense packed glyph remapping;
- shaping-only or compiled lookup sections;
- MTSDF and Slug generators behind the same presentation request seam;
- persistent runtime-bake cache;
- progressive generation;
- automatic font fallback;
- variable-font runtime axes.
