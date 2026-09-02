---
type: Implementation Plan
title: Documentation site and landing page
description: Design for the site/ workspace surface — a pmndrs/docs MDX documentation build and a WebGPU landing page whose hero renders the wordmark through the library itself — composed into one GitHub Pages artifact that stays unpublished until the publish decision.
documentation_type: explanation
status: draft
tags: [planning, site, documentation, landing, three, tsl, slug, deployment]
generated:
  by: 'anthropic/claude-opus-5'
  at: '2026-08-25T00:00:00Z'
sources:
  - id: pmndrs-docs
    resource: https://github.com/pmndrs/docs
    title: pmndrs MDX static documentation generator
  - id: uikit-static
    resource: https://github.com/pmndrs/uikit/blob/main/.github/workflows/static.yml
    title: uikit multi-artifact GitHub Pages composition
  - id: paris-site
    resource: https://github.com/pmndrs/paris-site
    title: pmndrs paris-site — WebGPU alpha stack consuming @pmndrs/glyph
  - id: playwrite
    resource: https://github.com/TypeTogether/Playwrite
    title: Playwrite type family upstream source
  - id: text-material
    resource: ../../packages/glyph/src/three/material.ts
    title: Renderer-owned text material factory
  - id: text-properties
    resource: ../../packages/glyph/src/text-properties.ts
    title: Paragraph content-box, column, and justification properties
  - id: editorial-flow
    resource: editorial-flow-layout.md
    title: Responsive editorial flow and mixed-raster composition
  - id: r3f-hello-world
    resource: ../packages/r3f-hello-world.md
    title: Minimal public R3F example package
---

# Documentation site and landing page

The page-by-page map of the published docs — every page's sections, code evidence, example, and source — is
[the documentation site outline](docs-site-outline.md); the stubs under `site/docs` follow it.


Status: accepted direction; nothing is published until the publish decision is taken separately.

## Outcome

One deployable web surface under `site/`, built from two independent static outputs composed into a single
GitHub Pages artifact:

```
/            landing — WebGPU hero rendering the wordmark through @pmndrs/glyph
/docs/*      documentation — pmndrs/docs static export from MDX
```

The landing page is not decoration around the library. Its hero is the library's own output: exact HarfRust
shaping, a Slug render plan, a renderer-owned node material, and a three-column justified multi-script
composition. Every visual claim on the page is produced by the code the page documents.

## Why `site/` and not `apps/` or `packages/`

`packages/*` holds library units. `apps/*` holds runnable examples and maintainer tools, and is expected to
narrow toward examples. A deployable public web surface is neither, so it takes a third top-level category.
`AGENTS.md` gains `site/` alongside `packages/` and `apps/` in its no-root-artifacts rule, and
`pnpm-workspace.yaml` gains the entry.

Every other `pmndrs/*` repository puts its MDX in root `docs/`. This repository cannot: root `docs/` is the
Open Knowledge Format bundle. `site/docs/` keeps the upstream name one level down, so the generator argument
reads `site/docs` exactly as uikit's reads `docs`.

## Layout

```
site/
├─ package.json      @pmndrs/glyph-site — private; owns build, preview, check
├─ docs/             pure MDX; the generator's input folder
│  └─ getting-started/introduction.mdx
├─ landing/          Vite + React 19 + R3F application
│  ├─ index.html
│  ├─ vite.config.ts
│  ├─ assets/        baked .font.glb files and the license notice
│  └─ src/
├─ scripts/
│  └─ preview.mts    @workflow site:preview
└─ dist/             gitignored; composed exactly as Pages serves it
```

One package rather than two. `build` composes `dist/` into the deployed layout — landing at the root, docs
under `/docs` — so a local preview is the real thing. The generator has no watch mode, which makes a preview
that matches production worth more than package isolation. The cost is that Vite dependencies and the
documentation build share one manifest; accepted deliberately.

## Documentation surface

`@pmndrs/docs` v4 is a published CLI, not a repository to fork. It is invoked through `pnpm dlx` at an exact
pin so a preview is reproducible and a version bump is a reviewable commit.

```sh
pnpm dlx @pmndrs/docs@4.1.2 build site/docs site/dist/docs --format website \
  --libname '@pmndrs/glyph' --libname-short glyph --icon ♠️ \
  --github https://github.com/pmndrs/glyph \
  --home-redirect /getting-started/introduction
```

Every environment variable in the upstream README has a matching flag, so configuration lives in the package
manifest rather than an exported shell block. `--base-path` is omitted until publication, when it must agree
with the landing page's Vite `base`.

`ICON` accepts either an emoji or a path beginning with `/` resolved against `MDX_BASEURL`. The path form
requires serving the MDX folder, so the emoji form is used until there is a published base URL.

## Landing surface

### Stack

`pmndrs/paris-site` establishes that this alpha family works, and it already consumes this library:

| dependency | version | evidence |
| --- | --- | --- |
| `@react-three/fiber` | `10.0.0-alpha.3` | the repository pin; see the note below |
| `@react-three/drei` | `11.0.0-alpha.5` | peers `@react-three/fiber: >=10.0.0-0`; ships a `./webgpu` entry |
| `three` | `0.185.1` | repository pin |
| `@pmndrs/glyph` | `workspace:*` | this repository |

