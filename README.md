# pmndrs/text

Unicode-aware text for Three.js and React Three Fiber, with portable font baking and explicit Bitmap, MTSDF, and Slug
renderers.

> [!IMPORTANT]
> `pmndrs/text` is in active development toward a public v1 API. The implementation is substantially complete and usable
> from this workspace, but the packages are still private and have not been published to npm.

The engine shapes text once with HarfRust, lays it out as a paragraph, and renders the same positioned glyphs through the
raster technique selected by the application. Font artifacts can be prepared ahead of time or generated in a Worker when a
baked asset is unavailable.

- Native ESM for modern JavaScript runtimes.
- Framework-neutral `THREE.Group` text objects and a thin React Three Fiber component.
- Unicode 17 bidi, line breaking, grapheme segmentation, complex-script shaping, and horizontal CJK layout.
- Bitmap strikes, MTSDF atlases, and analytic Slug outlines over one shaping and layout result.
- Baked-first delivery with authenticated runtime fallback.
- Retained glyph storage for warm text, layout, paint, font, and raster updates.
- Public raster and baker contracts that third-party packages can implement without importing core internals.
- WebGPU and WebGL2 product paths exercised by the benchmark and Presentation application.

The [roadmap](docs/roadmap/roadmap.md) records exact milestone status. The v1 renderer and API milestone is closed in the
workspace; release packaging, documentation, and API stabilization are still in progress.

## Quick start

Run the repository from source with the pinned Node.js, pnpm, and Rust toolchains:

```sh
git clone git@github.com:pmndrs/text.git
cd text
mise install
pnpm install
pnpm dev
```

`pnpm dev` starts the benchmark and Presentation app. Mise is the easiest way to install the exact tool versions, but the
same pnpm commands work when compatible versions are already installed.

## Render text

### React Three Fiber

`@pmndrs/text/react` uses React Suspense for cold font, shaper, and raster loading. Nested `Text` elements become styled
spans in one paragraph and one Three.js object.

```tsx
import { Suspense } from 'react';
import { defineFont } from '@pmndrs/text';
import { Text } from '@pmndrs/text/react';
import { msdf } from '@pmndrs/text/raster/msdf';

const uiFont = defineFont('/fonts/Inter-Regular.ttf', msdf);

export function Label() {
  return (
    <Suspense fallback={null}>
      <Text font={uiFont} width={4} fontSize={0.24} color="white" textAlign="center">
        Fast, <Text color="#ff8a00">accurate</Text> text.
      </Text>
    </Suspense>
  );
}
```

Preload a font token before a route or scene transition when the application knows it will be needed:

```ts
import { useFont } from '@pmndrs/text/react';

await useFont.preload(uiFont);
```

### Three.js

The core `Text` class owns a normal Three.js lifecycle. Its asynchronous generation becomes renderable through ordinary
matrix updates, and warm property changes retain the object while the replacement generation is prepared.

```ts
import { Text, defineFont } from '@pmndrs/text';
import { msdf } from '@pmndrs/text/raster/msdf';

const uiFont = defineFont('/fonts/Inter-Regular.ttf', msdf);
const label = new Text({
  font: uiFont,
  text: 'Fast, accurate text.',
  width: 4,
  fontSize: 0.24,
  color: 'white',
});

scene.add(label);
await label.ready;

label.setProperties({ text: 'Updated without replacing the Text object.' });

// Later, when removing it from the scene:
label.dispose();
```

Passing a source-font URL uses baked-first delivery: the loader probes the canonical sibling font artifact, validates it,
and falls back to the package-owned Worker baker when necessary. Use `{ baked: '/fonts/Inter.font.glb' }` when an application
must require a prebuilt artifact and never fall back to source.

## Choose a renderer

Raster selection is explicit. The package does not silently exchange visual techniques at runtime.

| Renderer | Use it for                                                        | Import                       |
| -------- | ----------------------------------------------------------------- | ---------------------------- |
| MTSDF    | General-purpose scalable UI and scene text                        | `@pmndrs/text/raster/msdf`   |
| Bitmap   | Tiny text at known pixel sizes or intentionally raster typography | `@pmndrs/text/raster/bitmap` |
| Slug     | Large text, extreme zoom, and accurate monochrome outlines        | `@pmndrs/text/raster/slug`   |

