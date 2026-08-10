# React Three Fiber hello world

This is the smallest product-shaped `@pmndrs/text` example in the workspace. It renders `Hello world` through the public React Three Fiber API, resolves the globe from a Font Awesome fallback font, and switches between Bitmap, MSDF, and Slug using controls rendered inside the canvas.

The complete scene lives in `src/app.tsx`. Its local technique state reveals one of three pre-rendered React `Activity`
branches; each branch contains a `TextGroup` and `Text` whose font stack carries the technique binding. The UI controls
use their own `TextGroup` so their labels batch explicitly. The controls are centered across the top of the canvas and
the world copy is centered in the viewport.

```sh
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world dev
```

The app uses React 19, the React Compiler, the WebGPU R3F entry point, and Three's automatic WebGL fallback. Its two checked-in GLBs share shaping data across the three embedded raster techniques:

- `inter-latin.font.glb` is a true Basic Latin source subset (`U+0020–U+007E`).
- `font-awesome-world.font.glb` contains only six globe/earth variants.

Both checked assets are produced directly through the published CLI through `pnpm exec text bake`, with `--input`,
`--output`, `--unicodes`, `--bitmap`, `--msdf`, and `--slug`. Unicode subsetting uses the package-owned baker Wasm;
no platform font binary is required. The check
uses the same commands with `--check`, which rebuilds into temporary storage and requires a byte-identical GLB without
rewriting the checked asset.

```sh
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world bake
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world bake:check
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world check
```

`bake:inter` and `bake:icons` regenerate one asset each; `bake:check:inter` and `bake:check:icons` verify them
independently. Each font-specific command still embeds all three raster techniques in one GLB.
