# Font load argument migration

Portable loading now takes the font input and raster selection as separate arguments. Preserve byte ownership, runtime
bake input, cancellation, and tuple order; this is an authoring-shape change, not a loader-lifecycle change.

```ts
const font = await loadFont(input, { technique: bitmap, options: { strikes: [16] } }, { signal });
const [bitmapFont, msdfFont] = await library.loadFont(input, [{ technique: bitmap, options: { strikes: [16] } }, msdf]);
library.clear(input, msdf);
```

`loadFont(defineFont(...), options?)` remains unchanged. A variable initialized to the old wrapper may remain as local
data after the automatic pass; its calls become `loadFont(request.input, request.raster)` or
`loadFont(request.input, request.rasters)`. Remove the wrapper when it no longer improves local readability.

This historical recipe predates the config-based Three integration. Current Glyph no longer exports a Three
`FontLoader`: do not recreate it or treat `THREE.LoadingManager` as font ownership. When migrating a checkout that still
contains that adapter, first migrate its consumers to the shared Glyph font graph, then delete the adapter once no public
call site remains. Preserve a host-framework request wrapper only when the framework itself requires that cardinality.

Replace public annotations using `FontRequest`, `MultiRasterFontRequest`, or `FontRasterRequests` with explicit
`LoadFontInput` plus `RasterTechniqueInput`, or with `FontRasterInputs` for a nonempty typed tuple. Do not recreate the
removed wrapper under another renderer-neutral name.

After migration, search the TypeScript AST for removed type references and object literals passed to portable
`loadFont`/`FontLibrary.clear`. Typecheck every maintained consumer and exercise byte-transfer, cancellation,
multi-raster tuple inference, static `defineFont` discovery, Three loading, and React preload/clear tests.