Bitmap strikes and their bake-time coverage are declared with the font:

```ts
import { defineFont } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/raster/bitmap';

const bodyFont = defineFont(
  '/fonts/Inter-Regular.ttf',
  bitmap({
    strikes: [16, 32],
    coverage: { text: 'The text and icons this application ships.' },
  }),
);
```

See the [renderer capability matrix](docs/planning/renderer-capabilities.md) for supported content, effects, and constraints.

## Bake fonts ahead of time

The workspace CLI discovers statically declared fonts and raster requirements and writes authenticated GLB artifacts:

```sh
pnpm bake --project-root . --entry src/text.ts --asset-root public --output-root public
```

Use `pnpm bake --help` for CLI options. The Node API is available from `@pmndrs/text/bake` for custom build systems; the
[API contract](docs/planning/api-shapes.md) describes discovery, loading, caching, Workers, and artifact ownership.

## How the pieces fit

```text
source font ──► font baker ──► authenticated core GLB ──► HarfRust shaping
     │                                                            │
     └────────► selected raster baker ──► raster GLB/pages         ▼
                                                    paragraph layout
                                                           │
                                                           ▼
                                             Three.js Text / React Text
```

The core artifact owns shaping data, font metrics, provenance, and the font-local glyph identity space. Raster artifacts own
only technique-specific GPU data and bind back to that core identity. Applications can package them together or fetch them
independently without reshaping the paragraph for each renderer.

Third-party raster implementations use the same public contracts as the built-in techniques. Start with the
[raster and baker plugin guide](docs/planning/raster-baker-plugin.md); the private
[`@pmndrs/text-glyph-example-raster`](packages/glyph-example-raster) package is the executable external-package proof.

## Repository commands

The contributor-facing command surface is intentionally small:

| Command        | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `pnpm bake`    | Build and run the workspace font-baking CLI.                    |
| `pnpm dev`     | Start the benchmark and Presentation application.               |
| `pnpm build`   | Build every package and application.                            |
| `pnpm test`    | Run deterministic package and product tests.                    |
| `pnpm check`   | Run the complete merge gate, including tests and documentation. |
| `pnpm scripts` | Discover specialized maintenance and evidence workflows.        |

Specialized commands explain their own requirements and outputs:

```sh
pnpm scripts list
pnpm scripts list presentation
pnpm scripts show benchmark:presentation
pnpm scripts run benchmark:presentation
```

Hardware WebGPU/WebGL2 screenshots and performance measurements remain explicit local workflows because hosted CI cannot
provide representative GPU timing or driver coverage. Deterministic package, browser, conformance, build, and documentation
checks run through `pnpm check`.

## Documentation

The README is the short path into the project. Deeper documentation is organized by what the reader needs next:

- **Learn:** run the [benchmark and Presentation app](docs/packages/benchmarks.md) and follow the examples above.
- **Use:** consult the [API contract](docs/planning/api-shapes.md), [raster plugin guide](docs/planning/raster-baker-plugin.md),
  and [uikit integration guidance](docs/planning/uikit-integration.md).
- **Look up:** use the [workspace package catalog](docs/packages/index.md),
  [renderer capability matrix](docs/planning/renderer-capabilities.md), and
  [`PMNDRS_font` extension schemas](docs/planning/extensions/index.md).
- **Understand:** read the [architecture](docs/planning/architecture.md), [canonical roadmap](docs/roadmap/roadmap.md), and
  [attributed research](RESEARCH.md).

The documentation under [`docs/`](docs/index.md) is also an Open Knowledge Format v0.2 bundle with package-source freshness
checks, provenance, and progressive-disclosure indexes.

## Current scope

The workspace already implements the v1 shaping, horizontal paragraph, delivery, Three.js/React, and three-raster foundation.
The roadmap keeps post-v1 work explicit: editorial flow regions, mixed-font fallback, large-coverage CJK raster paging, color
emoji, expanded effects, and vertical writing.

`pmndrs/text` is MIT licensed. Contributions are welcome while the public v1 surface is being stabilized.
