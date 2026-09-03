# Docs examples

One React Three Fiber scene per feature, run inline in the docs pages, in the gallery at `/examples/`, and one at a
time at `/examples/?example=<slug>` — all through the explainer element in `site/docs/components/explainer`: one
renderer and one WebGPU device per page, a bounded pool of logical roots, and a `<glyph-proxy>` per scene that keeps
its last frame when its lease ends.

```
examples/
  index.html                     the one page: the gallery, or one scene with ?example=
  public/diagrams/               the docs' SVG figures, served at /examples/diagrams/
  src/main.tsx                   installs the examples explainer page, then renders the gallery or the preview
  src/catalog.ts                 slug → title, docs page, stage options, gallery aspect, scene loader
  src/theme.ts                   ground, paper, accent, and the world width every scene assumes
  src/fonts.ts                   the checked-in fonts every scene draws from
  src/custom-elements.d.ts       JSX typings for glyph-explainer-root, glyph-proxy, glyph-scene-control
  src/components/
    gallery/                     Gallery, Card — a masonry of proxies under pointer activation
    preview/                     Preview — one proxy filling the page, for a docs iframe
    text/                        shared text building blocks: Caption, Billboard, LabeledRow, TextOnPath
  src/lib/                       paths (torus knot, circle, any three curve, placeOnPath), typewriter, flap wheel, colour, planned-draws
  src/scenes/<slug>/
    scene.tsx                    the R3F scene that runs — a composition, a few dozen lines
    three.ts                     the three.js twin: the same thing imperatively, typechecked, never executed here
    components/                  the scene's own pieces when it has more than one (Ring, Glow, Knot, StripTile, …)
    materials.ts, config.ts      when a scene owns materials or shared constants

../docs/components/
  explainer/                     the element: root (pool, leases, presenter), proxy (poster, sentinel), controls
  pages/examples/                the catalog as an explainer page; stage.tsx is what every scene stands on
  load-explainers.ts             the docs bundle entry, built to docs/assets/explainer.{js,css}
```

A scene is one feature and a few dozen lines; the showcase scenes (kinetic, split-flap, relief, slug-anatomy, ribbon) are the exception, each built from a few components and a material file. Art is generated — gradients, lit materials, simple geometry — never
loaded, so the bundle stays small and every byte a reader downloads is text.

## The twin

Each `three.ts` exports `mount(scene)` and states what the R3F scene states, imperatively: `glyph.init()`, a handle, a
`FontFace` and its `load()`, `createText`, and `glyph.shape()` before the host renders. The docs show it beside the
component so a plain three.js reader sees the parallel. It is part of the typecheck, not of the page.

## Running

```sh
mise exec -- pnpm --filter @pmndrs/glyph-site dev:examples      # http://localhost:5173/examples/?example=hello
mise exec -- pnpm --filter @pmndrs/glyph-site build:examples    # → dist/examples
mise exec -- pnpm --filter @pmndrs/glyph-site build:docs-components  # → docs/assets/explainer.{js,css}, for the pages
mise exec -- pnpm --filter @pmndrs/glyph-site check:examples    # typecheck + both builds
mise exec -- pnpm --filter @pmndrs/glyph-site test              # the explainer's unit tests
GLYPH_SOURCE=/path/to/checkout/packages/glyph mise exec -- pnpm --filter @pmndrs/glyph-site check:snippets
                                                                # every ts/tsx block in the docs typechecks against that checkout
```

The docs pages are scaffolds: their code blocks are the canonical API (`glyph.fontFace(url)`, `await face.load()`,
`face.slug`, `bitmap({ strikes })`) and are typechecked by `check:snippets`; the scenes here are written against
what the checkout accepts today and are ported after the API merges. See "Page format" in
`docs/planning/docs-site-outline.md`.

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
3. Embed it from the page with `<glyph-proxy root="scenes" data-scene="<slug>" aria-label="…" aspect="16 / 9" />`
   under the page's `<glyph-explainer-root id="scenes" data-explainer-page="examples" …/>`. The gallery lists the
   catalog, so it has the card already.

## Attribution

- The kinetic typography showcase is after [Kinetic Typography with Three.js](https://tympanus.net/codrops/2020/06/02/kinetic-typography-with-three-js/) by Mario Carrillo for
  Codrops (2020): text rendered to a render target and wrapped around a torus knot with a scrolling `uv * repeat`.
  The engine replaces the bitmap font; the passages are Emily Dickinson (1861) and Walt Whitman (1855), public
  domain.
