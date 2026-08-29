# @pmndrs/glyph

Portable font baking, Unicode shaping, paragraph layout, and batched text rendering for every Canvas.

`@pmndrs/glyph` retains authored text, shapes and lays it out in Rust/Wasm, then publishes a transient render plan for the active renderer. The maintained Three.js integration supports Bitmap, MSDF, and Slug through WebGPU and Three's WebGL fallback.

## Render text with React Three Fiber

```tsx
import { Text, TextGroup } from '@pmndrs/glyph/react';
import { useBitmapFont } from '@pmndrs/glyph/react/bitmap';
import { useMSDF } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';

const VT323 = '/fonts/VT323.font.glb';
const INTER = '/fonts/Inter.font.glb';
const LOVERS_QUARREL = '/fonts/LoversQuarrel.font.glb';

useMSDF.preload(INTER);

function Labels() {
  const inter = useMSDF(INTER);
  const loversQuarrel = useSlug(LOVERS_QUARREL);
  const vt323 = useBitmapFont(VT323, { strikes: [8, 16] });

  return (
    <>
      <Text
        font={loversQuarrel}
        style={{ fontSize: 32, color: '#f7f7f7' }}
        layout={{ align: 'center' }}
        constraints={{ width: { mode: 'exact', size: 480 } }}
        position={[0, -4, 0]}
      >
        Lorem <Text style={{ color: '#f70000' }}>Ipsum</Text>
      </Text>
      <TextGroup>
        <Text
          font={inter}
          style={{ fontSize: 32, color: '#f7f7f7' }}
          layout={{ align: 'center' }}
          constraints={{ width: { mode: 'exact', size: 480 } }}
          position={[0, -1, 0]}
        >
          Eos tempor iusto mollit reprehenderit dolor cillum.
        </Text>
        <Text
          font={inter}
          style={{ fontSize: 32, color: '#f7f7f7' }}
          layout={{ align: 'center' }}
          constraints={{ width: { mode: 'exact', size: 480 } }}
          position={[0, -1, 0]}
        >
          Irure accusamus voluptate est cupidatat eu commodo.
        </Text>
      </TextGroup>
      <Text
        font={vt323}
        style={{ fontSize: 8, color: '#f7f7f7' }}
        layout={{ wrap: 'word' }}
        constraints={{ width: { mode: 'at-most', size: 480 } }}
        position={[0, 0, 0]}
      >
        lorem ipsum dolor sit amet consectetur adipiscing elit eiusmod anim vel proident nam sint quo laborum ut eu amet
        quis placeat qui reprehenderit in ad est accusamus et cupiditate fugiat voluptas ipsum et lorem nulla aut animi
        et aut reprehenderit harum commodo quas et pariatur sit omnis ad harum aute
      </Text>
    </>
  );
}
```

An outer `Text` is a retained paragraph and a Three `Object3D`. A nested `Text` is an inline run: it inherits the surrounding font, text style, and material unless it overrides them, and creates no scene object. The React integration rejects box-level props on nested text because JSX does not preserve enough generic element identity for TypeScript to enforce that distinction at every composition boundary. Runs may not always land in the same draw if they cannot be batched with their parent.

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
  style: { fontSize: 32, lineHeight: 1.2, color: '#f4f7ff' },
  layout: { wrap: 'word' },
  constraints: { width: { mode: 'at-most', size: 480 } },
});

