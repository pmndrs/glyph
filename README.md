# pmndrs/text

`pmndrs/text` is a planned renderer-independent text system for JavaScript, WebGPU, and WebGL. It will shape Unicode text once, reflow it inside constrained regions, and render the same positioned glyphs through explicitly selected bitmap, MTSDF, or Slug presentations.

This repository is currently a reviewed design fixture: the APIs and binary contracts below describe what will be implemented, but no production package has shipped yet.

## Planned API at a glance

The normal path loads a pre-baked core font and only the presentation requested by the application:

```ts
import { createFontLoader, createParagraphEngine } from '@pmndrs/text'
import { bitmap } from '@pmndrs/text/presentation/bitmap'

const fonts = createFontLoader()
const paragraphs = createParagraphEngine()

const font = await fonts.load(
  {
    source: new URL('./Inter-Regular.ttf', import.meta.url),
    baked: new URL('./Inter-Regular.font.glb', import.meta.url),
  },
  {
    presentations: [{ id: 'ui-16', kind: 'bitmap', required: true }],
  },
)

const paragraph = paragraphs.create({
  text: 'Fast, accurate text that reflows.',
  font: font.handle,
})

const layout = paragraph.layout({
  width: 420,
  maxLines: 3,
  wrap: 'word',
  overflow: 'ellipsis',
})

const registered = await fonts.loadPresentation(font, { id: 'ui-16' })
const resource = await bitmap.decode(font, registered)
const drawBatch = bitmap.buildBatches(layout, resource)
```

Changing width reflows the paragraph. Ordinary width-only reflow reuses shaped clusters; boundary-sensitive lines are reshaped together in at most one batched Wasm call.

```ts
const narrow = paragraph.layout({ width: 260, wrap: 'word' })
```

Changing presentation does not reshape or remeasure the text:

```ts
import { slug } from '@pmndrs/text/presentation/slug'

const slugPresentation = await fonts.loadPresentation(font, { kind: 'slug' })
const slugResource = await slug.decode(font, slugPresentation)
const slugBatch = slug.buildBatches(layout, slugResource)
```

Applications that ship ordinary font files still use the same loader. If the baked asset is missing, the loader warns once in development, dynamically imports the runtime baker library, performs the bake in a Worker, and registers the resulting canonical bytes through the same path. There is intentionally no option to force or bypass fallback baking.

Pre-baking uses the Node host over the same portable bake core:

```ts
import { bakeFont } from '@pmndrs/text/bake'

await bakeFont({
  input: new URL('./Inter-Regular.ttf', import.meta.url),
  output: new URL('./Inter-Regular.font.glb', import.meta.url),
  descriptor: {
    fontFaceIndex: 0,
    presentations: [
      {
        id: 'ui-16',
        kind: 'bitmap',
        ppemX: 16,
        ppemY: 16,
        oversample: 2,
        padding: 1,
        hinting: 'none',
        coverage: 'grayscale',
        packaging: 'embedded',
      },
    ],
  },
})
```

See the [planned API walkthrough](docs/tutorials/API_PREVIEW.md) for lifecycle, split presentation loading, and renderer switching. The exact interfaces live in the [V0 API reference](docs/planning/API_SHAPES.md).

## What gets built first

The first internal vertical slice takes one pinned font through both delivery paths and one generated bitmap presentation. It proves the product end to end; it is not a shippable release:

1. freeze the API, identity, GLB, and Worker boundaries;
2. pin the font and capture HarfBuzz/HarfRust, bitmap, layout, and payload oracles;
3. build the portable bake core and Node host;
4. build the baked-first loader and lazy Worker fallback;
5. add coarse-grained HarfRust Wasm shaping;
6. add JavaScript paragraph reflow;
7. upload and render the bitmap presentation on WebGPU and WebGL2;
8. harden identity, cancellation, malformed input, package separation, and benchmarks for the proof.

The first shippable release requires all three presentation engines: generated bitmap, MTSDF, and Slug. MTSDF and Slug begin only after the bitmap proof establishes correct interfaces, but they are release blockers—not optional post-release ideas. Color emoji, SVG icon-font artwork, multi-font fallback, compiled shaping data, and SIMD retain separate roadmap lanes. The [canonical roadmap](docs/roadmap/ROADMAP.md) names every deliverable, dependency, effort estimate, and exit gate.

## System artifacts

| Artifact | Role | First appears |
| --- | --- | --- |
| Core font GLB with `PMNDRS_font` | Shaping face, shared metrics, provenance, presentation directory | portable baker |
| Optional presentation GLB | Bitmap, MTSDF, or Slug GPU resources bound to the core identity | bitmap proof; all three by V1 |
| Shared bake core library | Host-independent source-font transformation | portable baker |
| `@pmndrs/text/bake` | Node API and thin CLI | portable baker |
| Dynamically loaded runtime baker library | Worker host using the same bake core | loader fallback |
| HarfRust shaper Wasm | Runtime shaping with coarse batch calls | shaping milestone |
| JavaScript paragraph engine | Constraints, line breaking, reflow, and layout caching | paragraph milestone |
| Presentation modules | Optional decode/upload/batch construction per technique | bitmap proof; all three by V1 |
| Interactive benchmark lab | Shared scenarios, target adapters, live phase timing, payload comparison, and reproducible result export | fixture milestone |

The [artifact map](docs/roadmap/ARTIFACTS.md) defines their ownership and required fixtures.

## Renderer guidance

Applications select presentations explicitly; the package does not silently switch techniques.

| Need | Planned recommendation |
| --- | --- |
| General-purpose UI and scalable text | MTSDF after its implementation and benchmarks |
| Tiny text at known pixel sizes | Generated bitmap strikes |
| Large text, extreme zoom, complex outlines, color vector layers | Slug |
| Pixel-art or intentionally raster typography | Bitmap |

Bitmap is implemented first because it is the smallest end-to-end proof, not because it is the eventual general-purpose default. Windfoil remains outside the text roadmap. See the [renderer capability matrix](docs/planning/RENDERER_CAPABILITIES.md).

## Documentation map

- [Documentation index](docs/index.md) — canonical navigation for people and agents.
- [Canonical roadmap](docs/roadmap/ROADMAP.md) — exact implementation order and gates.
- [Artifact map](docs/roadmap/ARTIFACTS.md) — what each phase must produce.
- [Benchmark lab and methodology](docs/planning/BENCHMARK_PLAN.md) — interactive comparison harness, headless runner, measurements, and gates.
- [Project brief](docs/planning/PROJECT_BRIEF.md) — product outcome and scope.
- [Architecture](docs/planning/ARCHITECTURE.md) — system boundaries and invariants.
- [Research bibliography](RESEARCH.md) — cited papers, articles, libraries, and extracted findings.
- [Documentation audit](docs/DOCUMENTATION_AUDIT.md) — contradictions found and disposition of every prior planning document.

The existing [Three Flatland Slug package](https://github.com/thejustinwalsh/three-flatland/tree/main/packages/slug) is prior art. `pmndrs/text` is intended to become the shipping package, with Three Flatland eventually consuming it.
