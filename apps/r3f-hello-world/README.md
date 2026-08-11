# React Three Fiber hello world

This is the smallest product-shaped `@pmndrs/text` example in the workspace. It renders `Hello world` through the
public React Three Fiber API, binds the globe span to a subsetted Font Awesome font, and switches between Bitmap, MSDF,
and Slug using controls rendered inside the canvas.

The complete scene lives in `src/app.tsx`. Two public `useFont.preload()` calls begin loading the checked assets before
the scene suspends on the same cached requests. Local technique state reveals one of three pre-rendered React `Activity`
branches. Each branch contains one standalone Inter `Text` with a nested `Text` span that selects the matching Font
Awesome raster directly, so this known icon does not require a font stack. The technique color is shared by that globe
span and its in-canvas button label. The Slug-rendered controls use a `TextGroup` so their three labels can batch
explicitly; the row stays centered across the top while the world copy stays centered in the viewport.

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
