# Glyph

A typography engine for all your web graphics. Portable font baking, Unicode shaping, paragraph layout, batched text rendering and more.

```sh
pnpm add @pmndrs/glyph three
```

```ts
import { glyph, msdf } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';

await glyph.init();
const three = glyph.handle('main', ThreeConfig);

const Inter = await glyph.fontFace('/fonts/Inter.font.glb', { format: msdf }).load();

const label = three.createText({
  font: Inter,
  text: 'Hello Glyph',
  style: { fontSize: 32, lineHeight: 1.2, color: '#f4f7ff' },
  layout: { align: 'center' },
});

scene.add(label);

glyph.shape();

renderer.render(scene, camera);
```

## Bake fonts

The `glyph` CLI bakes fonts into glb files containing bitmap, msdf, and/or slug font data.
While glyph supports runtime and offline baking, baked fonts require minimal additional processing and load quickly.

```sh
pnpm glyph bake --input Inter-Regular.ttf --output Inter.font.glb --bitmap 32 --msdf --slug
```

Subset a font with `--unicodes U+0020-007E` to bake only a fixed range or specific glyphs for smaller font assets.  
For an icon font, `--glyph-map <path>` outputs a JSON table keyed by the glyph name in an icon font like Font Awesome or Lucide.  
Add `--outlines` to also keep every glyph's outline: inside `text.withGlyphs((glyphs) => ...)`, `glyphs.outlineAt(index)` returns that laid-out glyph's closed quadratic contours where it sits in the paragraph, for any raster format, for uses such as physics colliders.

## Measure text

You can measure text bounds and font metrics with `Text.measure()`.  
Use `Text.glyphs()` if you need per glyph position and layout metrics, this can incur a small overhead if used before the text is shaped.

```ts
const label = three.createText({
  font: Inter,
  text: 'Hello Glyph',
  style: { fontSize: 32, lineHeight: 1.2, color: '#f4f7ff' },
  layout: { align: 'center' },
});

const { width, height, ascent, descent, lineHeight } = label.measure();
const { glyphCount, glyphInkX, glyphInkY } = label.glyphs();
const [x, y] = [glyphInkX[0], glyphInkY[0]];
```

## React Three Fiber

Use `@pmndrs/glyph/react` for @react-three/fiber integration.

R3F 9.7+ and v10 are supported. For v9, pass an initialized `WebGPURenderer` through Canvas's async `gl` factory. See the [R3F WebGPU setup guide](https://r3f.docs.pmnd.rs/api/canvas#webgpu).

```tsx
import { GlyphProvider, Text, TextGroup, useSlug } from '@pmndrs/glyph/react';

useSlug.preload('/fonts/Inter.font.glb');

<GlyphProvider handle="hud" fontFaces={{ Inter: '/fonts/Inter.font.glb' }}>
  <Text font="Inter">Hello, HUD</Text>
</GlyphProvider>;
```

A `GlyphProvider` can be used to load and map fonts to a string name allowing you to refer to the font by name anywhere under the provider. The provider also acts as an optional Suspense and Error boundary to handle glyph errors or suspend while loading fonts.

## TypeGPU

You can use TypeGPU over TSL in three.js by importing the `ThreeConfig` from `@pmndrs/glyph/three/typegpu`.

```ts
import { ThreeConfig } from '@pmndrs/glyph/three/typegpu';
```

For TypeGPU applications, use the `defineTypeGpuConfig` from `@pmndrs/glyph/typegpu`.

```ts
import { defineTypeGpuConfig } from '@pmndrs/glyph/typegpu';

const root = await tgpu.init();
const CustomTypeGPUConfig = defineTypeGpuConfig({
  root,
  format: navigator.gpu.getPreferredCanvasFormat(),
  //...
});

const handle = glyph.handle('custom:typegpu', CustomTypeGPUConfig);

const encoder = root['~unstable'].createCommandEncoder();
const pass = encoder.beginRenderPass(/* ... */);

glyph.shape();

handle.draw(pass, { width: canvas.clientWidth, height: canvas.clientHeight });
```

See the [TypeGPU hello world](apps/typegpu-hello-world/README.md) example for more details.

## Integrate with a custom renderer

The core font engine in glyph is platform and framework neutral. A `GlyphConfig` defines the implementation of how glyphs are rendered in your target rendering library. `ThreeConfig` is pre-configured for the three.js integration. A config is made up of mapping, transformations, and config options similar to a bundler config.

```ts
export const CustomConfig = defineGlyphConfig({
  // Attach metadata to glyph defined resources
  schema: ExampleSchema,

  // Register supported font formats
  fonts: { default: 'msdf', formats: { bitmap, msdf, slug } },

  // Encode's the raw glyph data into buffer and resource formats your library will need for rendering
  encode: ({ ids }) => ({ descriptor: exampleCodecDescriptor(ids) }),

  // Resolve a glyph resource to a library specific resource (texture, shader, buffer...)
  resolve: ({ format, resourceName, payload }) => {
    return resourceLease(bindResource({ name: resourceName, resource: payload }), () => destroy());
  },

  // Render the glyphs. Decode the plan, synchronize library transforms, dispose of resources when glyph releases them
  renderer: () => {
    const selectedDevice = device ?? new RecordingExampleRendererDevice();
    return {
      decode: (view) => selectedDevice.decode(view),
      syncTransforms: () => undefined,
      dispose: () => selectedDevice.reset(),
    };
  },

  // Create the renderer-specific root extension and connect it to Glyph's retained root
  root: {
    create: (context) => {
      const extension = new CustomRoot(context.fonts, context.services);
      return context.create(extension, {
        boundary: { name: context.name },
        shape: { accepted: (drawList) => extension.accept(drawList) },
      });
    },
  },
});
```

