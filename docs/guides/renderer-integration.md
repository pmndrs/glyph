---
type: How-to guide
title: Author a render policy and consume a render plan
description: Shows renderer integrators how to declare technique storage, compile a policy, drive the retained text engine, decode plans, and apply revisioned GPU updates safely.
tags: [renderer, core, policy, render-plan, retention, wasm]
sources:
  - id: engine-call-contract
    resource: ../../.agents/skills/engine-call-contract/SKILL.md
    title: Engine call contract
  - id: session-handoff
    resource: ../planning/session-handoff.md
    title: Session handoff
  - id: example-renderer
    resource: ../../packages/glyph-example-renderer/src
    title: Example renderer implementation
  - id: core-entry
    resource: ../../packages/glyph/src/core.ts
    title: Renderer-neutral core entry point
  - id: technique-schema
    resource: ../../packages/glyph/src/core/technique-schema.ts
    title: Technique schema authoring API
  - id: policy-program
    resource: ../../packages/glyph/src/core/policy-program.ts
    title: Policy program DSL
  - id: render-policy
    resource: ../../packages/glyph/src/core/render-policy.ts
    title: Render policy compiler
  - id: host
    resource: ../../packages/glyph/src/core/host.ts
    title: Text engine host and session
  - id: plan-view
    resource: ../../packages/glyph/src/core/plan-view.ts
    title: Render plan reader
  - id: retention
    resource: ../../packages/glyph/src/core/retention.ts
    title: Publication retention protocol
  - id: three-policy
    resource: ../../packages/glyph/src/three/render-policy.ts
    title: Three.js render policy
  - id: three-plan-target
    resource: ../../packages/glyph/src/three/engine-plan-target.ts
    title: Three.js render plan consumer
  - id: render-plan-wire
    resource: ../../packages/glyph/rust/shaper/src/engine/render_plan.rs
    title: Renderer-neutral render plan records
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-23T21:49:18Z'
---

# Author a render policy and consume a render plan

This guide is for an implementor adding a renderer to `pmndrs/glyph`. The result is a host that tells the text engine which
per-glyph values to produce, registers that contract, turns application mutations into frame updates, and realizes the
returned plan without retaining invalid Wasm views.

Import application vocabulary and font loading from `@pmndrs/glyph`; import the machinery an integration constructs from
`@pmndrs/glyph/core`. `/core` is additive to the root entry, not an alternative root. That boundary exists so renderer
objects do not enter the shared text vocabulary, and it is enforced as a zero-name-overlap contract.
(`.agents/skills/engine-call-contract/SKILL.md:55`, `.agents/skills/engine-call-contract/SKILL.md:63`)

## 1. Decide what the policy must publish

The engine owns shaping, layout, retained glyph identity, physical storage planning, and draw partitioning. It does not
know whether a glyph becomes a WebGPU storage-buffer record, a WebGL attribute, a canvas operation, or something else. A
render policy supplies that missing renderer decision: for each technique, it names the physical buffers, computes their
lanes from semantic layout plus immutable font binding data, and states the batching and allocation choices the renderer
can consume. The Rust policy executor is deliberately straight-line and cannot allocate, loop, jump backward, address
arbitrary memory, or mutate layout. (`packages/glyph/rust/shaper/src/engine/policy.rs:1`)

This is the modularity boundary. A new renderer authors another policy and plan consumer; it does not need another shaping
or layout API. The first-party Three.js integration follows the same route: it imports the public core toolkit, declares
its buffers, compiles programs for Bitmap, MTSDF, Slug, and decoration, and registers one policy.
(`packages/glyph/src/three/render-policy.ts`, `packages/glyph/src/three/render-policy.ts`,
`packages/glyph/src/three/render-policy.ts`)

The separation was learned through a concrete boundary defect: `/core` was once judged to have no consumers and removed
from the package exports even though `/three` already consumed it. The second example renderer now exists so a renderer
that cannot be built from public integration APIs becomes a compile failure rather than another mistaken audit finding.
(`docs/planning/session-handoff.md:58`, `docs/planning/example-renderer.md:26`)

## 2. Declare a technique schema

Start with one schema per raster technique and a separate buffer set for lanes owned by the renderer rather than the
technique:

```ts
import { definePolicyBuffers, defineTechniqueSchema, id } from '@pmndrs/glyph/core';
import { quadTechnique } from 'example-quad-raster';

export const rendererBuffers = definePolicyBuffers({
  stableGlyphId: { id: id('buffer', 'my-renderer/stable-glyph'), scalar: 'u32', lanes: ['stableGlyphId'] },
  transformIndex: { id: id('buffer', 'my-renderer/transform-index'), scalar: 'u32', lanes: ['transformIndex'] },
});

export const quadSchema = defineTechniqueSchema({
  technique: quadTechnique.id,
  scope: 'glyph',
  binding: {
    f32: ['bearingX', 'bearingY', 'width', 'height'],
    u32: ['page'],
  },
  buffers: {
    rect: { id: id('buffer', 'example.quad/rect'), scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    color: { id: id('buffer', 'example.quad/color'), scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
    atlas: { id: id('buffer', 'example.quad/atlas'), scalar: 'f32', lanes: ['unused0', 'unused1', 'unused2', 'page'] },
  },
  resources: {
    atlas: { kind: 'texture-array', format: 'rgba8unorm' },
  },
  render: { resource: 'atlas', geometry: { kind: 'synthetic-quad' } },
  glyphOrigin: { buffer: 'rect' },
});
```

