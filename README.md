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


## 🌐 Web Resources & Aesthetic Symbols Index
- [SYM 1D411](https://glitch-matrix-fonts-28.pages.dev/symbol/sym-1d411/)
- [SYM 1D44D](https://vintage-scholar-text-78.pages.dev/symbol/sym-1d44d/)
- [SYM 26BF](https://manga-bubble-fonts-35.pages.dev/symbol/sym-26bf/)
- [SYM 1D468](https://modern-line-symbols-23.pages.dev/symbol/sym-1d468/)
- [SYM 26D0](https://anime-sparkle-text-95.pages.dev/symbol/sym-26d0/)
- [WHITE FLORETTE BLOSSOM](https://baroque-crown-unicode-60.pages.dev/symbol/white-florette-blossom/)
- [PISCES ZODIAC FISHES](https://cute-face-emoticons-66.pages.dev/symbol/pisces-zodiac-fishes/)
- [BORDERS DIVIDERS](https://gothic-bio-fonts-90.pages.dev/es/borders-dividers/)
- [SYM 260C](https://minimal-star-symbols-28.pages.dev/symbol/sym-260c/)
- [SYM 1F480](https://clean-aesthetic-fonts-33.pages.dev/symbol/sym-1f480/)
- [SYM 1F49B](https://mecha-gamer-fonts-53.pages.dev/symbol/sym-1f49b/)
- [SYM 2647](https://occult-rune-symbols-64.pages.dev/symbol/sym-2647/)
- [HEARTS](https://clean-space-text-47.pages.dev/es/hearts/)
- [LATIN CROSS HEAVY](https://pastel-moe-kaomoji-91.pages.dev/symbol/latin-cross-heavy/)
- [SYM 1D426](https://chibi-heart-symbols-15.pages.dev/symbol/sym-1d426/)
- [SYM 26CB](https://minimal-star-symbols-43.pages.dev/symbol/sym-26cb/)
- [BRACKETS](https://soft-angel-symbols-33.pages.dev/ru/brackets/)
- [HEARTS](https://manga-bubble-fonts-35.pages.dev/hearts/)
- [SYM 26A9](https://gothic-bio-fonts-55.pages.dev/symbol/sym-26a9/)
- [SYM 26C0](https://baroque-font-vault-96.pages.dev/symbol/sym-26c0/)
- [SYM 268A](https://archival-rune-symbols-42.pages.dev/symbol/sym-268a/)
- [BLACK FLORETTE FLOWER](https://clean-aesthetic-fonts-33.pages.dev/symbol/black-florette-flower/)
- [SYM 1F9E1](https://cyber-clan-tags-68.pages.dev/symbol/sym-1f9e1/)
- [SYM 1D43E](https://minimal-star-symbols-87.pages.dev/symbol/sym-1d43e/)
- [SYM 1D45C](https://neon-glitch-fonts-64.pages.dev/symbol/sym-1d45c/)
- [MUSIC WEATHER](https://dollcore-bio-symbols-12.pages.dev/music-weather/)
- [SYM 2638](https://clean-aesthetic-fonts-33.pages.dev/symbol/sym-2638/)
- [SYM 26DE](https://soft-ribbon-fonts-77.pages.dev/symbol/sym-26de/)
- [SYM 1D47C](https://chibi-heart-symbols-15.pages.dev/symbol/sym-1d47c/)
- [SYM 26F3](https://neon-futuristic-symbols-20.pages.dev/symbol/sym-26f3/)
- [SYM 1F914](https://mech-gaming-tags-18.pages.dev/symbol/sym-1f914/)
- [SYM 1D444](https://archival-rune-symbols-42.pages.dev/symbol/sym-1d444/)
- [SYM 267D](https://pastel-moe-kaomoji-91.pages.dev/symbol/sym-267d/)
- [FLORAL BRANCH BOUQUET](https://angelic-coquette-text-10.pages.dev/symbol/floral-branch-bouquet/)
- [MUSIC SHARP SIGN](https://moe-kaomoji-vault-94.pages.dev/symbol/music-sharp-sign/)
- [SYM 260B](https://cyber-clan-tags-15.pages.dev/symbol/sym-260b/)
- [FLUTTERING BUTTERFLY](https://vintage-lace-fonts-79.pages.dev/symbol/fluttering-butterfly/)
- [HEAVY RIGHTWARD ARROW](https://moe-kaomoji-vault-94.pages.dev/symbol/heavy-rightward-arrow/)
- [SYM 1F9D0](https://cyber-clan-tags-15.pages.dev/symbol/sym-1f9d0/)
- [SYM 1D433](https://vintage-bow-kaomoji-63.pages.dev/symbol/sym-1d433/)
- [SYM 2656](https://vintage-scholar-text-78.pages.dev/symbol/sym-2656/)
- [SYM 1F62A](https://archival-rune-symbols-42.pages.dev/symbol/sym-1f62a/)
- [SYM 1D439](https://pastel-moe-kaomoji-91.pages.dev/symbol/sym-1d439/)
- [SYM 265F](https://pastel-moe-kaomoji-91.pages.dev/symbol/sym-265f/)
- [SYM 1D405](https://chibi-heart-symbols-15.pages.dev/symbol/sym-1d405/)
- [LITTLE CAT PAWS KAOMOJI](https://angelic-coquette-text-10.pages.dev/symbol/little-cat-paws-kaomoji/)
- [STARS](https://neon-futuristic-symbols-62.pages.dev/vi/stars/)
- [SYM 26FD](https://pure-line-unicode-95.pages.dev/symbol/sym-26fd/)
- [SYM 1F611](https://pastel-chibi-emojis-45.pages.dev/symbol/sym-1f611/)
- [SYM 1D49F](https://angelic-soft-text-59.pages.dev/symbol/sym-1d49f/)
- [SYM 1D48A](https://matrix-terminal-fonts-30.pages.dev/symbol/sym-1d48a/)
- [SYM 1D418](https://dollcore-bio-symbols-12.pages.dev/symbol/sym-1d418/)
- [SYM 1D44D](https://baroque-unicode-decor-43.pages.dev/symbol/sym-1d44d/)
- [BORDERS DIVIDERS](https://vintage-scholar-text-78.pages.dev/pt/borders-dividers/)
- [SIXTEEN POINTED STAR](https://clean-aesthetic-fonts-33.pages.dev/symbol/sixteen-pointed-star/)
- [SYM 2625](https://moe-kaomoji-vault-94.pages.dev/symbol/sym-2625/)
- [SYM 26A4](https://matrix-glitch-text-84.pages.dev/symbol/sym-26a4/)
- [SYM 1F649](https://monochrome-bio-text-12.pages.dev/symbol/sym-1f649/)
- [SYM 1F639](https://cyber-clan-tags-15.pages.dev/symbol/sym-1f639/)
- [SYM 1D40D](https://matrix-terminal-fonts-30.pages.dev/symbol/sym-1d40d/)
- [SYM 2631](https://moe-kaomoji-vault-94.pages.dev/symbol/sym-2631/)
- [SYM 2685](https://manga-bubble-fonts-35.pages.dev/symbol/sym-2685/)
- [BLACK HEART](https://matrix-hacker-fonts-85.pages.dev/symbol/black-heart/)
- [TRENDING](https://zen-unicode-symbols-89.pages.dev/ja/trending/)
- [SYM 2660](https://manga-bubble-fonts-35.pages.dev/symbol/sym-2660/)
- [ARROWS LINES](https://kawaii-kaomoji-hub-77.pages.dev/arrows-lines/)
- [SYM 26E1](https://coquette-aesthetic-symbols-62.pages.dev/symbol/sym-26e1/)
- [SYM 1F62B](https://chibi-heart-symbols-15.pages.dev/symbol/sym-1f62b/)
- [TRENDING](https://gothic-bio-fonts-90.pages.dev/ja/trending/)
- [HEARTS](https://vintage-bow-kaomoji-63.pages.dev/hearts/)
- [STAR OPERATOR](https://vintage-lace-fonts-79.pages.dev/symbol/star-operator/)
- [SYM 26C2](https://cyber-clan-tags-68.pages.dev/symbol/sym-26c2/)
- [SYM 1F972](https://manga-bubble-fonts-35.pages.dev/symbol/sym-1f972/)
- [SYM 1D441](https://occult-rune-symbols-64.pages.dev/symbol/sym-1d441/)
- [SYM 2667](https://pastel-manga-symbols-57.pages.dev/symbol/sym-2667/)
- [TRENDING](https://cyber-clan-tags-75.pages.dev/ja/trending/)
- [SYM 1F620](https://cyber-clan-tags-15.pages.dev/symbol/sym-1f620/)
- [SYM 1D4A3](https://matrix-glitch-text-84.pages.dev/symbol/sym-1d4a3/)
- [SYM 1D486](https://soft-ribbon-fonts-77.pages.dev/symbol/sym-1d486/)
- [SYM 2684](https://manga-bubble-fonts-35.pages.dev/symbol/sym-2684/)
- [SYM 1F602](https://occult-aesthetic-symbols-26.pages.dev/symbol/sym-1f602/)
- [SYM 1D433](https://academic-rune-text-25.pages.dev/symbol/sym-1d433/)
- [SYM 1D43A](https://cute-face-emoticons-66.pages.dev/symbol/sym-1d43a/)
- [SYM 262F](https://clean-aesthetic-fonts-33.pages.dev/symbol/sym-262f/)
- [SYM 26B4](https://dollcore-bio-symbols-12.pages.dev/symbol/sym-26b4/)
- [SYM 1F638](https://cyber-clan-tags-20.pages.dev/symbol/sym-1f638/)
- [SYM 265B](https://pastel-chibi-emojis-45.pages.dev/symbol/sym-265b/)
- [SYM 1F61A](https://ribbon-bow-unicode-18.pages.dev/symbol/sym-1f61a/)
- [DISCORD STATUS](https://pastel-moe-kaomoji-91.pages.dev/ja/discord-status/)
- [SYM 2763 FE0F](https://vintage-scholar-text-78.pages.dev/symbol/sym-2763-fe0f/)
- [SYM 1D477](https://neon-futuristic-symbols-62.pages.dev/symbol/sym-1d477/)
- [SYM 1F62D](https://angelic-coquette-text-10.pages.dev/symbol/sym-1f62d/)
- [SYM 2657](https://pure-line-unicode-95.pages.dev/symbol/sym-2657/)
- [SYM 1D402](https://anime-sparkle-text-45.pages.dev/symbol/sym-1d402/)
- [SYM 1D458](https://chibi-heart-symbols-15.pages.dev/symbol/sym-1d458/)
- [TWELVE POINTED STAR](https://vintage-scholar-text-78.pages.dev/symbol/twelve-pointed-star/)
- [SYM 26CA](https://chibi-kaomoji-vault-58.pages.dev/symbol/sym-26ca/)
- [SYM 1D448](https://kawaii-kaomoji-hub-80.pages.dev/symbol/sym-1d448/)
- [ARROWS LINES](https://monochrome-bio-text-12.pages.dev/arrows-lines/)
- [SYM 1D46C](https://chibi-heart-symbols-15.pages.dev/symbol/sym-1d46c/)
- [SYM 2680](https://coquette-aesthetic-symbols-51.pages.dev/symbol/sym-2680/)
- [SYM 1F605](https://clean-spacing-fonts-98.pages.dev/symbol/sym-1f605/)
- [HOLLOW STAR](https://sleek-arrow-symbols-42.pages.dev/symbol/hollow-star/)
- [SYM 1D476](https://angelic-coquette-text-10.pages.dev/symbol/sym-1d476/)
- [SYM 1D42B](https://anime-sparkle-text-45.pages.dev/symbol/sym-1d42b/)
- [SYM 2668](https://cyber-clan-tags-75.pages.dev/symbol/sym-2668/)
- [RIGHT WHITE CORNER BRACKET](https://zen-unicode-symbols-89.pages.dev/symbol/right-white-corner-bracket/)
- [BIOHAZARD SYMBOL](https://monochrome-bio-text-12.pages.dev/symbol/biohazard-symbol/)
- [SYM 2724](https://matrix-hacker-fonts-85.pages.dev/symbol/sym-2724/)
- [CUPID FEATHERY ARROW](https://moe-kaomoji-vault-94.pages.dev/symbol/cupid-feathery-arrow/)
- [SYM 26C2](https://dollcore-bio-symbols-12.pages.dev/symbol/sym-26c2/)
- [SYM 2610](https://chibi-emoticon-lab-65.pages.dev/symbol/sym-2610/)
- [SYM 2625](https://kawaii-kaomoji-hub-77.pages.dev/symbol/sym-2625/)
- [SYM 1D420](https://cute-face-emoticons-66.pages.dev/symbol/sym-1d420/)
- [SYM 267F](https://dollcore-bio-symbols-12.pages.dev/symbol/sym-267f/)
- [SYM 2678](https://cute-face-emoticons-66.pages.dev/symbol/sym-2678/)
- [SYM 2629](https://pearl-heart-symbols-95.pages.dev/symbol/sym-2629/)
- [SYM 1D405](https://pure-line-unicode-95.pages.dev/symbol/sym-1d405/)
- [SYM 1F61D](https://cyber-clan-tags-36.pages.dev/symbol/sym-1f61d/)
- [LATIN CROSS FAITH](https://monochrome-bio-text-12.pages.dev/symbol/latin-cross-faith/)
- [SYM 26C2](https://pastel-manga-symbols-57.pages.dev/symbol/sym-26c2/)
- [CIRCLED STAR](https://vintage-scholar-text-78.pages.dev/symbol/circled-star/)
- [SYM 1F978](https://vintage-scholar-text-78.pages.dev/symbol/sym-1f978/)
- [SYM 1F47B](https://kawaii-kaomoji-hub-77.pages.dev/symbol/sym-1f47b/)
- [SYM 267D](https://pure-line-unicode-95.pages.dev/symbol/sym-267d/)
- [SYM 1D40A](https://mech-gaming-tags-18.pages.dev/symbol/sym-1d40a/)
- [TRENDING](https://vintage-lace-symbols-65.pages.dev/ja/trending/)
- [SYM 1D46B](https://vintage-angel-text-38.pages.dev/symbol/sym-1d46b/)
- [SYM 1D420](https://moe-kaomoji-vault-94.pages.dev/symbol/sym-1d420/)
- [BLACK STAR](https://coquette-aesthetic-symbols-51.pages.dev/symbol/black-star/)