The site tracks the repository's existing `@react-three/fiber` pin rather than setting its own. paris-site,
`packages/glyph`, and `apps/r3f-hello-world` all sit on `10.0.0-alpha.3`, so that is the proven combination,
and drei's alpha.5 peers `>=10.0.0-0`, so nothing here requires moving past it. A single pin also keeps one
reconciler in the install; two versions in one workspace would install two copies.

Bumping the alpha is deliberately **not** part of this work. It is a core change with a core blast radius —
`packages/glyph`, `apps/benchmarks`, and `apps/r3f-hello-world` all move together, `tests/package/r3f-webgpu.test.mjs`
asserts the pin by exact version, and alpha.4 was measured to break `<Text paint={...}>` type-checking in
`tests/types/r3f-v1-api.test.ts`. That belongs in its own pull request, reviewed as an upgrade, not as a
passenger in a documentation-site branch.

Post-processing does **not** use `@react-three/postprocessing`, which wraps the WebGL `EffectComposer` and is
incompatible with `three/webgpu` node materials. paris-site carries no such dependency. The WebGPU path is
`useRenderPipeline` from `@react-three/fiber/webgpu` composed with TSL display nodes from
`three/examples/jsm/tsl/display/`.

The canvas follows `apps/r3f-hello-world`: `Canvas` from `@react-three/fiber/webgpu` with a `fallback`
element, so WebGPU-capable browsers use it and the rest fall back to Three's WebGL2 backend.

### Hero

The wordmark is **`glÿph`**, set in Playwrite US Trad Regular through the Slug technique.

Slug rather than MSDF or bitmap: the wordmark is the largest element on the page and may scale with the
viewport, and Slug renders exact curves at any magnification. paris-site uses MSDF for small billboarded
letters, which is the right choice there and the wrong one here.

The diaeresis is decorative — a metal umlaut in the Queensrÿche tradition. It carries no phonetic weight,
because a diaeresis marks vowel hiatus and `glyph` has no vowel cluster to break. It is not load-bearing for
pronunciation and is not claimed to be. It earns its place technically instead: the hero text is encoded
**decomposed** as `y` + `U+0308 COMBINING DIAERESIS`, so correct placement over a cursive descender requires
GPOS mark-to-base attachment. The wordmark is therefore its own shaping proof.

The `g` stays bare. Every Latin orthography that marks a `g` — Maltese `ġ`, Esperanto `ĝ`, Turkish `ğ`, Irish
lenition — marks it to soften it. An unmarked `g` is the strongest available assertion of the hard /ɡ/.

Material authority is the public extension point:

```ts
defineTextMaterial((context) => {
  // context.shader — the Slug technique's TSL output
  // context.position — final renderer-local position with policy transform indirection
  // context.createDefaultMaterial() — the technique's own material
  return material // any NodeMaterial
})
```

The hero material is a lit `NodeMaterial` with a rim term, animated specular glints, and an emissive floor
that feeds bloom. `components/hero-demo/lettering.tsx` in paris-site is the reference for the plumbing —
`positionNode`, `colorNode`, `opacityNode`, `lightsNode`, `emissiveNode` — not for the look.

Lighting moves. Post-processing is bloom at minimum, applied through the render pipeline rather than a
per-material approximation.

#### Guide rules

`PlaywriteUSTradGuides-Regular.ttf` draws the baseline, x-height, ascender, and descender rules inside each
glyph's advance — the same quantities the layout engine computes. `glyph` spans all four: `g`, `y`, `p`
descend and `l`, `h` ascend. The upstream article also documents the underscore as a key character that
renders guides with no letter, which extends the rules past the word.

Preferred treatment is two registered layers — rules in a dim blueprint material, letters in the hero
material — which requires the two faces to share advance widths. Same design, guides drawn inside the same
advance, so this is expected to hold, but it is a verification gate below rather than an assumption. The
single-layer fallback bakes only the Guides face and accepts one shared material.

### Background composition

Three justified columns of the word in many writing systems, dimmed behind the hero. Public API today:

```ts
contentBox: {
  width: { mode: 'exact', size },
  align: 'justify',
  columns: { count: 3, gap },
  justify: { maxWordSpaceRatio },
}
```

Columns fill in order without balancing, so the final column may run short; acceptable for a decorative field.

**No exclusions and no hole.** The engine lays out rectangular content boxes and cannot flow text around a
contour — see [the current boundary](editorial-flow-layout.md). The hero sits over the columns. Text that
reflows around the wordmark is committed as follow-on work, below.

Word set, resolved through one ordered font stack so the engine performs the script fallback rather than the
application selecting fonts per word:

| language | word | script |
| --- | --- | --- |
| English | glyph | Latin |
| Greek | γλυφή | Greek |
| Russian | глиф | Cyrillic |
| Arabic | حرف | Arabic |
| Hindi | अक्षर | Devanagari |
| Japanese | 文字 | Han |
| Chinese | 字形 | Han |
| Korean | 글자 | Hangul |

