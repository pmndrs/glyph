# React Three Fiber hello world

This is the smallest product-shaped `@pmndrs/text` example in the workspace. It renders `Hello world` through the public React Three Fiber API, resolves the globe from a Font Awesome fallback font, and switches between Bitmap, MSDF, and Slug using controls rendered inside the canvas.

The world copy and UI controls use separate `TextGroup` layers. Each layer batches its descendant text explicitly while
ordinary nested groups remain available for local button positioning and background meshes.

```sh
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world dev
```

The app uses React 19, the React Compiler, the WebGPU R3F entry point, and Three's automatic WebGL fallback. Its two checked-in GLBs share shaping data across the three embedded raster techniques:

- `inter-latin.font.glb` is a true Basic Latin source subset (`U+0020–U+007E`).
- `font-awesome-world.font.glb` contains only six globe/earth variants.

Regeneration requires `hb-subset` from exactly HarfBuzz 14.2.0. Both checked assets are produced directly through the
published CLI through `pnpm exec pmndrs-text-bake`, with `--input`, `--output`, `--unicodes`, `--bitmap`, `--msdf`, and
`--slug`. The check
uses the same commands with `--check`, which rebuilds into temporary storage and requires a byte-identical GLB without
rewriting the checked asset.

```sh
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world assets:check
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world check
```