The declarations have different wire consequences:

- `technique` is a stable string identity. The schema retains the string; registration later resolves it into the shared
  nonzero `u32` wire namespace. (`packages/glyph/src/core/technique-schema.ts`,
  `packages/glyph/src/core/render-policy.ts`)
- `scope` selects the font-binding row family used by every declared binding field: `glyph` indexes by glyph ID, `strike`
  by the selected physical strike, and `resource` by the selected resource. Semantic fields come from layout and are added
  by the program builder rather than declared in `binding`. (`packages/glyph/src/core/technique-schema.ts`,
  `packages/glyph/rust/shaper/src/engine/policy_gather.rs:909`,
  `packages/glyph/rust/shaper/src/engine/policy_gather.rs:993`)
- `binding.f32` and `binding.u32` are ordered field names. Their names are authoring-time safety; their zero-based positions
  become policy input field numbers. A font-binding compiler must emit its field-major tables in exactly the same order.
  `schemaFieldTable()` exists because a missing or misspelled reader previously meant a silently shifted column rather
  than a compile error. (`packages/glyph/src/core/policy-program.ts`,
  `packages/glyph/src/core/font-binding.ts`, `packages/glyph/src/core/font-binding.ts`)
- Every buffer `id` is a nonzero `u16` unique within the program. `scalar` is the element representation, and the number of
  lane names becomes the wire vector width. The public schema admits `f32` and `u32`, with one to four lanes; lane names do
  not occupy wire bytes. `schemaPolicyBuffers()` lowers the declarations to policy buffer records.
  (`packages/glyph/src/core/technique-schema.ts`, `packages/glyph/src/core/technique-schema.ts`,
  `packages/glyph/src/core/technique-schema.ts`, `packages/glyph/src/core/technique-schema.ts`)
- `resources` describes the renderer-facing kind and optional format. It is frozen into the schema but does **not** produce
  a policy-wire record today. Actual resource identities, generations, kinds, and references enter through a font binding
  and later appear in the plan's `resources` table. (`packages/glyph/src/core/technique-schema.ts`,
  `packages/glyph/src/core/technique-schema.ts`, `packages/glyph/src/core/font-binding.ts`)
  A schema used by `registerRasterPlanProgram()` must declare at least one resource because the current font-binding wire
  maps every raster record to a retained resource; resource-free engine primitives remain host-owned branches.
- `glyphOrigin` is also host metadata, not engine wire. It points animation or augmentation code at an `f32` buffer whose
  first two lanes contain the technique's rest-position value; the values need not share one coordinate space across
  techniques. (`packages/glyph/src/core/technique-schema.ts`,
  `packages/glyph/src/three/engine-plan-target.ts`)

`definePolicyBuffers()` and `defineTechniqueSchema()` validate owned copies and freeze them. They reject invalid IDs,
duplicate IDs or binding names, invalid scalar kinds, and invalid origin declarations at the call that authored them,
rather than returning a failure object. (`packages/glyph/src/core/technique-schema.ts`,
`packages/glyph/src/core/technique-schema.ts`) This follows the engine rule that a synchronous call either returns its
answer or throws where the invalid input was written. (`.agents/skills/engine-call-contract/SKILL.md:8`)

## 3. Write the policy program

`techniqueProgram(schema, { system })` is the typed route. It exposes named semantic and binding values, requires the
engine-owned system lanes, and compiles exactly one value tuple for every schema buffer. Use `policyProgram()` directly
only when no `TechniqueSchema` owns the inputs. Both builders lower an expression graph into the same forward-only
operation records and allocate up to 32 registers. (`packages/glyph/src/core/policy-program.ts`)

This program computes a screen-space ink rectangle. `bearingX`, `bearingY`, `width`, and `height` are normalized font
binding values; `inlineOrigin`, `blockOrigin`, and `fontSize` are per-glyph semantic values. The page is converted from
`u32` because this example's shader expects it in the fourth lane of an `f32` vector:

```ts
import { f32, registerRasterPlanProgram, techniqueProgram, u32 } from '@pmndrs/glyph/core';

export const quadPlanProgram = registerRasterPlanProgram({
  technique: quadTechnique,
  schema: quadSchema,
  policyBody(system, _capabilities) {
    const p = techniqueProgram(quadSchema, { system });
    const { inlineOrigin, blockOrigin, fontSize, color } = p.semantics;
    const { bearingX, bearingY, width, height, page } = p.binding;
    const zero = f32.const(0);
    return p.compile({
      rect: [
        f32.add(inlineOrigin, f32.mul(bearingX, fontSize)),
        f32.sub(blockOrigin, f32.mul(bearingY, fontSize)),
        f32.mul(width, fontSize),
        f32.mul(height, fontSize),
      ],
      color: [color.red, color.green, color.blue, color.alpha],
      atlas: [zero, zero, zero, u32.toF32(page)],
    });
  },
  compileFont(compiler) {
    return compileQuadFont(compiler);
  },
});
```

