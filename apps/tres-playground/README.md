# TresJS playground

This private Vite application renders Glyph text through the public `@pmndrs/glyph/vue` adapter inside a
[TresJS](https://tresjs.org) `<TresCanvas>`. It reuses the checked Inter and Font Awesome GLBs from the Three.js and
React Three Fiber examples rather than baking its own assets.

The scene shows one greeting paragraph whose nested `<Text>` binds the globe glyph to the subsetted Font Awesome font,
plus a `<TextGroup>` of three Slug labels. The HTML controls switch the greeting between Bitmap, MSDF, and Slug and edit
its message. Each format loads through `useBitmap`, `useMsdf`, or `useSlug`, which own their declarations and mounted
Font leases for the scene component's lifetime.

Behind the text, `Backdrop.vue` renders an animated sky and five lit shapes. The sky is one unlit plane whose color is a
TSL graph over `mx_fractal_noise_float` and the renderer-updated `time` uniform; the shapes are `MeshStandardNodeMaterial`
icosahedrons under an ambient light and two orbiting point lights, one tinted with the active format's accent color.
The greeting and the labels share a `defineTextMaterial` that composes over each format's canonical shader and only
sweeps a band of the active accent color across the glyphs in screen space. Glyph text materials are unlit, so the lights affect only the shapes.

```sh
mise exec -- pnpm --filter @pmndrs/glyph-tres-playground dev
mise exec -- pnpm --filter @pmndrs/glyph-tres-playground check
```

The canvas uses Three's `WebGPURenderer` with its automatic WebGL2 fallback and TresJS `always` rendering, because the
backdrop animates every frame; the adapter still invalidates a frame whenever a paragraph republishes, which matters
under `on-demand`. The Vite `source` condition runs the adapter from `packages/glyph/src`, so editing the adapter
reloads the playground without a package build.

The check runs `vue-tsc`, lint, formatting, a production build, and one Vitexec browser probe. The probe clicks every
format button and requires the greeting paragraph to commit with ten Latin glyphs and one icon across two
resource-partitioned draws, next to the label group's single batched draw, and then requires the backdrop group to be
mounted. The backdrop meshes carry no glyph run metadata, so they never count toward those draws.