## Just the shaders

The TSL and TypeGPU shaders are exported from `@pmndrs/glyph/shaders/tsl` and `@pmndrs/glyph/shaders/typegpu`.
You can import them into your custom engine and handle your own font shaping, batching, and loading, while still leveraging the core glyph shaders.

```ts
import { bitmapShader, msdfShader, slugShader } from '@pmndrs/glyph/shaders/tsl';
import { bitmapFragment, bitmapVertexSnapped } from '@pmndrs/glyph/shaders/typegpu';
```

## Feature status

Glyph is pre-release and its features may change with time. **✅ Stable** is the supported baseline, **🟡 Partial** has the gaps listed below, and **🧪 Experimental** is available but still being evaluated.

| Feature                              | Status          | Support and limitations                                                                                                          |
| ------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Fonts and rich-text styles           | ✅ Stable       | Mixed-font spans, font fallback, size, color, and spacing.                                                                       |
| Unicode shaping                      | ✅ Stable       | Complex scripts, ligatures, bidirectional text, and grapheme-aware boundaries.                                                   |
| Alignment and justification          | ✅ Stable       | Paragraph alignment, word spacing, first-line indent, and paragraph spacing.                                                     |
| Word wrap and box constraints        | ✅ Stable       | Unicode line breaking, width/height constraints, clipping, and ellipsis. Language-specific breaking is future work.              |
| Text measurement                     | ✅ Stable       | Text bounds, font metrics, and per-glyph layout queries.                                                                         |
| Editorial flow and polygon cut-outs  | ✅ Stable       | Authored regions and exclusions, projected 3D contours, and drop caps.                                                           |
| Icon fonts                           | ✅ Stable       | Font-based icons, raster subsetting, and glyph-name maps.                                                                        |
| Break-apart glyphs                   | ✅ Stable       | Detached glyph and decoration copies with independent transforms. Copies do not follow later source-text edits.                  |
| Bitmap rendering                     | ✅ Stable       | Baked size-specific strikes. No outline or shadow effects.                                                                       |
| MSDF rendering                       | ✅ Stable       | MTSDF atlases with outline and hard-shadow effects.                                                                              |
| Slug rendering                       | ✅ Stable       | Vector-outline rendering. No outline or shadow effects.                                                                          |
| Three.js, React Three Fiber, and TSL | ✅ Stable       | WebGPU and WebGL2 through `WebGPURenderer`. Standalone TSL shaders are also available. Classic `WebGLRenderer` is not supported. |
| Custom renderer integration          | ✅ Stable       | Renderer-neutral `GlyphConfig` API and custom raster/baker extensions.                                                           |
| Wasm engine and SIMD kernels         | ✅ Stable       | HarfRust shaping and retained Rust layout with SIMD-optimized kernels.                                                           |
| Runtime and offline font baking      | ✅ Stable       | Node API/CLI baking and browser Worker baking for Bitmap, MSDF, and Slug.                                                        |
| Editorial columns                    | 🟡 Partial      | Sequential column flow. Automatic column balancing is not implemented.                                                           |
| Text decorations                     | 🟡 Partial      | Solid underline, overline, and strikethrough. Double, dotted, dashed, and wavy styles are not implemented.                       |
| CJK                                  | 🟡 Partial      | Horizontal shaping and layout. Large-coverage paging and vertical writing are future work.                                       |
| Direct TypeGPU rendering and shaders | 🧪 Experimental | Bitmap, MSDF, and Slug in caller-owned WebGPU render passes, plus standalone shader exports.                                     |
| TypeGPU shaders in Three.js          | 🧪 Experimental | WebGPU and WebGL2 adapters. Full visual parity with the native TSL path is not yet established.                                  |

## Roadmap

Future work includes:

- **Color emoji.** Color glyph layers and bitmap resources.
- **Micro JS shaping engine.** A small alternative for basic shaping.
- **Glyph page cache.** On-demand raster pages, residency limits, and eviction for large CJK and icon fonts.
- **Language-aware word breaks.** Dictionary segmentation, locale-specific rules, and automatic hyphenation.
- **Expanded editorial layout.** Balanced columns and flow around rendered-pixel or depth-buffer occlusion.
- **Vertical writing.** Vertical CJK shaping and paragraph layout.
- **Live per-glyph transforms.** Deformation that continues to follow retained text updates.

## Contribute

Install [Git LFS](https://git-lfs.com/) for fixtures and assets. [Mise](https://mise.jdx.dev) is optional and installs the required tool versions for you. To set up with mise:

```sh
git lfs install
git lfs pull
mise trust
mise install
mise exec -- pnpm install
mise exec -- pnpm scripts run repo:hooks:install
mise exec -- pnpm dev
```

The hook installer writes only the native `pre-commit` dispatcher in Git's shared common directory. Every worktree in the
clone therefore uses the same hook without `core.hooksPath` or Lefthook configuration. The hook auto-formats and applies
safe lint fixes to fully staged source files, re-stages those fixes, and then validates documentation digests. Existing
Git LFS hooks such as `pre-push`, `post-checkout`, `post-commit`, and `post-merge` are not changed.

The benchmark application lives in [`benches/`](benches/). `pnpm dev` opens its interactive harness;
`pnpm scripts list` lists automated benchmarks and fixture generation commands. CI checks out LFS objects before
building or testing. Asset paths remain ordinary local files after `git lfs pull`.

If you already have the pinned Node, pnpm, and Rust versions installed, you can run pnpm commands without `mise exec --`.

`@pmndrs/glyph` is ESM-only and MIT licensed.