The typed expression namespaces make scalar intent visible: `f32.const()` rejects non-finite numbers; `f32.add()`,
`f32.sub()`, and `f32.mul()` accept only `f32` values; `u32.toF32()` is the explicit numeric conversion. `compile()` checks
every declared buffer, scalar kind, and lane count. It also writes the required stable-glyph and optional transform system
lanes from the engine-owned declarations, so a technique cannot omit or renumber them. (`packages/glyph/src/core/policy-program.ts`)

Do not move expression values between builders. A loaded value's input number is meaningful only in the builder that
created it; without the authoring-session check, combining builders would silently read another field. Constants are the
exception because they have no input provenance. (`packages/glyph/src/core/policy-program.ts`)

### What runs per glyph and what happens per draw

The builder exposes these semantic inputs for each produced glyph: inline and block origin, font size, linear RGBA color,
optional inverse font size, transform index, and stable glyph ID. (`packages/glyph/src/core/policy-program.ts`,
`packages/glyph/src/core/policy-program.ts`) The engine gathers the selected semantic, glyph, strike, and resource rows
for each glyph, then executes the straight-line program once per output record; the Wasm implementation may process four
records at once, but scalar execution defines the same result. (`packages/glyph/rust/shaper/src/engine/policy_gather.rs:457`,
`packages/glyph/rust/shaper/src/engine/policy.rs:1070`)

The policy program does not run once per draw. After records exist, the planner groups consecutive compatible records and
emits draw packets that reference spans of primitives, buffers, and resources. (`packages/glyph/rust/shaper/src/engine/ordered_plan.rs:1060`,
`packages/glyph/rust/shaper/src/engine/ordered_plan.rs:1106`)

`createRasterPolicyProgram()` also chooses two independent modes:

- `transformMode: 'direct'` puts transform identity in the draw key. Records with different transforms split into
  different draws, and `draw.transformId` names the renderer object. `indexed` removes transform from the draw key,
  publishes `draw.transformId` as zero, and requires the policy/renderer pair to carry a per-record transform-index buffer.
  (`packages/glyph/src/core/render-policy.ts`, `packages/glyph/src/core/render-policy.ts`,
  `packages/glyph/rust/shaper/src/engine/ordered_plan.rs:1073`,
  `packages/glyph/rust/shaper/src/engine/ordered_plan.rs:1128`)
