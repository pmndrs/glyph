# @pmndrs/glyph

Portable font baking, Unicode shaping, paragraph layout, and batched text rendering for every Canvas.

`@pmndrs/glyph` shapes and lays out text in Rust/Wasm, then publishes a retained render plan for the active renderer. The maintained Three.js integration supports Bitmap, MSDF, and Slug through WebGPU and Three's WebGL fallback.

## Where to import from

The root is the vocabulary of text — fonts, authoring, layout and measurement types, technique definition — and
every consumer speaks it. `@pmndrs/glyph/three` and `@pmndrs/glyph/react` are integrations, and they publish only
their own surface. `@pmndrs/glyph/core` is for implementing an integration: the render policy, the render plan, the
frame wire and its handoff. It is additive to the root rather than parallel to it, so a custom renderer imports both.
The [renderer integration guide](docs/guides/renderer-integration.md) walks that path end to end: declaring a
technique schema, authoring and registering a policy, driving a retained plan, reading all seven plan tables, and
implementing the retention and patch protocols.

The repository's `glyph-example-raster` and `glyph-example-renderer` packages are the external-consumer proof of that
boundary. The raster package publishes renderer-neutral data plus explicit `/typegpu` and `/tsl` shader artifacts; the
renderer package consumes `/core` and `/typegpu` without Three.js and realizes named resources plus synthetic or
supplied geometry through a real TypeGPU/WebGPU submission that produces changing pixels. Three-specific material and
registration code belongs in `@pmndrs/glyph/three` or in the consumer's Three integration, never in the portable raster
entrypoint. Importing a technique root registers only its
portable plan; shader subpaths carry no renderer registration, so each engine or application explicitly selects the
variant it supports.

The rule, if you are deciding where something belongs: **a type an application can encounter lives at the root; a
thing only an integrator constructs lives in `/core`.** That is why `Paragraph`, `Font`, and their measurement types
are at the root, while engine, backend, retained-plan, policy, and plan-target construction stays in `/core`.

## Render text with React Three Fiber

```tsx
import { Text, TextGroup, useFont } from '@pmndrs/glyph/react';
import { msdf } from '@pmndrs/glyph/three/msdf';

const interFont = { baked: '/fonts/Inter.font.glb' } as const;

useFont.preload(interFont, msdf);

function Labels() {
  const inter = useFont(interFont, msdf);

  return (
    <TextGroup compositing="independent">
      <Text
        font={inter}
        contentBox={{ width: { mode: 'at-most', size: 480 }, wrap: 'word' }}
        style={{ fontSize: 32, lineHeight: 1.2 }}
        paint={{ color: '#f4f7ff' }}
      >
        Hello <Text paint={{ color: '#70d6ff' }}>world</Text>
      </Text>
    </TextGroup>
  );
}
```

For a built-in technique, typed convenience hooks use the same R3F loader cache as generic `useFont`:

```tsx
import { useBitmapFont } from '@pmndrs/glyph/react/bitmap';
import { useMSDF } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';

function Fonts() {
  const bitmap = useBitmapFont({ baked: '/fonts/inter.font.glb' }, { strikes: [16, 32] });
  const msdf = useMSDF({ baked: '/fonts/inter.font.glb' });
  const slug = useSlug({ baked: '/fonts/inter.font.glb' });
}

useBitmapFont.preload({ baked: '/fonts/inter.font.glb' }, { strikes: [16, 32] });
useMSDF.preload({ baked: '/fonts/inter.font.glb' });
useSlug.preload({ baked: '/fonts/inter.font.glb' });
```

An outer `Text` is a retained paragraph and a Three `Object3D`. A nested `Text` is an inline run: it inherits the surrounding font, style, paint, and material unless it overrides them, and creates no scene object. The runtime rejects box-level props on nested text because JSX does not preserve enough generic element identity for TypeScript to enforce that distinction at every composition boundary. Runs may not always land in the same draw if they cannot be batched with their parent.

`TextGroup` is an optional batching and ordering boundary. It collects descendant `Text` objects through the ordinary scene graph, so regular Three groups may appear between them. A standalone `Text` has the same text semantics and lazily owns an implicit batch of one.

`compositing="ordered"` preserves authored draw order and is the default. Use `independent` only when overlapping text does not depend on blending order as it lets the planner reorder compatible work into fewer draws.