γλυφή is the etymological root of the word and carries a real acute accent. Every mark in the background is
linguistically correct; the one invented mark on the page is the hero's, and it is doing engineering work.
The set exercises RTL, conjuncts, and CJK in a few kilobytes of subsetted font data.

### Responsive behavior and links

Column count and type size step with the viewport; box geometry derives from `viewport` rather than fixed
sizes. Navigation — npm, GitHub, docs — is DOM positioned over the canvas, centered below the wordmark, and
remains reachable when the canvas fails to initialize.

## Fonts and baking

Playwrite is variable-only in `google/fonts`, and the baker rejects variable input with
`BakeErrorCode::UnsupportedVariableFont`. The upstream project ships static instances at the same commit
`google/fonts` pins, so no font instancing tool and no Python toolchain enter the repository.

| asset | source |
| --- | --- |
| `PlaywriteUSTrad-Regular.ttf` | `TypeTogether/Playwrite@02e4e157`, `fonts/ttf/` |
| `PlaywriteUSTradGuides-Regular.ttf` | same |
| Inter, Amiri, Noto Devanagari, Noto Sans CJK | existing repository fixtures |

Fixtures sync through `syncImmutableFixture` with SHA-256 pins and checked-in licenses, matching
`apps/benchmarks/scripts/sync-amiri-fixture.mts`. Baking uses `pnpm exec glyph bake` with `--unicodes`
restricted to the exact codepoints rendered, plus `bake:check` for byte-identical rebakes, matching
`apps/r3f-hello-world`. A combined license notice ships with the built site.

## Composition and deployment

GitHub Pages deploys one artifact. uikit's `static.yml` establishes the merge: the reusable
`pmndrs/docs/.github/workflows/build.yml` uploads its own `github-pages` artifact, a downstream job untars it
alongside sibling outputs, re-tars the whole tree, and `actions/deploy-pages` is pointed at the merged
artifact. This repository would pin `@v4` rather than uikit's `@v2`.

**No workflow file ships in this work.** Nothing is published, so there is nothing to disable. CI lands with
the publish decision, together with the base-path choice it depends on:

| | project pages | custom domain |
| --- | --- | --- |
| Vite `base` | `/glyph/` | `/` |
| `--base-path` | `/glyph/docs` | `/docs` |

Both builds must read the same value. Local preview uses the custom-domain form.

## Verification gates

The package `check` is the cheap MDX fragment compile plus formatting; the full static export belongs to
`build`. Beyond that, these must be proven rather than assumed:

1. **Mark attachment** — `y` + `U+0308` renders identically to precomposed `U+00FF`. `GDEF`/`GPOS` are present
   in the font, which is not proof of coverage. Falls back to the precomposed codepoint.
2. **Guide registration** — the Guides and text faces produce identical advances, so two layers register.
   Falls back to a single Guides layer.
3. **WebGL2 fallback** — the hero is judged on Three's fallback backend, not only WebGPU. CI runners have no
   WebGPU, so this is also the only path CI can observe.
4. **drei under WebGPU** — each drei component used is verified against the alpha pair rather than assumed
   from paris-site's usage of different components, and against alpha.4 rather than the alpha.3 it is proven on.
5. **Deterministic bakes** — `bake:check` passes byte-identically.
6. **Payload** — the subsetted multi-script set is measured against the page budget, not estimated.

## Committed follow-on: Milestone 12 flow regions

Once the composition is right, the hole is built rather than faked. What this page wants is Milestone 12's
**core** — conservative line-box collision against explicit authored two-dimensional exclusions — not the
tier deferred beyond it, which is deriving exclusions automatically from glyph ink or rendered pixels.

The shaping engine is not the missing piece; the flow planner between measurement and positioning is. There
is a head start: `columns` already flows one paragraph through ordered slots, and D-197 already describes
slot-local alignment and justification. What is missing is more than one usable interval on a single baseline
plus per-band geometry.

It remains milestone-sized rather than task-sized, because it lands in the most invariant-dense code in the
repository: the fit loop moves from one available width per line to per-slot fragment continuation, fragment
emission must keep reading order separable from visual order, UAX #9 reordering across a split baseline is the
hard correctness case, and the fixture re-pin cascade is a costed activity here rather than a side effect.

This plan commits to sequencing it after the composition lands, on its own merits as a headline capability.
The landing page does not block on it, and nothing built now is discarded when it arrives: authored content
boxes become authored exclusions and the page reads strictly better.

## Delivery

Stacked pull requests off `main`, through `gh stack`:

1. **Design and documentation shell** — this document, the roadmap entry, the decision-register entry,
   `site/` registration, the MDX shell, and the preview workflow.
2. **React Three Fiber alpha.4** — one workspace-wide bump to `10.0.0-alpha.4`, gated by the existing
   `apps/r3f-hello-world` check. Independent of the shell above and a prerequisite for the landing below.
3. **Landing page** — font fixtures, bake scripts, the Vite application, the hero and background composition,
   and the composed `site/dist` build.

Publication — the CI workflow, the base path, and the Pages settings — is a separate decision taken once
these land.