- `allocationMode: 'ordered'` makes physical records follow logical order. `stable` selects stable-indirect storage, where
  unchanged glyphs keep physical slots and an internal scalar `u32` order buffer maps logical instances to them. The
  reserved order buffer has policy buffer ID `65535`. (`packages/glyph/src/core/render-policy.ts`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:10`)

## 4. Compile and register the policy

`p.compile()` produces a renderer-neutral policy body. The host then calls `createRasterPolicyProgram()` to add its own
program namespace, wire identities, system buffers, capability set, transform mode, and allocation mode.
`compileRenderPolicy()` serializes the result into the little-endian registration block accepted by `TextEngineHost`.
(`packages/glyph/src/core/raster-plan-program.ts`, `packages/glyph/src/core/render-policy.ts`)

Resolve every technique and resource string through the host's one registry:

```ts
import { createTextRuntime } from '@pmndrs/glyph';
import {
  compileRenderPolicy,
  createRasterPolicyProgram,
  id,
  TextEngineHost,
  textRuntimeShaper,
} from '@pmndrs/glyph/core';

const runtime = await createTextRuntime();
const host = new TextEngineHost(textRuntimeShaper(runtime));
const MY_RENDERER_POLICY_HANDLE = id('policy', 'my-renderer/default');
const capabilitySet = rendererCapabilitySet();
const policy = createRasterPolicyProgram(quadPlanProgram, {
  namespace: 'my-renderer',
  system: rendererBuffers,
  capabilitySet,
  transformMode: 'indexed',
  allocationMode: 'ordered',
  identityRegistry: host.wireIdentities,
});
host.registerPolicy(
  MY_RENDERER_POLICY_HANDLE,
  compileRenderPolicy({ capabilitySets: [capabilitySet], programs: [policy] }),
);
```

`renderWireId()` is deterministic UTF-8 FNV-1a, but hashing alone cannot prove that two strings did not collide.
`RenderWireIdentityRegistry.techniqueId()`, `.programId()`, and `.resourceId()` record every canonical string lowered in
this host and reject a collision. Pure helpers with the same names are available when values only need to be compared, but
one runtime registry is the collision authority for identities that can meet in policy, font, and resource wire data. Two
independent Wasm runtimes do not share plans or handles. (`packages/glyph/src/core/render-policy.ts`,
`packages/glyph/src/core/host.ts`) The Three.js coordinator demonstrates
the required scope by passing `host.wireIdentities` to policy programs, font-binding compilers, and resource registration.
(`packages/glyph/src/three/engine-runtime.ts`, `packages/glyph/src/three/engine-runtime.ts`,
`packages/glyph/src/three/engine-runtime.ts`)

Use the same resolved technique ID and `programVariant` in the font binding. `compileFontBinding()` serializes the immutable
glyph/strike/resource tables and their resource identities. A registered `RasterPlanProgram` owns this cold composition,
and `compileRasterFont()` returns the binding bytes plus constrained portable resource payloads; the byte-only
`loadedFontBindingBytes()` projection consults that registry for every first- and third-party raster technique.
(`packages/glyph/src/core/raster-plan-program.ts`, `packages/glyph/src/core/font-binding.ts`,
`packages/glyph/src/core/font-binding.ts`) The engine still owns resource realization and material creation, so a
Three consumer pairs the portable plan with a registered `{ technique, variant }` through
`registerThreeRasterPlanProgram()` rather than copying the compiler. Register exactly one chosen realization per technique
before the first Three runtime snapshot; a second variant or a late registration throws at that call. The variant receives
logical buffer/resource names; it does not provide policy or resource callbacks. Registration also authenticates its exact
buffer shapes, resource formats, and geometry meaning—including a custom geometry name—against the portable schema.
Three also reserves attribute widths: `position` and `normal` are three-component, `uv` is two-component, `tangent` is
four-component, and `color` is three- or four-component. Variant registration validates declared attributes, and font
registration validates every retained payload attribute before Three can claim those names.

### Font loading comes from the root entry

A font cannot be loaded through `/core` alone. Create the `TextRuntime` and call `loadFont()` through `@pmndrs/glyph`, then
use the `/core` bridge `textRuntimeShaper(runtime)` to construct the host. The runtime registers shaping data before it
returns a loaded raster font. (`packages/glyph/src/index.ts`, `packages/glyph/src/text-runtime.ts`,
`packages/glyph/src/text-runtime.ts`, `packages/glyph/src/text-runtime.ts`) This is by design: `/core` adds the
renderer integration surface to the root font and text vocabulary; it does not duplicate that vocabulary.
(`.agents/skills/engine-call-contract/SKILL.md:63`)

## 5. Drive a session

Create one `TextEngineSession` for each retained frame state. The capacities reserve the request arena, each of the two
result arenas, and optionally retained UTF-16 text storage:

```ts
import { compileTextEngineFrameUpdate, type TextEngineFrameLimits } from '@pmndrs/glyph/core';

const SESSION_HANDLE = host.id('session', 'my-renderer/main-view');
const POLICY_HANDLE = host.id('policy', 'my-renderer/default');

const session = host.createSession({
  handle: SESSION_HANDLE,
  requestCapacity: 4 * 1024,
  resultCapacity: 128 * 1024,
});
let acceptedPublicationGeneration = 0;

const limits: TextEngineFrameLimits = {
  maxParagraphs: 8,
  maxClusters: 256,
  maxLines: 32,
  maxRegions: 4,
  maxExclusions: 4,
  maxInlineObjects: 4,
  maxSlotsPerBand: 4,
  maxOutputBytes: 128 * 1024,
};

const request = compileTextEngineFrameUpdate({
  sessionId: session.handle,
  policyHandle: POLICY_HANDLE,
  expectedEngineRevision: 0,
  consumedPlanRevision: 0,
  acknowledgedPublicationGeneration: acceptedPublicationGeneration,
  limits,
});

const borrowed = session.update(request);
session.assertLive(borrowed);
const publication = session.retain(borrowed);
const pending = prepareRendererSubmission(publication); // validate without changing live state
await pending.commit();
acceptedPublicationGeneration = publication.publicationGeneration;
```

The frame update carries optimistic engine/plan revisions, the publication generation the renderer has consumed, the
selected policy, hard per-frame limits, and optional paragraph, text, style, constraint, region,
exclusion, inline-object, semantic-view, compositing, and policy-parameter sections.
(`packages/glyph/src/core/frame-wire.ts`) `compileTextEngineFrameUpdate()` only serializes those sections; shaping,
layout, policy execution, and packing remain in Rust. (`packages/glyph/src/core/frame-wire.ts`)

Capability-set wire IDs are assigned from descriptor order by `compileRenderPolicy()`. Omit `capabilitySet` to select the
first or only profile; only a renderer that deliberately publishes several profiles needs the low-level one-based selector.

Session arena capacity and frame limits are different controls. If a serialized request exceeds the request arena,
`update()` reserves more space. If a valid result reports a larger required result capacity, it grows the A/B result arenas
and retries once. (`packages/glyph/src/core/host.ts`) Frame limits are serialized into every request and bound the work
and output the engine is allowed to accept. (`packages/glyph/src/core/frame-wire.ts`)

On success, `update()` returns a borrowed `TextEnginePublication`. Its header exposes the engine and plan revisions,
required base revision, publication generation, A/B output slot, policy/capability identity, flags, and summary counts;
`bytes` is the complete encoded plan. (`packages/glyph/src/core/host.ts`, `packages/glyph/src/core/host.ts`) On invalid
input or an engine status, the call throws at `update()`; it does not return a result union or leave a recovery latch for
the next frame. (`packages/glyph/src/core/host.ts`, `.agents/skills/engine-call-contract/SKILL.md:8`) The no-latch rule
exists because an earlier rejected-frame design kept recompiling the invalid frame every render tick instead of preserving
the last accepted scene. (`docs/planning/session-handoff.md`)

Use the last engine-accepted publication's `engineRevision`, but the last device-accepted publication's `planRevision` and
`publicationGeneration`, for the next update. Do not use `session.acknowledgedGeneration` when a retained publication is
still awaiting device acceptance. Retention owns the bytes, while renderer commit proves that their patches and resources
became live. If a rejected candidate is superseded, this split lets the engine publish a safe checkpoint from the last
consumed plan instead of latching stale bytes. Plan revision consumption and storage retirement acknowledgment remain
distinct fences.
(`packages/glyph-example-renderer/src/engine.ts`, `docs/planning/decision-register.md`, D-279)

## 6. Read the plan

Bind a live borrowed publication, or a retained publication, to `TextEngineRenderPlanView`. `bind()` verifies that the byte
view belongs to the reported memory, validates the publication length, and validates all seven table spans. `table()`
returns `{ offset, count, stride }`; `record()` range-checks an index; `u8`, `u16`, `u32`, `f32`, and `bytes` read within the
publication in canonical little-endian order. (`packages/glyph/src/core/plan-view.ts`,
`packages/glyph/src/core/plan-view.ts`, `packages/glyph/src/core/plan-view.ts`,
`packages/glyph/src/core/plan-view.ts`)

The layout constants are public through `textShaperAbi`, so records without a convenience decoder remain readable without
copying:

```ts
import { TextEngineRenderPlanView, textShaperAbi, type RetainedTextEnginePublication } from '@pmndrs/glyph/core';

interface DecodedDraw {
  readonly programId: number;
  readonly programVariant: number;
  readonly materialId: number;
  readonly clipId: number;
  readonly depthKey: number;
  readonly transformId: number;
  readonly primitiveStart: number;
  readonly primitiveCount: number;
  readonly bufferStart: number;
  readonly bufferCount: number;
  readonly resourceStart: number;
  readonly resourceCount: number;
  readonly orderToken: number;
}

export function decodeDraws(publication: RetainedTextEnginePublication): DecodedDraw[] {
  const plan = new TextEngineRenderPlanView().bind(publication);
  const table = plan.table('draws');
  const layout = textShaperAbi.layouts.engineDraw;
  const draws: DecodedDraw[] = [];

  for (let index = 0; index < table.count; index += 1) {
    const record = plan.record(table, index);
    draws.push({
      programId: plan.u32(record + layout.programId),
      programVariant: plan.u16(record + layout.programVariant),
      materialId: plan.u32(record + layout.materialId),
      clipId: plan.u32(record + layout.clipId),
      depthKey: plan.u32(record + layout.depthKey),
      transformId: plan.u32(record + layout.transformId),
      primitiveStart: plan.u32(record + layout.primitiveStart),
      primitiveCount: plan.u32(record + layout.primitiveCount),
      bufferStart: plan.u32(record + layout.bufferStart),
      bufferCount: plan.u32(record + layout.bufferCount),
      resourceStart: plan.u32(record + layout.resourceStart),
      resourceCount: plan.u32(record + layout.resourceCount),
      orderToken: plan.u32(record + layout.orderToken),
    });
  }
  return draws;
}
```

The example renderer uses the same pattern, while requiring a retained publication because its draw list survives the
call. (`packages/glyph-example-renderer/src/plan-reader.ts`,
`packages/glyph-example-renderer/src/draw-list.ts`)

### The seven table layouts

Offsets below are relative to each record. All multibyte fields are little-endian. The public generated ABI is the offset
authority; the Rust declarations provide the scalar types and exact strides.
(`packages/glyph/src/generated/text-shaper-abi.ts`, `packages/glyph/rust/shaper/src/engine/render_plan.rs:171`)

- `resources` — 40 bytes: `id@0:u32`, `generation@4:u32`, `techniqueId@8:u32`, `resourceKind@12:u16`,
  `action@14:u16`, `flags@16:u32`, `referenceId@20:u32`, `lowerBound@24:u32`, `upperBound@28:u32`,
  `auxiliary0@32:u32`, `auxiliary1@36:u32`. Realize or retain the renderer resource named by `referenceId`; key the plan
  identity by `(id, generation)`. (`packages/glyph/src/generated/text-shaper-abi.ts`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:32`)