labels.add(label);
scene.add(labels);
```

Three uses `txt` and `span` where React uses nested `Text`. A span may override its font selection or text style without manually maintaining UTF-16 ranges; the Three `spans` form also accepts a material override.

Add a `Text` directly to the scene when it does not need to share a batch. The nearest `TextGroup` applies all pending descendant changes together during Three's normal scene traversal.

Paragraph layout may also declare `columns: { count, gap }` to flow one paragraph through side-by-side ordered columns. Columns fill in order without balancing, so the last column may run short, and an exact width constraint is required.

Setters update the desired state, mutating the text or style property will not mark the label as dirty:

```ts
label.text = 'Updated label';
label.style = { ...label.style, letterSpacing: 0.5 };
label.position.x += 1;
```

Assigning `text` queues the narrowest UTF-16 edit between the previous string and the new one, so an editor sends one
narrow update per keystroke without describing the edit itself.
`measure()` synchronously measures current desired state without traversing matrices, realizing renderer resources, or
publishing a draw. `glyphs()` explicitly requests the current positioned line and
glyph details.

## Measure before you render

A `Text` can be measured before its first rendered frame, whether or not it has scene ancestry. Measurement does not
require `scene.updateMatrixWorld()` and does not create renderer resources:

```ts
scene.add(label);
const measuredLabel = label.measure();
label.position.x = -measuredLabel.contentWidth / 2;
renderer.render(scene, camera);
```

Use `Paragraph` when no Three object should exist. It measures synchronously with no scene, renderer, world matrix, or
committed frame—which is also what a flexbox engine needs from inside its measure callback.

```ts
import { createParagraph, txt } from '@pmndrs/glyph';

const paragraph = await createParagraph({ font: inter, text: txt`Hello world`, layout: { wrap: 'word' } });
const measured = paragraph.measure({ width: { mode: 'at-most', size: 360 } });

measured.contentWidth; // advance extent
measured.firstBaseline; // from the box top edge
measured.ascent; // per paragraph; per line on measured.lines
measured.minContentWidth; // longest unbreakable run, from the same pass
```

Every value is paragraph-local: the origin is the box's top-left corner, positive X is right, positive Y is down.
Scale and placement are yours to apply afterwards.

`measure()` returns sizes, baselines, counts, and intrinsic widths without per-glyph array copies. A cache miss may
synchronously incur font and layout lookup work. When you need positioned output (`x`, `y`, `glyphIds`, ink boxes),
call `glyphs()`; its cache miss may synchronously incur glyph lookup and positioning, and every call returns
caller-owned column copies. Both canonical caches are three-entry LRUs covering the normal unconstrained, at-most, and
exact negotiation cycle. A caller that probes sizes alone never pays for arrays it never touches. A query answers or throws:
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

Call `dispose()` when a `Text`, `TextGroup`, loaded font, or loader will not be reused. Disposing a group releases its render planner and renderer resources but does not dispose descendant `Text` objects, which may move to another live group.

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
binds fonts, and creates a render planner with a target. None is a canvas or GPU device; the target connects one planner's
transient render plans to renderer-owned resources and submission.

The external example packages exercise that lifecycle against a real TypeGPU/WebGPU device. This is the same public
sequence used by the hardware renderer lab:

```ts
import { createFontStack, loadFont } from '@pmndrs/glyph';
import { createGlyphEngine } from '@pmndrs/glyph/core';
import { glyphExample } from '@pmndrs/glyph-example-raster';
import { ExampleTextEngine, TypeGpuExampleRendererDevice } from '@pmndrs/glyph-example-renderer';

const adapter = await navigator.gpu.requestAdapter();
if (adapter === null) throw new Error('WebGPU is unavailable');
const gpuDevice = await adapter.requestDevice();

const glyphEngine = await createGlyphEngine();
const device = new TypeGpuExampleRendererDevice({ device: gpuDevice, width: 768, height: 192 });
const renderer = new ExampleTextEngine(glyphEngine, device);
const font = await loadFont(
  { baked: '/fonts/Inter.font.glb' },
  { technique: glyphExample, options: { paletteSeed: 17, inset: 0.08 } },
);
const stack = renderer.bindFontStack(createFontStack(font));
renderer.openPlanner();
const title = renderer.createText({
  font: stack,
  text: 'Portable TypeGPU',
  fontSize: 64,
  width: 768,
  height: 192,
});

const initial = title.publish();
const initialPixels = await device.readPixels();
if (initial.draws.length === 0 || initialPixels.every((byte) => byte === 0)) {
  throw new Error('the renderer produced no visible draw');
}

