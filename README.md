# Glyph

Portable font baking, Unicode shaping, paragraph layout, and batched text rendering for every Canvas.

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
pnpm exec glyph bake --input Inter-Regular.ttf --output Inter.font.glb --bitmap 32 --msdf --slug
```

Subset a font with `--unicodes U+0020-007E` to bake only a fixed range or specific glyphs for smaller font assets.  
For an icon font, `--glyph-map <path>` outputs a JSON table keyed by the glyph name in an icon font like Font Awesome or Lucide.

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
  fonts: { default: 'msdf', formats: {bitmap, msdf, slug} },

  // Encode's the raw glyph data into buffer and resource formats your library will need for rendering
  encode: ({ ids }) => ({ descriptor: exampleCodecDescriptor(ids) }),

  // Resolve a glyph resource to a library specific resource (texture, shader, buffer...)
  resolve: ({ format, resourceName, payload }) => {
    return bindResource({ name: resourceName, resource: payload }), () => destroy());
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
});
```

## Just the shaders

The TSL and TypeGPU shaders are exported from `@pmndrs/glyph/shaders/tsl` and `@pmndrs/glyph/shaders/typegpu`.
You can import them into your custom engine and handle your own font shaping, batching, and loading, while still leveraging the core glyph shaders.

```ts
import { bitmapShader, msdfShader, slugShader } from '@pmndrs/glyph/shaders/tsl';
import { bitmapFragment, bitmapVertexSnapped } from '@pmndrs/glyph/shaders/typegpu';
```

## Roadmap

- Emoji
- Micro JS shaping engine for basic shaping
- Editorial flow / polygon cut-outs
- Glyph page cache
- Language aware word breaks

Glyph currently provides fonts, styles, alignment, justification, word-wrap, box constraints, editorial columns, icon fonts, decorations, CJK, break-apart glyphs, bitmap/msdf/slug rendering, tsl, typegpu, custom integration api, wasm engine with SIMD shaping kernels, and runtime/offline font baking.

## Contribute

This repo uses [mise](https://mise.jdx.dev) to make it easier to install and configure the required toolchains.
Install [Git LFS](https://git-lfs.com/) to download the fixtures and assets, which are stored outside ordinary Git history.
Trust the checked-in configuration once per fresh clone before asking mise to install them:

```sh
# brew install mise
git lfs install
git lfs pull
mise trust
mise install
mise exec -- pnpm install
mise exec -- pnpm dev
```

The benchmark application lives in [`benches/`](benches/). `pnpm dev` opens its interactive harness;
`pnpm scripts list` lists automated benchmarks and fixture generation commands. CI checks out LFS objects before
building or testing. Asset paths remain ordinary local files after `git lfs pull`.

Mise is optional. With matching Node, pnpm, and Rust tools already on `PATH`, use `pnpm install` and `pnpm dev`
directly. Repository checks and commit-time documentation digest maintenance use the same pinned Node.js runtime.

`@pmndrs/glyph` is ESM-only and MIT licensed.
