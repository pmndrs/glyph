# TypeGPU hello world

Run `mise exec -- pnpm scripts run typegpu:dev` from the workspace root, then open the printed URL in a WebGPU browser.
The example includes its own Inter font artifact and license in `assets/`. Its production build includes the font license.
Regenerate that artifact through the current package contract with `mise exec -- pnpm --filter
@pmndrs/glyph-typegpu-hello-world bake:inter`; the app check verifies the committed bytes without rewriting them.

The app creates a caller-owned TypeGPU root, loads fonts, and selects Glyph's TypeGPU integration:

```ts
import tgpu from 'typegpu';
import { glyph } from '@pmndrs/glyph';
import { defineTypeGpuConfig } from '@pmndrs/glyph/typegpu';

const root = await tgpu.init();
await glyph.init();
const handle = glyph.handle(
  'text',
  defineTypeGpuConfig({
    root,
    format: navigator.gpu.getPreferredCanvasFormat(),
  }),
);
const font = glyph.fontFace('/inter-latin.font.glb');
await font.load();
const text = handle.createText({
  font,
  text: 'Hello, TypeGPU!',
  position: [24, 64],
  style: { fontSize: 64, color: '#a99aff' },
});
glyph.shape();

// Inside your existing render pass:
handle.draw(pass, { width: canvas.clientWidth, height: canvas.clientHeight });
```

`draw()` records into either a TypeGPU or raw WebGPU render pass. The application owns attachments, clearing, pass
completion, and submission. The viewport defines logical pixels with a top-left origin; the canvas may have a higher
physical resolution. `sampleCount` must match the attachment when using multisampling.

Use `text.update(...)` followed by `glyph.shape()` for text, font, style, or layout changes. `measure()` and `glyphs()`
return engine results synchronously. `handle('overlay')` creates an independent named text root with its own draw call.
Dispose text and handles before destroying the caller-owned TypeGPU root. Disposing a handle leaves that root usable.

Bitmap, MSDF (including outline and shadow), and Slug use the functions published at
`@pmndrs/glyph/shaders/typegpu`.
The adapter defaults to unlit 2D text and supports custom GPU position and color transforms. Rich spans, decoration
lines, and custom raster programs remain integration work. It does not depend on Three.js.

## GPU callbacks

Pass optional `transformPosition` and `transformColor` functions to `defineTypeGpuConfig`. Both are GPU code and can
capture caller-owned uniforms, textures, and other TypeGPU resources. The example's Tilt control changes a uniform
used by both callbacks; it redraws without calling `glyph.shape()`.

```ts
import { d } from 'typegpu';

const tint = root.createUniform(d.vec3f, [1, 0.6, 1]);
const config = defineTypeGpuConfig({
  root,
  format: navigator.gpu.getPreferredCanvasFormat(),
  transformPosition: (position, viewport) => {
    'use gpu';
    return d.vec4f((position.x * 2) / viewport.x - 1, 1 - (position.y * 2) / viewport.y, 0.5, 1);
  },
  transformColor: (color) => {
    'use gpu';
    return d.vec4f(color.rgb.mul(tint.$), color.a);
  },
});
```

`transformPosition(position, viewport)` receives logical pixel coordinates, with y pointing down, after adding
`text.position`. It returns homogeneous clip coordinates, including `w` for perspective. To place text on a 3D plane,
replace the projection above with your model-view-projection matrix applied to `d.vec4f(position, 1)`. Include the
pixel-to-world scale and any y-axis flip in that matrix. Slug uses nearby projected positions to estimate its
antialiasing footprint: matrix projections are exact; nonlinear deformations are approximate.

`transformColor(color, fragmentPosition)` receives straight RGBA after coverage and MSDF outline/shadow composition.
Keep `color.a` to preserve antialiased edges. Its optional second argument is the WebGPU fragment position: physical
pixel x/y, depth z, and reciprocal clip w. The output uses straight-alpha blending.

Callbacks are fixed when the config is created and apply to all its text. Update captured uniforms to animate, then
call `draw()` and submit the pass. Use separate configs for different callbacks. The caller owns captured resources.

Callbacks can also read an explicit `tgpu.bindGroupLayout`. Supply its bind group when drawing:

```ts
const paint = tgpu.bindGroupLayout({ tint: { uniform: d.vec3f } });
const paintGroup = root.createBindGroup(paint, { tint });
const painted = glyph.handle(
  'painted',
  defineTypeGpuConfig({
    root,
    format: navigator.gpu.getPreferredCanvasFormat(),
    transformColor: (color) => {
      'use gpu';
      return d.vec4f(color.rgb.mul(paint.$.tint), color.a);
    },
  }),
);
painted.createText({ font, text: 'Hello world' });
glyph.shape();

const drawText = painted.with(paintGroup);
drawText.draw(pass, { width: canvas.clientWidth, height: canvas.clientHeight });
```

Chain `.with(cameraGroup).with(paintGroup)` when callbacks use multiple layouts. Each call returns a new `TypeGpuDraw`
view; the handle and earlier views remain unchanged. The last group for the same layout wins. Views can be reused
across frames and text updates, but stop working when the originating handle or named root is disposed. Named roots
also support `.with()`. Groups are matched by their layout identity through TypeGPU, so no numeric binding index is
needed. Missing required groups are reported by TypeGPU during `draw()`. Supplying groups does not reshape text,
rebuild pipelines, or transfer ownership of the groups and their resources.

The example uses this API for its angle uniform: both callbacks read `animation.$.angle`, and drawing uses
`handle.with(animationGroup).draw(...)`.

For a pass with depth, set `depthStencil` on the config to match its attachment, for example
`{ format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' }`. This lets opaque scene geometry occlude
text. Transparent text still needs appropriate draw ordering; enabling depth writes also writes depth for transparent
parts of glyph quads.

Build with `mise exec -- pnpm --filter @pmndrs/glyph-typegpu-hello-world build`.
Verify GPU rendering with `mise exec -- pnpm scripts run typegpu:live-check`.