title.update({ text: 'Updated WebGPU', color: '#ff40a0' });
title.publish();

title.dispose();
stack.dispose();
renderer.dispose();
font.dispose();
device.dispose();
glyphEngine.dispose();
gpuDevice.destroy();
```

`ExampleTextEngine` is intentionally an external integration rather than privileged Glyph code. Its implementation uses
only the public `/core` sequence: `glyphEngine.createBackend()`, `backend.installPolicy()`, font binding,
`backend.createPlanner()`, `planner.createText()`, and `planner.publish()`. Its synchronous `PlanTarget` acquires portable
payload leases, stages resource and submission transactions, commits them, and releases retired resources. The semantic
record readers are its public decoding surface; raw ABI offsets are package-private.

`PlanTarget` is the normal zero-copy path because CPU-side GPU encoding is synchronous. Use `AsyncPlanTarget` only when
the candidate crosses an asynchronous boundary such as a Worker; it receives one self-owned copy and must return that
same transfer buffer. See the [renderer integration guide](docs/guides/renderer-integration.md) and the
[`glyph-example-renderer` source](packages/glyph-example-renderer/src/engine.ts) for the complete target, resource,
checkpoint, retirement, and device-replacement implementation.

`publish()` emits no measurement or glyph-inspection sidecar unless requested. Three requests aggregate measurements
when changed text is published so current bounds are available in the same frame; it does not request per-glyph layout
inspection. Custom renderers should request `semanticViews: 'measurement'` only when they need the same cache behavior,
and reserve `'layout-inspection'` or `'all'` for consumers that need positioned glyph columns.

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

The resulting render plan is fixed-record data: a transient revisioned display-list and resource transaction, not executable bytecode and not a GPU-specific command stream. It contains:

- identity and revision requirements;
- resource and physical-buffer lifetimes;
- allocate, resize, write, copy, and retirement patches;
- ordered glyph, decoration, inline-object, and clip primitives; and
- draw packets with exact buffer, resource, program, material, and ordering identities.

No GPU is required to shape, lay out, execute the policy, or produce this plan. The renderer begins GPU work only when it realizes the plan. Adjacent revisions carry minimal policy-costed patches; a consumer that misses the required base revision receives a complete checkpoint instead of applying an unsafe delta.

### Implement a renderer

A renderer integration has five responsibilities:

1. Compose and install one backend policy and capability set before the first text update.
2. Resolve each loaded font's portable plan and compile its binding/resources into the policy's cold table.
3. Apply plan resource and buffer operations, then upload the declared patch ranges.
4. Realize materials and submit draw packets without re-shaping, re-sorting, or reconstructing layout.
5. Return transactional acceptance only after CPU consumption and renderer commit have completed.

Three is the maintained reference executor. Bitmap, MSDF, and Slug register portable plans and compiled resources through the same `/core` contract as external techniques; Three retains only their shader/material and GPU realization. A custom Three technique registers its portable plan in `/core`, then selects one compatible `{ technique, variant }` through `registerThreeRasterPlanProgram`; Three assembles the host policy, and only the shader/material realization half uses `threePolicyAbi`.

Each technique declares which authored text effects its portable policy and shader support. MSDF supports outline and
shadow; Bitmap and Slug currently support neither. Unsupported effects throw when the style enters `Text`, `Paragraph`,
or a `/core` render planner instead of being dropped from the plan.

The renderer-neutral engine and backend contracts, frame wire, policy authoring toolkit, and plan view publish as `@pmndrs/glyph/core`, and the technique shaders as `@pmndrs/glyph/tsl` and `@pmndrs/glyph/typegpu` — the [Core API](#core-api) section shows the four moves. A new engine integration should start from the [renderer integration guide](docs/guides/renderer-integration.md), which walks all five responsibilities above with working code, then use the [Rust layout engine contract](docs/planning/rust-layout-engine.md#render-plan-policy) and the [Three executor](docs/planning/three-api.md) as reference material.

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