- `buffers` — 36 bytes: `id@0:u32`, `generation@4:u32`, `programId@8:u32`, `policyBufferId@12:u16`,
  `scalarType@14:u8`, `vectorWidth@15:u8`, `strategy@16:u16`, `flags@18:u16`, `liveRecords@20:u32`,
  `capacityRecords@24:u32`, `byteLength@28:u32`, `orderBufferId@32:u32`. Allocate renderer storage with the declared
  physical shape and use `policyBufferId` to bind it to the shader lane declared in the schema.
  (`packages/glyph/src/generated/text-shaper-abi.ts`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:48`)
- `patches` — 36 bytes: `opcode@0:u16`, `flags@2:u16`, `bufferId@4:u32`, `bufferGeneration@8:u32`,
  `destinationOffset@12:u32`, `byteLength@16:u32`, `payloadOffset@20:u32`, `sourceBufferId@24:u32`,
  `sourceOffset@28:u32`, `fillValue@32:u32`. Apply the named write, fill, or copy to the exact destination generation.
  Write payload offsets point inside the same publication. (`packages/glyph/src/generated/text-shaper-abi.ts`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:65`)
- `primitives` — 64 bytes: `id@0:u32`, `kind@4:u16`, `flags@6:u16`, `techniqueId@8:u32`,
  `resourceId@12:u32`, `resourceGeneration@16:u32`, `programId@20:u32`, `programVariant@24:u16`,
  `recordCount@26:u16`, `bufferId@28:u32`, `recordIndex@32:u32`, `logicalOrder@36:u32`, `clipId@40:u32`,
  `semanticId@44:u32`, `inlineStart@48:f32`, `blockStart@52:f32`, `inlineExtent@56:f32`,
  `blockExtent@60:f32`. A primitive is a logical span over consecutive records, not a GPU object.
  (`packages/glyph/src/generated/text-shaper-abi.ts`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:81`)
- `draws` — 64 bytes: `id@0:u32`, `programId@4:u32`, `programVariant@8:u16`, `flags@10:u16`,
  `materialId@12:u32`, `clipId@16:u32`, `depthKey@20:u32`, `transformId@24:u32`, `primitiveStart@28:u32`,
  `primitiveCount@32:u32`, `bufferStart@36:u32`, `bufferCount@40:u32`, `resourceStart@44:u32`,
  `resourceCount@48:u32`, `orderToken@52:u32`, `indirectBufferId@56:u32`, `indirectOffset@60:u32`. The three
  `Start`/`Count` pairs are ranges in the corresponding tables. (`packages/glyph/src/generated/text-shaper-abi.ts`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:105`)
