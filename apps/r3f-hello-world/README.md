# React Three Fiber hello world

This is the smallest product-shaped `@pmndrs/text` example in the workspace. It renders `Hello world` through the public React Three Fiber API, resolves the globe from a Font Awesome fallback font, and switches between Bitmap, MSDF, and Slug using controls rendered inside the canvas.

```sh
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world dev
```

The app uses React 19, the React Compiler, the WebGPU R3F entry point, and Three's automatic WebGL fallback. Its two checked-in GLBs share shaping data across the three embedded raster techniques:

- `inter-latin.font.glb` is a true Basic Latin source subset (`U+0020–U+007E`).
- `font-awesome-world.font.glb` contains only six globe/earth variants.

Regeneration requires exactly HarfBuzz 14.2.0. The check performs fresh source subsets and complete Bitmap/MSDF/Slug bakes, then requires byte-identical GLBs and manifest hashes.

```sh
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world assets:check
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world check
```