## Render text with Three.js

```ts
import { span, txt } from '@pmndrs/glyph';
import { FontLoader, Text, TextGroup } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/three/msdf';

const loader = new FontLoader();
const inter = await loader.loadAsync({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: msdf },
});

const accent = span({ color: '#70d6ff' });
const labels = new TextGroup({ compositing: 'independent' });
const label = new Text({
  font: inter,
  text: txt`Hello ${accent`world`}`,
  contentBox: { width: { mode: 'at-most', size: 480 }, wrap: 'word' },
  style: { fontSize: 32, lineHeight: 1.2 },
  paint: { color: '#f4f7ff' },
});

labels.add(label);
scene.add(labels);
```

Three uses `txt` and `span` where React uses nested `Text`. A span may override its font selection, shaping style, paint, or material without manually maintaining UTF-16 ranges.

Add a `Text` directly to the scene when it does not need to share a batch. The nearest `TextGroup` applies all pending descendant changes together during Three's normal scene traversal.

A content box may also declare `columns: { count, gap }` to flow one paragraph through side-by-side ordered columns. Columns fill in order without balancing, so the last column may run short, and an exact `width` is required.

Setters update the desired state, mutating the text or style property will not mark the label as dirty:

```ts
label.text = 'Updated label';
label.style = { ...label.style, letterSpacing: 0.5 };
label.position.x += 1;
```

Assigning `text` queues the narrowest UTF-16 edit between the previous string and the new one, so an editor sends one
narrow update per keystroke without describing the edit itself.
After a `Text` has scene ancestry, `layout()` synchronously measures its current desired state without traversing
matrices, realizing renderer resources, or publishing a draw. `glyphs()` explicitly requests the committed line and
glyph details.

## Measure before you render

An attached `Text` can be measured before its first rendered frame. Attachment supplies batch ownership; measurement
does not require `scene.updateMatrixWorld()` and does not create renderer resources:

```ts
scene.add(label);
const measuredLabel = label.layout();
label.position.x = -measuredLabel.contentWidth / 2;
renderer.render(scene, camera);
```

When no scene ownership should exist yet, use `Paragraph`. It measures synchronously with no scene, renderer, world
matrix, or committed frame — which is also what a flexbox engine needs from inside its measure callback. Calling
`Text.layout()` while the text is detached throws and points to this API.

```ts
import { createParagraph, txt } from '@pmndrs/glyph';

const paragraph = await createParagraph({ font: inter, text: txt`Hello world`, policy: { wrap: 'word' } });
const measured = paragraph.layout({ width: { mode: 'at-most', size: 360 } });

measured.contentWidth; // advance extent
measured.firstBaseline; // from the box top edge
measured.ascent; // per paragraph; per line on measured.lines
measured.minContentWidth; // longest unbreakable run, from the same pass
```

Every value is paragraph-local: the origin is the box's top-left corner, positive X is right, positive Y is down.
Scale and placement are yours to apply afterwards.

`layout()` returns sizes, baselines, counts, and intrinsic widths without per-glyph array copies. A cache miss may
synchronously incur font and layout lookup work. When you need positioned output (`x`, `y`, `glyphIds`, ink boxes),
call `glyphs()`; its cache miss may synchronously incur glyph lookup and positioning, and every call returns
caller-owned column copies. Both canonical caches are three-entry LRUs covering the normal unconstrained, at-most, and
exact negotiation cycle. A host that probes sizes alone never pays for arrays it never touches. A query answers or throws:
a constraint that is not finite and nonnegative throws from the call, naming the axis.

## Font Stacks - fallback fonts for missing glyphs

A FontStack created with `createFontStack` allows you to use additional fonts to lookup missing glyphs if your primary font doesn't contain that glyph. This can be helpful for rendering emoji or icons as well as using additional fonts for other languages or character sets.

```ts
import { createFontStack } from '@pmndrs/glyph';
import { slug } from '@pmndrs/glyph/three/slug';

const emoji = await loader.loadAsync({
  input: { baked: '/fonts/Emoji.font.glb' },
  raster: { technique: slug },
});

const prose = createFontStack(inter, emoji);
scene.add(new Text({ font: prose, text: 'Status 🌍' }));
```