- `retirements` — 24 bytes: `kind@0:u16`, `flags@2:u16`, `id@4:u32`, `generation@8:u32`,
  `afterPublicationGeneration@12:u32`, `byteOffset@16:u32`, `byteLength@20:u32`. This is the only release authority for
  engine storage. (`packages/glyph/src/generated/text-shaper-abi.ts`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:131`)
- `diagnostics` — 24 bytes: `code@0:u16`, `severity@2:u8`, `phase@3:u8`, `subjectId@4:u32`, `value0@8:u32`,
  `value1@12:u32`, `durationNanosLow@16:u32`, `durationNanosHigh@20:u32`. Treat these as plan telemetry; preserve unknown
  codes rather than inventing rendering behavior from them. (`packages/glyph/src/generated/text-shaper-abi.ts`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:143`)

### Interpret draw identity at the renderer boundary

- `programId` is the renderer program/pipeline identity derived by `createRasterPolicyProgram()` from the technique and
  renderer namespace. `programVariant` originates in the
  font binding and selects the `(capability set, technique, variant)` policy program; a renderer may use it for the matching
  shader specialization. (`packages/glyph/src/core/render-policy.ts`,
  `packages/glyph/src/core/font-binding.ts`, `packages/glyph/rust/shaper/src/engine/policy.rs:344`)
- `materialId` is renderer-owned data resolved from authored style, never a callback or renderer object in the engine.
  (`packages/glyph/src/core/frame-wire.ts`, `packages/glyph/rust/shaper/src/engine/render_plan.rs:112`)
- `clipId` names the clip shared by the packet. Map it to the renderer's scissor, stencil, clip stack, or equivalent.
  (`packages/glyph/rust/shaper/src/engine/render_plan.rs:114`)
- `depthKey` is the caller-defined sortable depth bucket. Logical order remains authoritative within a bucket.
  (`packages/glyph/rust/shaper/src/engine/render_plan.rs:116`)
- `orderToken` is the global logical draw order. Draw tables are emitted in ascending token order, including when ordered
  and stable planners are merged; preserve that order unless the frame explicitly declared compositing independence.
  (`packages/glyph/rust/shaper/src/engine/render_plan_compiler.rs:528`,
  `packages/glyph/rust/shaper/src/engine/plan_input.rs:27`)
- `transformId` is the renderer-owned transform/object identity for direct mode. Zero means the transform is indexed per
  record through the policy buffer in indexed mode. (`packages/glyph/rust/shaper/src/engine/render_plan.rs:118`,
  `packages/glyph/src/three/engine-plan-target.ts`)

## 7. Retain the frame handoff correctly

