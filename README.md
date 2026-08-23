# @pmndrs/glyph

Portable font baking, Unicode shaping, paragraph layout, and batched text rendering for every Canvas.

`@pmndrs/glyph` shapes and lays out text in Rust/Wasm, then publishes a retained render plan for the active renderer. The maintained Three.js integration supports Bitmap, MSDF, and Slug through WebGPU and Three's WebGL fallback.

## Where to import from

The root is the vocabulary of text — fonts, authoring, layout and measurement types, technique definition — and
every consumer speaks it. `@pmndrs/glyph/three` and `@pmndrs/glyph/react` are integrations, and they publish only
their own surface. `@pmndrs/glyph/core` is for implementing an integration: the render policy, the render plan, the
frame wire and its handoff. It is additive to the root rather than parallel to it, so a custom renderer imports both.

The rule, if you are deciding where something belongs: **a type an application can encounter lives at the root; a
thing only an integrator constructs lives in `/core`.** That is why `ParagraphMeasurement` is at the root and
`Paragraph` is not.

## Render text with React Three Fiber

```tsx
import { Text, TextGroup, TextSpan, useFont } from '@pmndrs/glyph/react';
import { msdf } from '@pmndrs/glyph/three/msdf';

const fontRequest = {
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: msdf },
} as const;

useFont.preload(fontRequest);

function Labels() {
  const inter = useFont(fontRequest);

  return (
    <TextGroup compositing="independent">
      <Text
        font={inter}
        contentBox={{ width: { mode: 'at-most', size: 480 }, wrap: 'word' }}
        style={{ fontSize: 32, lineHeight: 1.2 }}
        paint={{ color: '#f4f7ff' }}
      >
        Hello <TextSpan paint={{ color: '#70d6ff' }}>world</TextSpan>
      </Text>
    </TextGroup>
  );
}
```

`Text` is a retained paragraph and a Three `Object3D`. `TextSpan` is an inline run inside one: it inherits the surrounding font, style, paint, and material unless it overrides them, and it accepts nothing else, because a span is not an object in the scene and has no transform, capacity, error handler, or instance to hold a ref to. Spans may not always land in the same draw if they cannot be batched with their parent.

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
`measureLayout()` returns a compact committed paragraph summary; `inspectLayout()` explicitly requests line and glyph
details. Both read a layout the scene has already committed.

## Measure before you render

To place text correctly on the very first frame you need its metrics before a scene exists. `Paragraph` measures
synchronously with no scene, no renderer, no world matrix, and no committed frame — which is also what a flexbox
engine needs from inside its measure callback.

```ts
import { createTextRuntime, txt } from '@pmndrs/glyph';
import { Paragraph } from '@pmndrs/glyph/core';

const paragraph = new Paragraph({ font: inter, text: txt`Hello world`, policy: { wrap: 'word' } });
const measured = paragraph.measure({ width: { mode: 'at-most', size: 360 } });

measured.contentWidth; // advance extent
measured.inkBounds; // visual extent — what actually looks centred
measured.firstBaseline; // from the box top edge
measured.ascent; // per paragraph; per line on measured.lines
measured.minContentWidth; // longest unbreakable run, from the same pass
```

Every value is paragraph-local: the origin is the box's top-left corner, positive X is right, positive Y is down.
Scale and placement are yours to apply afterwards.

Sizes are immediate. `inkBounds` and the per-glyph columns resolve the positioned query the first time you read one
and stay resolved, so a host that probes many widths for sizes alone never pays to copy arrays it never touches. A
measurement answers or throws: a constraint that is not finite and nonnegative throws from the call, naming the
axis.

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

Call `dispose()` when a `Text`, `TextGroup`, loaded font, or loader will not be reused. Disposing a group releases its session and renderer resources but does not dispose descendant `Text` objects, which may move to another live group.

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

Every Three primitive above is built on a renderer-neutral core with four moves: load a font into the Wasm shaper, describe text as one serialized frame, register a validated render policy, and consume the revisioned render plan each update publishes. The engine never calls back into JavaScript during shaping, layout, or packing — a renderer only encodes requests and reads fixed-record results.

Load a font and own the engine lifecycle once:

```ts
import { createTextRuntime } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { compileRenderPolicy, TextEngineHost, textRuntimeShaper } from '@pmndrs/glyph/core';

const runtime = await createTextRuntime();
const inter = await runtime.loadFont({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: msdf },
});

// Styles reference fonts through stack handles, so bind and stack the loaded font once.
const host = new TextEngineHost(textRuntimeShaper(runtime));
host.registerPolicy(POLICY, compileRenderPolicy(myPolicy));
host.registerFontBinding(BINDING, inter.font.handle, myBindingBytes);
host.registerFontStack(STACK, [BINDING]);
```