One baked GLB may contain several raster techniques, or you may bake each technique into it's own GLB font asset. Load them together when the application needs each typed font:

```ts
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { slug } from '@pmndrs/glyph/three/slug';

const [interBitmap, interMsdf, interSlug] = await loader.loadAsync({
  input: { baked: '/fonts/Inter.font.glb' },
  rasters: [{ technique: bitmap, options: { strikes: [32] } }, { technique: msdf }, { technique: slug }],
});
```

## Capacity, materials, and ownership

Capacity is optional. A `TextGroup` defaults to 4,096-glyph chunks; a standalone `Text` defaults to a 256-glyph growing buffer. Set an explicit policy for known bounds or memory behavior:

```ts
const denseLabels = new TextGroup({
  capacity: { size: 20_000, policy: 'chunk' },
});
```

- `chunk` retains bounded chunks as demand grows.
- `grow` replaces full storage with a larger allocation.

`grow` and `chunk` both resize; `fixed` rejects an update whose glyph requirement exceeds the declared size and
keeps the last complete revision visible. The requirement is a text-length upper bound computed before shaping, so
content can be sized against the cap rather than discovered past it.

Custom materials are renderer-owned factories. Rust carries their numeric `materialId` through planning, while Three creates the actual material only when a draw needs it. Different materials may still share instance buffers.

```ts
import { defineTextMaterial } from '@pmndrs/glyph/three';

const material = defineTextMaterial((context) => {
  const value = context.createDefaultMaterial();
  // Customize the technique-specific TSL material here.
  return value;
});

const custom = new Text({ font: inter, text: 'Custom material', material });
```

Call `dispose()` when a `Text`, `TextGroup`, loaded font, or loader will not be reused. Disposing a group releases its retained plan and renderer resources but does not dispose descendant `Text` objects, which may move to another live group.

## Bake fonts

The `glyph` CLI bakes the canonical font GLB consumed by the loader. Bake one known font directly:

```sh
pnpm exec glyph bake --input Inter-Regular.ttf --output Inter.font.glb --bitmap 32 --msdf --slug
```

Add `--unicodes U+0020-007E` to bake a subset, or `--check` to rebuild temporarily and require byte-identical output.

Or let the CLI discover every `defineFont()` declaration in a project and write each artifact beside its source asset:

```sh
pnpm exec glyph bake --project-root . --entry src/text.ts --asset-root public
```

Discovery scans the declared entries, resolves each font's raster requirements from its declaration, and mirrors asset-relative outputs under `--output-root` when the artifacts belong somewhere other than the asset root. `glyph bake --help` lists every option. Runtime baking uses the same baker Wasm in a Worker and is opt-in; it is dynamically imported and split into its own chunk so it never reaches the default bundle.

Inspect authored `post` or CFF glyph names to find icon code points or produce a bake-ready Unicode set:

```sh
pnpm exec glyph glyphs fa-solid-900.ttf --name globe --json
pnpm exec glyph glyphs fa-solid-900.ttf --name globe --name earth-americas --unicode-set
```

Fonts without authored glyph names still report exact glyph IDs.

## Core API

Every Three primitive above uses the same renderer-neutral lifecycle. The application loads immutable fonts from the root
package. An integration creates one Glyph engine, creates a backend through that engine, installs its renderer policy,
binds fonts, and creates a retained plan with a target. None is a canvas or GPU device; the target connects one retained
plan's publications to renderer-owned resources and submission.

The complete public sequence is:

```ts
import { createFontStack, loadFont } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import {
  createGlyphEngine,
  readTextEngineDraw,
  readTextEnginePatch,
  type PlanCandidate,
  type PlanTarget,
} from '@pmndrs/glyph/core';

// Integration lifetime: one Wasm shaping domain, then one renderer backend.
const glyphEngine = await createGlyphEngine();
const backend = glyphEngine.createBackend({ integration: 'my-renderer' });
const policy = backend.installPolicy(myRendererPolicy);

// Application assets are renderer-neutral and may outlive this engine.
const inter = await loadFont({ baked: '/fonts/Inter.font.glb' }, msdf);
const font = backend.bindFontStack(createFontStack(inter));

const target: PlanTarget = {
  delivery: 'borrowed',
  accept(candidate: PlanCandidate) {
    // This callback is synchronous: decode, stage, and commit before it returns.
    const patches = candidate.plan.table('patches');
    for (let index = 0; index < patches.count; index += 1) {
      myRenderer.stagePatch(readTextEnginePatch(candidate.plan, patches, index));
    }
    const draws = candidate.plan.table('draws');
    for (let index = 0; index < draws.count; index += 1) {
      myRenderer.stageDraw(readTextEngineDraw(candidate.plan, draws, index));
    }
    return myRenderer.commit(candidate) ? { accepted: true } : { accepted: false, error: myRenderer.error };
  },
  dispose() {
    myRenderer.disposeTarget();
  },
};

// Retained-plan lifetime: desired text, one revision stream, and one target.
const retainedPlan = backend.createRetainedPlan({
  policy,
  target: () => target,
  limits,
  requestCapacity: 64 * 1024,
  resultCapacity: 256 * 1024,
  textCapacity: 16 * 1024,
});
const title = retainedPlan.createText({
  font,
  text: 'Hello',
  style: { fontSize: 48 },
  contentBox: { width: { mode: 'at-most', size: 800 } },
});

// Queries are explicit. A cache miss can synchronously perform layout or glyph lookup.
const metrics = title.layout();
const positionedGlyphs = title.glyphs();

// Mutations stay cheap until a query or publication needs current shaped state.
title.update({ text: 'Hello, Glyph' });
const acceptance = retainedPlan.publish();
if (!acceptance.accepted) throw acceptance.error;
```

The semantic record readers are the public decoding surface; raw ABI offsets are package-private. `PlanTarget` is the
normal zero-copy path because CPU-side GPU encoding is synchronous. Use `AsyncPlanTarget` only when the candidate crosses
an asynchronous boundary such as a Worker; it receives one self-owned copy and must return that same transfer buffer.
`backend.dispose()` closes its retained plans and bindings, while `glyphEngine.dispose()` first closes every backend and then releases
Wasm. See the [renderer integration guide](docs/guides/renderer-integration.md) for resource realization, checkpoints,
retirements, async transfer, and complete topology diagrams.

## Render policy and render plan

The public text API describes typography. A renderer policy describes how that semantic result becomes physical instance records and compatible draws. It is registered once as validated numeric data, not called as JavaScript during layout or packing.

```mermaid
flowchart LR
  mutations["Text and font mutations"] --> layout["Rust shaping and layout"]
  layout --> policy["Validated renderer policy"]
  policy --> plan["Revisioned render plan"]
  plan --> render["Renderer resources, uploads, materials, and draws"]
```

Who supplies each piece matters more than the order, because it decides what you write once and what
you write again for every engine:

```mermaid
flowchart TD
  baker["Baker<br/><i>RasterBakerModule</i>"] -->|"baked GLB: strikes, atlases, curves"| artifact["Font artifact"]
  artifact --> technique
  subgraph portable["Written once — works in every engine"]
    technique["Technique<br/><i>decode, dispose, schema</i>"]
    policy["Policy body<br/><i>portable operations</i>"]
    binding["Cold compiler<br/><i>binding bytes + resources</i>"]
  end
  technique --> policy --> assemble["Engine policy assembly<br/><i>system lanes + capabilities</i>"]
  assemble --> plan["Render plan<br/><i>fixed-record data</i>"]
  technique --> binding --> plan
  subgraph engine["Written once per engine"]
    gpu["Bind buffers, textures, resources<br/><i>from the plan</i>"]
    material["Realize material and submit"]
  end
  plan --> gpu --> draw["Draws"]
  plan --> material --> draw
```

The portable plan and compiled font result contain no renderer types. The plan owns the schema, policy body, and
cold binding/resource composition; each engine supplies its own system-lane numbers, capabilities, transform and
allocation choices, and final `PolicyProgram` assembly. Only buffer/texture/resource binding and material realization
are engine objects. A technique is therefore authored once and consumed by any renderer that can execute the plan.

The policy declares:

- supported raster techniques and paint/compositing capabilities;
- physical buffer schemas and the semantic fields they consume;
- storage and draw compatibility keys, including resource, material, clipping, depth, and ordering identity;
- allocation strategy and backend limits; and
- an upload cost model for coalescing dirty ranges or replacing a whole buffer update.

