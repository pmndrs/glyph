# Docs examples

One React Three Fiber scene per docs page, hosted at `/examples/?example=<slug>` beside the landing and the docs so a
page can iframe its example from the same origin.

```
examples/
  index.html                     the one page
  public/diagrams/               the docs' SVG figures, served at /examples/diagrams/
  src/main.tsx                   reads ?example=, hands the catalog entry to the preview
  src/catalog.ts                 slug → title, docs page, stage options, scene loader
  src/theme.ts                   ground, paper, accent, and the world width every scene assumes
  src/fonts.ts                   the checked-in fonts every scene draws from
  src/components/
    stage/                       Stage — the canvas, camera, dark ground, optional light rig; FitWidth
    preview/                     ExamplePreview — in view: the scene; off screen: its last frame; Poster, FirstFrame
    text/                        shared text building blocks: Caption, Billboard, LabeledRow, TextOnPath
  src/lib/                       paths (torus knot, circle, placeOnPath), typewriter, colour, planned-draws
  src/scenes/<slug>/
    scene.tsx                    the R3F scene that runs — a composition, a few dozen lines
    three.ts                     the three.js twin: the same thing imperatively, typechecked, never executed here
    components/                  the scene's own pieces when it has more than one (Ring, Glow, Knot, WordTile, …)
    materials.ts, config.ts      when a scene owns materials or shared constants
```

A scene is one feature and a few dozen lines. Art is generated — gradients, lit materials, simple geometry — never
loaded, so the bundle stays small and every byte a reader downloads is text.

## The twin

Each `three.ts` exports `mount(scene)` and states what the R3F scene states, imperatively: `glyph.init()`, a handle, a
`FontFace` and its `load()`, `createText`, and `glyph.shape()` before the host renders. The docs show it beside the
component so a plain three.js reader sees the parallel. It is part of the typecheck, not of the page.

## Running

```sh
mise exec -- pnpm --filter @pmndrs/glyph-site dev:examples      # http://localhost:5173/examples/?example=hello
mise exec -- pnpm --filter @pmndrs/glyph-site build:examples    # → dist/examples
mise exec -- pnpm --filter @pmndrs/glyph-site check:examples    # typecheck + build
```

The scenes are written against the API on the redesign branch. Until it merges, verify them against that checkout:

```sh
# types: a scratch tsconfig with `paths` into the other checkout (see the outline's Verification section)
node node_modules/typescript/bin/tsc --noEmit -p .examples-codex.tsconfig.json
# bundle: alias every subpath to its declared `source` entry in that package's exports map
GLYPH_SOURCE=/path/to/checkout/packages/glyph pnpm build:examples
```

## Adding one

1. Add a folder under `src/scenes/` with `scene.tsx` (default-export a component) and `three.ts` (export `mount`).
2. Register it in `src/catalog.ts` with its docs page and stage options.
3. Embed it from the page with `<iframe src="/examples/?example=<slug>" …/>` and add a card to the gallery.