The policy is your own declaration — `@pmndrs/glyph/core` exports the authoring toolkit (`compileRenderPolicy`, `programContext`, the wire-identity registry) that Three's first-party policy is itself built with.

Shape text — a session update is one serialized frame of mutations, constraints, and the revision handshake:

```ts
import { compileTextEngineFrameUpdate } from '@pmndrs/glyph/core';

const session = host.createSession({ handle: SESSION, requestCapacity: 4096, resultCapacity: 65536 });
const publication = session.update(
  compileTextEngineFrameUpdate({
    sessionId: SESSION,
    policyHandle: POLICY,
    capabilitySet: 1,
    expectedEngineRevision: 0,
    consumedPlanRevision: 0,
    acknowledgedPublicationGeneration: 0,
    limits,
    paragraphMutations: [{ opcode: 'upsert', paragraphId: 1, order: 0 }],
    textMutations: [{ paragraphId: 1, start: 0, deleteCount: 0, insert: 'Hello' }],
    styleMutations: [rootStyle],
    constraints: [paragraphConstraint],
    regions: [paragraphRegion],
  }),
);
```

Consume the plan. A publication is borrowed A/B memory — its bytes stay readable only until the next call into the same Wasm module, so a synchronous renderer walks it before touching the engine again. The static path applies buffer patches, then issues one draw per packet:

```ts
import { TextEngineRenderPlanView, textShaperAbi } from '@pmndrs/glyph/core';

const plan = new TextEngineRenderPlanView().bind(publication);

const patches = plan.table('patches');
const patchLayout = textShaperAbi.layouts.enginePatch;
for (let index = 0; index < patches.count; index += 1) {
  const patch = plan.record(patches, index);
  // Dispatch on plan.u8(patch + patchLayout.opcode): allocate and retire manage buffer
  // lifetimes, write copies plan.u32(patch + patchLayout.byteLength) payload bytes into
  // the buffer named by patchLayout.bufferId at patchLayout.destinationOffset, and
  // fill/copy move data without a payload.
}

const draws = plan.table('draws');
const drawLayout = textShaperAbi.layouts.engineDraw;
for (let index = 0; index < draws.count; index += 1) {
  const draw = plan.record(draws, index);
  // One instanced draw: program, material, buffer, and ordering identities are all
  // explicit fields — plan.u32(draw + drawLayout.programId), materialId, clipId, depthKey.
}
```

The frame loop echoes what it consumed. Adjacent revisions publish minimal policy-costed patches; a consumer that fell behind the required base revision receives a complete checkpoint instead of an unsafe delta:

```ts
let previous = publication;
function frame(edits) {
  const next = session.update(
    compileTextEngineFrameUpdate({
      sessionId: SESSION,
      policyHandle: POLICY,
      capabilitySet: 1,
      expectedEngineRevision: previous.engineRevision,
      consumedPlanRevision: previous.planRevision,
      acknowledgedPublicationGeneration: previous.publicationGeneration,
      limits,
      textMutations: edits,
    }),
  );
  plan.bind(next); // apply patches, draw, then acknowledge next frame
  previous = next;
}
```

Record layouts come from the versioned ABI (`@pmndrs/glyph/shaper-abi.json`); the next section describes what policies and plans mean, and `dispose()` on the host releases every registered policy, font stack, and session.

## Render policy and render plan

The public text API describes typography. A renderer policy describes how that semantic result becomes physical instance records and compatible draws. It is registered once as validated numeric data, not called as JavaScript during layout or packing.

```mermaid
flowchart LR
  mutations["Text and font mutations"] --> layout["Rust shaping and layout"]
  layout --> policy["Validated renderer policy"]
  policy --> plan["Revisioned render plan"]
  plan --> render["Renderer resources, uploads, materials, and draws"]
```

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

1. Register one policy and capability set before the first text update.
2. Compile each loaded font's technique resources into the policy's cold binding table.
3. Apply plan resource and buffer operations, then upload the declared patch ranges.
4. Realize materials and submit draw packets without re-shaping, re-sorting, or reconstructing layout.
5. Acknowledge completed publication generations before the planner reuses retired storage.

Three is the maintained reference executor. `@pmndrs/glyph/three/bitmap`, `/msdf`, and `/slug` export each technique's raster contract; the Three runtime resolves the matching policy program and TSL material when a loaded font requests that technique. A custom Three technique can use the public `registerThreeRasterPlanProgram` and `threePolicyAbi` exports to provide its declarative policy, cold font binding, and material realization.

The renderer-neutral host, frame wire, policy authoring toolkit, and plan view publish as `@pmndrs/glyph/core`, and the technique shaders as `@pmndrs/glyph/tsl` and `@pmndrs/glyph/typegpu` — the [Core API](#core-api) section shows the four moves. A new engine integration can follow the [Rust layout engine contract](docs/planning/rust-layout-engine.md#render-plan-policy) and the [Three executor](docs/planning/three-api.md) as its reference.

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
