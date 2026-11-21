# @pmndrs/glyph-pixi3d

Glyph text for [PixiJS 3D](https://github.com/pixijs/3d) (`@pixi/3d` 0.1, `pixi.js` 8.23 or later). Bitmap, MSDF (fill,
outline, shadow) and Slug draw on PixiJS 3D's WebGPU and WebGL2 backends.

```ts
import { View3D } from '@pixi/3d';
import { glyph, slug } from '@pmndrs/glyph';
import { Pixi3DConfig } from '@pmndrs/glyph-pixi3d';
import { Application } from 'pixi.js';

const app = new Application();
await app.init({ preference: 'webgpu', resizeTo: window });
const view = new View3D({ autoResize: true });
app.stage.addChild(view);

await glyph.init();
const handle = glyph.handle('scene', Pixi3DConfig);
const font = glyph.fontFace('/fonts/inter.font.glb', { format: slug });
await font.load();

const text = handle.createText({ font, text: 'Hello, PixiJS 3D', style: { fontSize: 0.5, color: '#ffffff' } });
view.root.addChild(text);
app.ticker.add(() => glyph.shape());
```

A text is a `Container3D`: position, rotate and parent it like any other node. Setters only mark the text dirty; call
`glyph.shape()` once per frame to prepare and publish every change. Reads such as `measure()` prepare on demand.

## Materials

Text uses PixiJS 3D's lit `Material3D` by default. `Pixi3DTextMaterial` appends shader bits, holds their material
data (updated without reshaping), and may supply a factory that returns another `BaseMaterial3D`, such as an unlit
`FlatMaterial`. Slug exposes `createGlyphSlugBits(page)`: bits placed between its `setup` and `coverage` bits may warp
`glyphSlugCoordinate` before coverage is integrated once.

## What it shares with Glyph's other renderers

Shader math is Glyph's TypeGPU shader library, resolved at build time to static WGSL and GLSL; the package has no
TypeGPU runtime dependency. Slug band curves become resident per glyph through `SlugBandResidency` from
`@pmndrs/glyph/core`; MSDF resolves glyph cells from each font's glyph table. Solid underline, overline and
strike-through use core's `createDecorationCodecProgram`.

## Known differences

- MSDF uploads every baked atlas page; the Three and TypeGPU renderers keep only drawn glyphs resident and trim quads
  to the ink.
- Draw order between overlapping texts is decided by PixiJS 3D's own sort, so there is no ordered `TextGroup`
  equivalent and CSS under/over decoration ordering is not enforced where a decoration crosses glyph ink.
- Bitmap quads are not snapped to the pixel grid.
