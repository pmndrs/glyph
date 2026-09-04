# Three.js and React Three Fiber examples

This private Vite package places imperative Three.js and React Three Fiber examples side by side over the same checked
font assets. The root page dynamically loads only the selected integration:

- `?example=three` runs `src/three-example.ts`.
- `?example=r3f` runs `src/r3f-example.tsx` and `src/app.tsx` (the default).

The imperative example is the smallest complete public lifecycle. It initializes Glyph once, creates a Three handle,
declares and loads one renderer-neutral FontFace, creates a `Text`, and attaches it to an ordinary Three scene. Its
explicit `glyph.shape()` call publishes every dirty root and attaches the decoded `Mesh` below the `Text` before the
application initializes `WebGPURenderer`; only `renderer.render(scene, camera)` performs the host draw.

The R3F twin renders `Hello world` through the public React adapter, binds the globe span to a subsetted Font Awesome
font, and switches between Bitmap, MSDF, and Slug using controls rendered inside the canvas. The explicit per-format
hooks preload the checked font requests and suspend on the same stable resources. The Slug-rendered controls use a
`TextGroup` so their three labels can batch explicitly.

```sh
mise exec -- pnpm --filter @pmndrs/glyph-examples dev
```

The app uses React 19, the React Compiler, the WebGPU R3F entry point, and Three's automatic WebGL fallback. Its two checked-in GLBs share shaping data across the three embedded raster formats:

- `inter-latin.font.glb` is a true Basic Latin source subset (`U+0020–U+007E`).
- `font-awesome-world.font.glb` contains only six globe/earth variants.

Both checked assets are produced directly through the published CLI through `pnpm exec glyph bake`, with `--input`,
`--output`, `--unicodes`, `--bitmap`, `--msdf`, and `--slug`. Unicode subsetting uses the package-owned baker Wasm;
no platform font binary is required. The check
uses the same commands with `--check`, which rebuilds into temporary storage and requires a byte-identical GLB without
rewriting the checked asset.

```sh
mise exec -- pnpm --filter @pmndrs/glyph-examples bake
mise exec -- pnpm --filter @pmndrs/glyph-examples bake:check
mise exec -- pnpm --filter @pmndrs/glyph-examples check
```

`bake:inter` and `bake:icons` regenerate one asset each; `bake:check:inter` and `bake:check:icons` verify them
independently. Each font-specific command still embeds all three raster formats in one GLB. The final check also runs
two browser probes: the R3F route exercises all three format branches, and the imperative route verifies that the
scene owns the `Text`, the `Text` owns one decoded draw mesh, and Three sees ten visible glyph instances for `Hello world`
(the space shapes but does not draw).
