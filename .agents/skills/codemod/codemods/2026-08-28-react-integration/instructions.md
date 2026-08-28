# React integration migration

The React integration now uses R3F's `useLoader` cache directly. `useFont` accepts the source, technique, and inferred
technique options; the Bitmap, MSDF, and Slug hooks bind those techniques without creating another cache.

```ts
// Before
const useAppFont = createUseFont(library);
const font = useAppFont({ input, raster: { technique, options } });

// After
const font = useFont(input, technique, options);
```

`preload()` and `clear()` use the same arguments as the hook and no longer accept a `FontLibrary`. Preload is an R3F
warm-up operation and returns `void`; the hook suspends on the cached promise when it has not resolved yet.

Use nested `Text` for inline runs. A nested element may carry only `font`, `style`, `paint`, `material`, and children;
the adapter throws synchronously if a box, transform, ref, capacity, or error prop reaches the flattener.

The automatic transform handles singular object requests and direct convenience calls. It deliberately leaves
multi-raster `useFont({ rasters: [...] })` calls for an agent: choose the techniques the component actually renders and
call the singular base or convenience hook once per required technique. It also leaves provider removal for an agent
when the provider participates in application-owned loading configuration rather than only wrapping children.

Do not rewrite imperative `TextSpan` types from `@pmndrs/glyph/three`, formatted-text `span()` calls, persisted strings,
or protocol values. Residual React-only queries:

```bash
rg -n "createUseFont|GlyphProvider|BoundUseFont|TextSpan" --glob '*.{ts,tsx}'
rg -n "useFont\\(\\s*\\{" --glob '*.{ts,tsx}'
```

After migration, verify that preload and the later hook share one load, clearing preserves mounted consumer leases, and
nested runs retain their text, style, and grapheme-cluster boundaries.