The publication transport is an A/B double buffer. A session owns two result arenas; the engine encodes into the inactive
slot, validates and commits, then makes that slot active. The host can keep displaying the previously realized frame while
the engine fills the other slot. (`packages/glyph/rust/shaper/src/engine/transport.rs:42`,
`packages/glyph/rust/shaper/src/engine/transport.rs:119`, `packages/glyph/rust/shaper/src/engine/transport.rs:135`)

The JavaScript ownership rule is deliberately stricter than physical slot arithmetic:

> **A borrowed publication expires when the session answers its next call.**

That includes another update, a measurement, a reserve or growth attempt, a failed call that reserved capacity, and
session disposal. Some bytes may physically survive for another slot turn, but relying on that would make liveness depend
on hidden arena state and eventually feed stale bytes to the GPU. (`packages/glyph/src/core/retention.ts`,
`packages/glyph/src/core/host.ts`)

Choose one handoff:

- Consume the borrow synchronously: call `session.assertLive(publication)` before decoding, apply every needed table and
  payload before another session call, then call `session.acknowledge(publication)`.
- Keep plan bytes or views: call `session.retain(publication)`. It makes one contiguous copy of the header, all tables, and
  patch payloads and brands the result as `RetainedTextEnginePublication`. The retained copy never expires. Because
  `retain()` also advances the session's convenience acknowledgment, a transactional renderer must keep its own
  device-accepted generation and use that value on the wire until submission commits.
  (`packages/glyph/src/core/host.ts`, `packages/glyph/src/core/retention.ts`)

Use `session.isExpired()` when branching is useful and `session.assertLive()` when a stale read is a defect. Both also
reject a publication issued by another session. (`packages/glyph/src/core/host.ts`,
`packages/glyph/src/core/host.ts`)

Acknowledgment is load-bearing, not bookkeeping. The engine delays retirements until the host has consumed the required
publication generation; acknowledging late retains old GPU storage, never acknowledging leaks it, and sending a generation
that goes backward is a revision conflict. A synchronous in-place consumer may copy `session.acknowledgedGeneration` into
the next frame update after applying the publication. A renderer that retains before device submission must instead carry
the last generation whose submission committed.
(`packages/glyph/src/core/plan-view.ts`, `packages/glyph/src/core/retention.ts`,
`packages/glyph/src/core/frame-wire.ts`) This separate fence exists because “the host consumed plan revision N” does
not prove that storage associated with an earlier publication can be reused or released. Conflating the two would allow
retirement while renderer work still depended on that storage. (`docs/planning/decision-register.md:235`)

## 8. Apply patches instead of uploading whole buffers

Key every physical buffer by `(bufferId, bufferGeneration)`. A changed generation is new storage even when the numeric ID
is unchanged. Apply the `buffers` table first so allocations exist, then apply each patch to the exact generation it names.
(`packages/glyph/src/core/plan-view.ts`, `packages/glyph/src/core/retention.ts`)

The patch opcodes are `allocateOrResize`, `write`, `fill`, `copy`, and `retire`. Buffer rows describe allocations; write,
fill, and copy carry content deltas. A patch opcode named `retire` is **not** permission to destroy renderer storage. The
first-party consumer ignores allocation/retire patch opcodes for content application and releases only from the
`retirements` table. (`packages/glyph/src/generated/text-shaper-abi.ts`,
`packages/glyph/src/three/engine-plan-target.ts`, `packages/glyph/src/three/engine-plan-target.ts`)

A CPU mirror suitable for staging GPU writes follows this shape:

