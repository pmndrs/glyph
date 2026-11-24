---
type: Log Entry
title: 'Docs site collapsed onto 0.2.0, rebuilt on Diátaxis with a live demo per feature'
generated:
  by: process:docs-new
  at: '2026-11-24T05:28:02Z'
---

The three divergent docs-site branches are one site on `experiments/sil-docs-site`, based on the 0.2.0 integration
branch and merged separately from it. `site/` came from `feat/glyph-docs-explainers` (pmndrs/glyph#138), a file-level
superset of `feat/docs-site-bootstrap-ac8db7` (#149) and `feat/docs-site-modern-api-recovery` (#132); the poster
capture script came back from #149. Nothing under `packages/` changed.

What changed:

- **0.2.0 port.** Every scene and page uses the 0.2.0 API: `split()`, the editing methods (`hitTest`, `caret`, `move`,
  `boundary`, `rangeRects`, `replace`), errors thrown from the render instead of `onError`, and deferred never-stale
  reads. 559 `ts`/`tsx` fences typecheck against the package (`site:check-snippets`).
- **Explainer element.** One renderer and one GPU device per page drive every `<glyph-proxy>`. A proxy shows its
  poster until its first frame, streams while it holds a lease, and holds its last frame afterwards; its scene stays
  mounted and paused in its pool slot, the pool recycles the least recently used free slot at its limit, and input
  goes to the proxy it was made on through one ordered stream. Poster and canvas live in a shadow tree, which removed
  a hydration mismatch on the docs pages.
- **Sections.** The scene catalog is split into explainer sections (`start`, `layout`, `styling`, `fonts`, `editing`,
  `inspect`, `scene`, `motion`). A docs page's root names the sections it embeds and fetches only those tables and
  the scenes its proxies show.
- **Diátaxis.** The scaffold pages were replaced by 96 written pages: 3 routing, 3 tutorials, 54 how-to guides, 28
  reference pages and 8 explanation pages, with 65 live scenes. `site/feature-inventory.md` maps every public feature
  to its page and demo.
- **Verification.** `site:verify-browser` and `site:verify-pages` drive the built site in a GPU-enabled Chromium;
  `site:check-scene` does the same for one scene on the dev server.

Decisions made here, for review:

- The site's demo host is three.js through React Three Fiber. Vue, TypeGPU and PixiJS 3D are documented with snippets
  and no live scene.
- The pinned `@pmndrs/docs@4.1.2` serializes every page's compiled body into every page. `site/scripts/docs-generator.mts`
  edits the generator's layout in the site's own npx cache before building, which took a page from 9.4 MB to 1.6 MB of
  HTML. This belongs upstream.
- The docs are built with `--base-path /docs`, so the composed `dist/` serves as deployed: landing at `/`, docs at
  `/docs/`, examples at `/examples/`.

The package behaviours the writers found while verifying claims against source became the issue records in
[issues-0.2.0](../planning/issues-0.2.0/index.md). After the integration branch fixed them, the branch was merged in
and the pages follow it: the overflow rule (`'clip'` keeps only fitting lines, `'visible'` adds the one straddling
line in the last region, no clip ids), no `order` on Three text, no `--yes`, `GlyphInputError` from `Pixi3DText`, the
`DropCapLayout` export, and `onInvalidate` for material and group changes. The OpenType-features guide marks the
features a subset bake drops as pending the bake-option change.

The landing page shipped a wordmark font baked by a September package, which the 0.2.0 loader rejects as invalid.
It is rebaked by `site:bake-wordmark`, the landing sources are checked in under `site/landing/sources/`, a site test
validates every shipped font artifact against the package validator, and `site:verify-browser` loads the landing page
and fails on any console error or warning.