Its small forward-only packing program is the only bytecode in this design. Rust validates it before use and executes it over the semantic records, including SIMD lanes where available. It cannot branch backward, allocate, call JavaScript, or change shaping and layout.

The resulting render plan is fixed-record data. A retained display-list and resource transaction, not executable bytecode and not a GPU-specific command stream. It contains:

- identity and revision requirements;
- resource and physical-buffer lifetimes;
- allocate, resize, write, copy, and retirement patches;
- ordered glyph, decoration, inline-object, and clip primitives; and
- draw packets with exact buffer, resource, program, material, and ordering identities.

No GPU is required to shape, lay out, execute the policy, or produce this plan. The renderer begins GPU work only when it realizes the plan. Adjacent revisions carry minimal policy-costed patches; a consumer that misses the required base revision receives a complete checkpoint instead of applying an unsafe delta.

### Implement a renderer

A renderer integration has five responsibilities:

1. Compose and register one host policy and capability set before the first text update.
2. Resolve each loaded font's portable plan and compile its binding/resources into the policy's cold table.
3. Apply plan resource and buffer operations, then upload the declared patch ranges.
4. Realize materials and submit draw packets without re-shaping, re-sorting, or reconstructing layout.
5. Acknowledge completed publication generations before the planner reuses retired storage.

Three is the maintained reference executor. Bitmap, MSDF, and Slug register portable plans and compiled resources through the same `/core` contract as external techniques; Three retains only their shader/material and GPU realization. A custom Three technique registers its portable plan in `/core`, then selects one compatible `{ technique, variant }` through `registerThreeRasterPlanProgram`; Three assembles the host policy, and only the shader/material realization half uses `threePolicyAbi`.

The renderer-neutral host, frame wire, policy authoring toolkit, and plan view publish as `@pmndrs/glyph/core`, and the technique shaders as `@pmndrs/glyph/tsl` and `@pmndrs/glyph/typegpu` — the [Core API](#core-api) section shows the four moves. A new engine integration should start from the [renderer integration guide](docs/guides/renderer-integration.md), which walks all five responsibilities above with working code, then use the [Rust layout engine contract](docs/planning/rust-layout-engine.md#render-plan-policy) and the [Three executor](docs/planning/three-api.md) as reference material.

## Technique shaders on their own

The technique shaders ship without an engine or a scene attached, in two realizations of the same behaviour:
`@pmndrs/glyph/tsl` as Three.js Shading Language node graphs, and `@pmndrs/glyph/typegpu` as TypeGPU functions for any
TypeGPU host. The TypeGPU realization is pinned to the TSL one by compiling the TSL graph to WGSL and diffing against
the real generated source, rather than translating the node graph by inspection.

```ts
import { bitmapShader, msdfShader, slugShader } from '@pmndrs/glyph/tsl';
import { bitmapFragment, bitmapVertexSnapped } from '@pmndrs/glyph/typegpu';
```

## Develop

```sh
mise install
pnpm install
pnpm dev
```

### Enable the repository hooks

Every `docs/packages/<name>.md` pins a `source_digest` over its package tree, and CI rejects commits whose
digests trail their sources. Hook definitions ship versioned in the repository's `.gitconfig` (Git 2.54
config-based hooks) with their scripts in `.githooks/`; the committed pre-commit hook re-pins those digests
automatically at commit time and runs the knowledge-base validation, so the pin can never go stale by
accident. Opt in once per clone — the explicit include is the consent boundary for repository-supplied
configuration, and every future hook change then ships with `git pull`, nothing to re-run:

```sh
git config set include.path ../.gitconfig
```

Verify with `git hook list --show-scope pre-commit`. On older Git, `git config core.hooksPath .githooks`
enables the same script through the fallback dispatcher. The hook never blocks a commit: it computes
digests from the staged tree (unstaged edits never leak into a pin), rewrites and stages the affected
`docs/packages/*.md` pins automatically, and downgrades anything it cannot do — including a missing
Ruby — to a warning, leaving CI's knowledge-base gate as the enforcement. It runs on any Ruby 3.1 or
newer, however installed; no managed toolchain is required. Run it directly at any time as
`.githooks/okf-digests`.

`@pmndrs/glyph` is ESM-only and MIT licensed.