```ts
import {
  readTextEngineBuffer,
  readTextEnginePatch,
  readTextEngineRetirement,
  TextEngineRenderPlanView,
  textShaperAbi,
  type RetainedTextEnginePublication,
} from '@pmndrs/glyph/core';

interface BufferStorage {
  readonly id: number;
  readonly generation: number;
  readonly bytes: Uint8Array;
}

function bufferKey(id: number, generation: number): string {
  return `${id}:${generation}`;
}

export function applyBufferDeltas(
  publication: RetainedTextEnginePublication,
  storage: Map<string, BufferStorage>,
  currentGenerations: Map<number, number>,
  releaseResource: (id: number, generation: number) => void,
): void {
  const plan = new TextEngineRenderPlanView().bind(publication);
  const buffers = plan.table('buffers');

  for (let index = 0; index < buffers.count; index += 1) {
    const record = readTextEngineBuffer(plan, buffers, index);
    const key = bufferKey(record.id, record.generation);
    const current = storage.get(key);
    if (current === undefined || current.bytes.byteLength !== record.byteLength) {
      storage.set(key, {
        id: record.id,
        generation: record.generation,
        bytes: new Uint8Array(record.byteLength),
      });
    }
    currentGenerations.set(record.id, record.generation);
  }

  const opcodes = textShaperAbi.engine.patchOpcodes;
  const patches = plan.table('patches');
  for (let index = 0; index < patches.count; index += 1) {
    const patch = readTextEnginePatch(plan, patches, index);
    const destination = storage.get(bufferKey(patch.bufferId, patch.bufferGeneration));
    if (destination === undefined) {
      throw new Error(`unknown destination buffer ${patch.bufferId}:${patch.bufferGeneration}`);
    }
    if (patch.destinationOffset + patch.byteLength > destination.bytes.byteLength) {
      throw new RangeError('buffer patch exceeds destination storage');
    }

    if (patch.opcode === opcodes.write) {
      if (patch.byteLength !== 0) {
        if (patch.payload === undefined) throw new Error('write patch has no payload');
        destination.bytes.set(patch.payload, patch.destinationOffset);
      }
    } else if (patch.opcode === opcodes.fill) {
      if (patch.byteLength % 4 !== 0) throw new RangeError('fill patch is not u32 aligned');
      const view = new DataView(
        destination.bytes.buffer,
        destination.bytes.byteOffset + patch.destinationOffset,
        patch.byteLength,
      );
      for (let offset = 0; offset < patch.byteLength; offset += 4) {
        view.setUint32(offset, patch.fillValue, true);
      }
    } else if (patch.opcode === opcodes.copy) {
      const sourceGeneration = currentGenerations.get(patch.sourceBufferId);
      const source =
        sourceGeneration === undefined ? undefined : storage.get(bufferKey(patch.sourceBufferId, sourceGeneration));
      if (source === undefined || patch.sourceOffset + patch.byteLength > source.bytes.byteLength) {
        throw new RangeError('copy patch exceeds source storage');
      }
      if (source === destination) {
        destination.bytes.copyWithin(
          patch.destinationOffset,
          patch.sourceOffset,
          patch.sourceOffset + patch.byteLength,
        );
      } else {
        destination.bytes.set(
          source.bytes.subarray(patch.sourceOffset, patch.sourceOffset + patch.byteLength),
          patch.destinationOffset,
        );
      }
    } else if (patch.opcode !== opcodes.allocateOrResize && patch.opcode !== opcodes.retire) {
      throw new Error(`unsupported patch opcode ${patch.opcode}`);
    }
  }

  const kinds = textShaperAbi.engine.retirementKinds;
  const retirements = plan.table('retirements');
  for (let index = 0; index < retirements.count; index += 1) {
    const retirement = readTextEngineRetirement(plan, retirements, index);
    if (retirement.kind === kinds.buffer) {
      storage.delete(bufferKey(retirement.id, retirement.generation));
      if (currentGenerations.get(retirement.id) === retirement.generation) currentGenerations.delete(retirement.id);
    } else if (retirement.kind === kinds.resource) {
      releaseResource(retirement.id, retirement.generation);
    }
  }
}
```

Upload only the write/fill/copy destination ranges marked by those patches. Preserve buffers and resources across frames,
including objects absent from a delta publication, until a matching retirement names the exact generation. The Three.js
consumer follows this order: read resources, read buffers, apply patches, rebuild referenced draws, then apply retirements.
(`packages/glyph/src/three/engine-plan-target.ts`)

## 9. Prove the integration with a real device and retained text

The example renderer is an executable reference, not the required shape of another renderer's public API. Its
`TypeGpuExampleRendererDevice` validates through the deterministic recording oracle, realizes the technique's supplied
geometry and policy buffers with TypeGPU, submits an indexed instanced WebGPU pass, and exposes offscreen RGBA readback.
Its `ExampleText` façade demonstrates when application text is created, updated, rendered, and removed:

```ts
const adapter = await navigator.gpu.requestAdapter();
if (adapter === null) throw new Error('WebGPU is unavailable');
const gpuDevice = await adapter.requestDevice();
const device = new TypeGpuExampleRendererDevice({ device: gpuDevice, width: 768, height: 192 });
const engine = new ExampleTextEngine(textRuntimeShaper(runtime), device);

const binding = engine.registerFont(font);
const stack = engine.registerFontStack([binding]);
engine.openSession();

const text = engine.createText({
  fontStack: stack,
  text: 'Portable TypeGPU',
  fontSize: 64,
  width: 768,
  height: 192,
});
const initial = await text.render();
const initialPixels = await device.readPixels();

text.update({ text: 'Updated WebGPU', foregroundRgba: 0xff40_a0ff });
const updated = await text.render();
const updatedPixels = await device.readPixels();

if (initial.draws.length === 0 || updated.draws.length === 0) throw new Error('expected glyph draws');
if (!pixelsChanged(initialPixels, updatedPixels)) throw new Error('expected the text update to change pixels');

await text.dispose();
engine.dispose();
device.dispose();
gpuDevice.destroy();
```

`engine.registerFont()` performs the cold `compileRasterFont()` and resource-realization transaction described above.
`text.render()` performs the frame compilation, retention, decode, and submission transaction. `text.update()` only
changes desired state; shaping and GPU work happen on the next `render()`. `text.dispose()` publishes paragraph removal,
and the accepted empty scene clears the target. The browser lab uses this exact path with runtime-baked Inter and requires
non-empty pixels in both frames plus a nonzero pixel diff.
