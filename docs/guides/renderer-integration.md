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
(`packages/glyph/src/three/render-policy.ts:1`, `packages/glyph/src/three/render-policy.ts:27`,
`packages/glyph/src/three/render-policy.ts:74`)

The separation was learned through a concrete boundary defect: `/core` was once judged to have no consumers and removed
from the package exports even though `/three` already consumed it. The second example renderer now exists so a renderer
that cannot be built from public integration APIs becomes a compile failure rather than another mistaken audit finding.
(`docs/planning/session-handoff.md:58`, `docs/planning/example-renderer.md:26`)

## 2. Declare a technique schema

Start with one schema per raster technique and a separate buffer set for lanes owned by the renderer rather than the
technique:

```ts
import { definePolicyBuffers, defineTechniqueSchema } from '@pmndrs/glyph/core';

export const rendererBuffers = definePolicyBuffers({
  stableGlyphId: { id: 20, scalar: 'u32', lanes: ['stableGlyphId'] },
  transformIndex: { id: 21, scalar: 'u32', lanes: ['transformIndex'] },
});

export const quadSchema = defineTechniqueSchema({
  technique: 'example.quad',
  scope: 'glyph',
  binding: {
    f32: ['bearingX', 'bearingY', 'width', 'height'],
    u32: ['page'],
  },
  buffers: {
    rect: { id: 1, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    color: { id: 2, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
    atlas: { id: 3, scalar: 'f32', lanes: ['unused0', 'unused1', 'unused2', 'page'] },
  },
  resources: {
    atlas: { kind: 'texture-array', format: 'rgba8unorm' },
  },
  glyphOrigin: { buffer: 'rect' },
});
```

The declarations have different wire consequences:

- `technique` is a stable string identity. The schema retains the string; registration later resolves it into the shared
  nonzero `u32` wire namespace. (`packages/glyph/src/core/technique-schema.ts:142`,
  `packages/glyph/src/core/render-policy.ts:74`)
- `scope` selects the font-binding row family used by every declared binding field: `glyph` indexes by glyph ID, `strike`
  by the selected physical strike, and `resource` by the selected resource. Semantic fields come from layout and are added
  by the program builder rather than declared in `binding`. (`packages/glyph/src/core/technique-schema.ts:144`,
  `packages/glyph/rust/shaper/src/engine/policy_gather.rs:909`,
  `packages/glyph/rust/shaper/src/engine/policy_gather.rs:993`)
- `binding.f32` and `binding.u32` are ordered field names. Their names are authoring-time safety; their zero-based positions
  become policy input field numbers. A font-binding compiler must emit its field-major tables in exactly the same order.
  `schemaFieldTable()` exists because a missing or misspelled reader previously meant a silently shifted column rather
  than a compile error. (`packages/glyph/src/core/policy-program.ts:221`,
  `packages/glyph/src/core/font-binding.ts:26`, `packages/glyph/src/core/font-binding.ts:333`)
- Every buffer `id` is a nonzero `u16` unique within the program. `scalar` is the element representation, and the number of
  lane names becomes the wire vector width. The public schema admits `f32` and `u32`, with one to four lanes; lane names do
  not occupy wire bytes. `schemaPolicyBuffers()` lowers the declarations to policy buffer records.
  (`packages/glyph/src/core/technique-schema.ts:13`, `packages/glyph/src/core/technique-schema.ts:15`,
  `packages/glyph/src/core/technique-schema.ts:33`, `packages/glyph/src/core/technique-schema.ts:363`)
- `resources` describes the renderer-facing kind and optional format. It is frozen into the schema but does **not** produce
  a policy-wire record today. Actual resource identities, generations, kinds, and references enter through a font binding
  and later appear in the plan's `resources` table. (`packages/glyph/src/core/technique-schema.ts:148`,
  `packages/glyph/src/core/technique-schema.ts:101`, `packages/glyph/src/core/font-binding.ts:305`)
- `glyphOrigin` is also host metadata, not engine wire. It points animation or augmentation code at an `f32` buffer whose
  first two lanes contain the technique's rest-position value; the values need not share one coordinate space across
  techniques. (`packages/glyph/src/core/technique-schema.ts:152`,
  `packages/glyph/src/three/engine-plan-target.ts:1174`)

`definePolicyBuffers()` and `defineTechniqueSchema()` validate owned copies and freeze them. They reject invalid IDs,
duplicate IDs or binding names, invalid scalar kinds, and invalid origin declarations at the call that authored them,
rather than returning a failure object. (`packages/glyph/src/core/technique-schema.ts:33`,
`packages/glyph/src/core/technique-schema.ts:186`) This follows the engine rule that a synchronous call either returns its
answer or throws where the invalid input was written. (`.agents/skills/engine-call-contract/SKILL.md:8`)

## 3. Write the policy program

`techniqueProgram(schema)` is the typed route: it calls `policyProgram()` with the schema's scope and ordered binding
names, then exposes named semantic and binding values. Use `policyProgram()` directly when no `TechniqueSchema` owns the
inputs. Both builders lower an expression graph into the same forward-only operation records and allocate up to 32
registers. (`packages/glyph/src/core/policy-program.ts:5`, `packages/glyph/src/core/policy-program.ts:192`,
`packages/glyph/src/core/policy-program.ts:208`)

This program computes a screen-space ink rectangle. `bearingX`, `bearingY`, `width`, and `height` are normalized font
binding values; `inlineOrigin`, `blockOrigin`, and `fontSize` are per-glyph semantic values. The page is converted from
`u32` because this example's shader expects it in the fourth lane of an `f32` vector:

```ts
import {
  addF32,
  compileRenderPolicy,
  constantF32,
  createProgram,
  multiplyF32,
  RenderWireIdentityRegistry,
  schemaPolicyBuffers,
  subtractF32,
  techniqueProgram,
  textShaperAbi,
  u32ToF32,
  type PolicyBuffer,
  type PolicyTransformMode,
} from '@pmndrs/glyph/core';

export function quadPolicyBytes(
  identities: RenderWireIdentityRegistry,
  transformMode: PolicyTransformMode = 'indexed',
): Uint8Array {
  const p = techniqueProgram(quadSchema);
  const { inlineOrigin, blockOrigin, fontSize, color, stableGlyphId, transformIndex } = p.semantics;
  const { bearingX, bearingY, width, height, page } = p.binding;
  const zero = constantF32(0);

  p.store(quadSchema.buffers.rect, [
    addF32(inlineOrigin, multiplyF32(bearingX, fontSize)),
    subtractF32(blockOrigin, multiplyF32(bearingY, fontSize)),
    multiplyF32(width, fontSize),
    multiplyF32(height, fontSize),
  ]);
  p.store(quadSchema.buffers.color, [color.red, color.green, color.blue, color.alpha]);
  p.store(quadSchema.buffers.atlas, [zero, zero, zero, u32ToF32(page)]);
  p.store(rendererBuffers.stableGlyphId, [stableGlyphId]);
  if (transformMode === 'indexed') p.store(rendererBuffers.transformIndex, [transformIndex]);

  const systemBuffers: PolicyBuffer[] = [
    {
      id: rendererBuffers.stableGlyphId.id,
      scalar: textShaperAbi.policy.scalarTypes.u32,
      vectorWidth: 1,
    },
    ...(transformMode === 'indexed'
      ? [
          {
            id: rendererBuffers.transformIndex.id,
            scalar: textShaperAbi.policy.scalarTypes.u32,
            vectorWidth: 1,
          },
        ]
      : []),
  ];

  const flags = textShaperAbi.policy.capabilityFlags;
  return compileRenderPolicy({
    capabilitySets: [
      {
        id: 1,
        flags: flags.storageBuffers | flags.aliasVec4 | flags.orderedDirect,
        maxBufferBytes: 16 * 1024 * 1024,
        updateAlignment: 4,
        coalesceGapBytes: 128,
        rangeCallPenaltyBytes: 256,
        maxBuffersPerDraw: 8,
        maxResourcesPerDraw: 4,
        maxIndirectDraws: 0,
        fragmentationBudget: 8,
        wholeBufferThresholdBasisPoints: 7_500,
      },
    ],
    programs: [
      createProgram(
        identities.resolve(quadSchema.technique),
        1,
        p.compile(),
        [...schemaPolicyBuffers(quadSchema), ...systemBuffers],
        transformMode,
        'ordered',
      ),
    ],
  });
}
```

The arithmetic combinators are typed expressions: `constantF32()` rejects non-finite numbers; `addF32()`,
`subtractF32()`, and `multiplyF32()` accept only `f32` values; `u32ToF32()` is the explicit numeric conversion. A store
checks the declared scalar kind and lane count before compilation. (`packages/glyph/src/core/policy-program.ts:82`,
`packages/glyph/src/core/policy-program.ts:94`, `packages/glyph/src/core/policy-program.ts:106`,
`packages/glyph/src/core/policy-program.ts:118`, `packages/glyph/src/core/policy-program.ts:123`,
`packages/glyph/src/core/policy-program.ts:270`)

Do not move expression values between builders. A loaded value's input number is meaningful only in the builder that
created it; without the authoring-session check, combining builders would silently read another field. Constants are the
exception because they have no input provenance. (`packages/glyph/src/core/policy-program.ts:62`)

### What runs per glyph and what happens per draw

The builder exposes these semantic inputs for each produced glyph: inline and block origin, font size, linear RGBA color,
optional inverse font size, transform index, and stable glyph ID. (`packages/glyph/src/core/policy-program.ts:135`,
`packages/glyph/src/core/policy-program.ts:143`) The engine gathers the selected semantic, glyph, strike, and resource rows
for each glyph, then executes the straight-line program once per output record; the Wasm implementation may process four
records at once, but scalar execution defines the same result. (`packages/glyph/rust/shaper/src/engine/policy_gather.rs:457`,
`packages/glyph/rust/shaper/src/engine/policy.rs:1070`)

The policy program does not run once per draw. After records exist, the planner groups consecutive compatible records and
emits draw packets that reference spans of primitives, buffers, and resources. (`packages/glyph/rust/shaper/src/engine/ordered_plan.rs:1060`,
`packages/glyph/rust/shaper/src/engine/ordered_plan.rs:1106`)

`createProgram()` also chooses two independent modes:

- `transformMode: 'direct'` puts transform identity in the draw key. Records with different transforms split into
  different draws, and `draw.transformId` names the renderer object. `indexed` removes transform from the draw key,
  publishes `draw.transformId` as zero, and requires the policy/renderer pair to carry a per-record transform-index buffer.
  (`packages/glyph/src/core/render-policy.ts:205`, `packages/glyph/src/core/render-policy.ts:227`,
  `packages/glyph/rust/shaper/src/engine/ordered_plan.rs:1073`,
  `packages/glyph/rust/shaper/src/engine/ordered_plan.rs:1128`)
- `allocationMode: 'ordered'` makes physical records follow logical order. `stable` selects stable-indirect storage, where
  unchanged glyphs keep physical slots and an internal scalar `u32` order buffer maps logical instances to them. The
  reserved order buffer has policy buffer ID `65535`. (`packages/glyph/src/core/render-policy.ts:222`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:10`)

## 4. Compile and register the policy

`p.compile()` produces the program's input and operation records. `createProgram()` adds technique/program identity,
physical buffer schemas, transform batching, and allocation strategy. `compileRenderPolicy()` serializes capability sets,
programs, buffers, operations, and inputs into the little-endian registration block accepted by `TextEngineHost`.
(`packages/glyph/src/core/policy-program.ts:297`, `packages/glyph/src/core/render-policy.ts:205`,
`packages/glyph/src/core/render-policy.ts:264`)

Resolve every technique and resource string through the host's one registry:

```ts
import { createTextRuntime } from '@pmndrs/glyph';
import { TextEngineHost, textRuntimeShaper } from '@pmndrs/glyph/core';

const runtime = await createTextRuntime();
const host = new TextEngineHost(textRuntimeShaper(runtime));
host.registerPolicy(23, quadPolicyBytes(host.wireIdentities));
```

`renderWireId()` is deterministic UTF-8 FNV-1a, but hashing alone cannot prove that two strings did not collide.
`RenderWireIdentityRegistry.resolve()` records every string lowered in this host and rejects a collision. The registry is
runtime-scoped because only identities that can meet in one policy/font/resource wire namespace need a shared proof; two
independent Wasm runtimes do not share plans or handles. (`packages/glyph/src/core/render-policy.ts:74`,
`packages/glyph/src/core/render-policy.ts:83`, `packages/glyph/src/core/host.ts:92`) The Three.js coordinator demonstrates
the required scope by passing `host.wireIdentities` to policy programs, font-binding compilers, and resource registration.
(`packages/glyph/src/three/engine-runtime.ts:85`, `packages/glyph/src/three/engine-runtime.ts:195`,
`packages/glyph/src/three/engine-runtime.ts:237`)

Use the same resolved technique ID and `programVariant` in the font binding. `compileFontBinding()` serializes the immutable
glyph/strike/resource tables and their resource identities. A registered `RasterPlanProgram` owns this cold composition,
and `compileRasterFont()` returns the binding bytes plus constrained portable resource payloads; the byte-only
`loadedFontBindingBytes()` projection consults that registry before falling back to the three first-party techniques.
(`packages/glyph/src/core/raster-plan-program.ts`, `packages/glyph/src/core/font-binding.ts:40`,
`packages/glyph/src/core/font-binding.ts:55`) The engine still owns resource realization and material creation, so a
Three consumer pairs the portable plan with a registered `{ technique, variant }` through
`registerThreeRasterPlanProgram()` rather than copying the compiler. Register exactly one chosen realization per technique
before the first Three runtime snapshot; a second variant or a late registration throws at that call. The variant receives
logical buffer/resource names; it does not provide policy or resource callbacks.

### Font loading comes from the root entry

A font cannot be loaded through `/core` alone. Create the `TextRuntime` and call `loadFont()` through `@pmndrs/glyph`, then
use the `/core` bridge `textRuntimeShaper(runtime)` to construct the host. The runtime registers shaping data before it
returns a loaded raster font. (`packages/glyph/src/index.ts:148`, `packages/glyph/src/text-runtime.ts:71`,
`packages/glyph/src/text-runtime.ts:93`, `packages/glyph/src/text-runtime.ts:104`) This is by design: `/core` adds the
renderer integration surface to the root font and text vocabulary; it does not duplicate that vocabulary.
(`.agents/skills/engine-call-contract/SKILL.md:63`)

## 5. Drive a session

Create one `TextEngineSession` for each retained frame state. The capacities reserve the request arena, each of the two
result arenas, and optionally retained UTF-16 text storage:

```ts
import { compileTextEngineFrameUpdate, type TextEngineFrameLimits } from '@pmndrs/glyph/core';

const session = host.createSession({
  handle: 29,
  requestCapacity: 4 * 1024,
  resultCapacity: 128 * 1024,
});

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
  policyHandle: 23,
  capabilitySet: 1,
  expectedEngineRevision: 0,
  consumedPlanRevision: 0,
  acknowledgedPublicationGeneration: session.acknowledgedGeneration,
  limits,
});

const borrowed = session.update(request);
session.assertLive(borrowed);
const publication = session.retain(borrowed);
```

The frame update carries optimistic engine/plan revisions, the publication generation the renderer has consumed, the
selected policy and capability set, hard per-frame limits, and optional paragraph, text, style, constraint, region,
exclusion, inline-object, semantic-view, compositing, and policy-parameter sections.
(`packages/glyph/src/core/frame-wire.ts:175`) `compileTextEngineFrameUpdate()` only serializes those sections; shaping,
layout, policy execution, and packing remain in Rust. (`packages/glyph/src/core/frame-wire.ts:195`)

Session arena capacity and frame limits are different controls. If a serialized request exceeds the request arena,
`update()` reserves more space. If a valid result reports a larger required result capacity, it grows the A/B result arenas
and retries once. (`packages/glyph/src/core/host.ts:315`) Frame limits are serialized into every request and bound the work
and output the engine is allowed to accept. (`packages/glyph/src/core/frame-wire.ts:292`)

On success, `update()` returns a borrowed `TextEnginePublication`. Its header exposes the engine and plan revisions,
required base revision, publication generation, A/B output slot, policy/capability identity, flags, and summary counts;
`bytes` is the complete encoded plan. (`packages/glyph/src/core/host.ts:24`, `packages/glyph/src/core/host.ts:425`) On invalid
input or an engine status, the call throws at `update()`; it does not return a result union or leave a recovery latch for
the next frame. (`packages/glyph/src/core/host.ts:315`, `.agents/skills/engine-call-contract/SKILL.md:8`) The no-latch rule
exists because an earlier rejected-frame design kept recompiling the invalid frame every render tick instead of preserving
the last accepted scene. (`docs/planning/session-handoff.md:28`)

Use `publication.engineRevision` and `publication.planRevision` as the expectations for the next update. Carry
`session.acknowledgedGeneration`; do not substitute `consumedPlanRevision`, because plan revision consumption and storage
retirement acknowledgment are distinct fences. (`packages/glyph-example-renderer/src/engine.ts:76`,
`docs/planning/decision-register.md:238`)

## 6. Read the plan

Bind a live borrowed publication, or a retained publication, to `TextEngineRenderPlanView`. `bind()` verifies that the byte
view belongs to the reported memory, validates the publication length, and validates all seven table spans. `table()`
returns `{ offset, count, stride }`; `record()` range-checks an index; `u8`, `u16`, `u32`, `f32`, and `bytes` read within the
publication in canonical little-endian order. (`packages/glyph/src/core/plan-view.ts:47`,
`packages/glyph/src/core/plan-view.ts:54`, `packages/glyph/src/core/plan-view.ts:72`,
`packages/glyph/src/core/plan-view.ts:88`)

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
call. (`packages/glyph-example-renderer/src/plan-reader.ts:12`,
`packages/glyph-example-renderer/src/draw-list.ts:60`)

### The seven table layouts

Offsets below are relative to each record. All multibyte fields are little-endian. The public generated ABI is the offset
authority; the Rust declarations provide the scalar types and exact strides.
(`packages/glyph/src/generated/text-shaper-abi.ts:223`, `packages/glyph/rust/shaper/src/engine/render_plan.rs:171`)

- `resources` — 40 bytes: `id@0:u32`, `generation@4:u32`, `techniqueId@8:u32`, `resourceKind@12:u16`,
  `action@14:u16`, `flags@16:u32`, `referenceId@20:u32`, `lowerBound@24:u32`, `upperBound@28:u32`,
  `auxiliary0@32:u32`, `auxiliary1@36:u32`. Realize or retain the renderer resource named by `referenceId`; key the plan
  identity by `(id, generation)`. (`packages/glyph/src/generated/text-shaper-abi.ts:419`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:32`)
- `buffers` — 36 bytes: `id@0:u32`, `generation@4:u32`, `programId@8:u32`, `policyBufferId@12:u16`,
  `scalarType@14:u8`, `vectorWidth@15:u8`, `strategy@16:u16`, `flags@18:u16`, `liveRecords@20:u32`,
  `capacityRecords@24:u32`, `byteLength@28:u32`, `orderBufferId@32:u32`. Allocate renderer storage with the declared
  physical shape and use `policyBufferId` to bind it to the shader lane declared in the schema.
  (`packages/glyph/src/generated/text-shaper-abi.ts:224`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:48`)
- `patches` — 36 bytes: `opcode@0:u16`, `flags@2:u16`, `bufferId@4:u32`, `bufferGeneration@8:u32`,
  `destinationOffset@12:u32`, `byteLength@16:u32`, `payloadOffset@20:u32`, `sourceBufferId@24:u32`,
  `sourceOffset@28:u32`, `fillValue@32:u32`. Apply the named write, fill, or copy to the exact destination generation.
  Write payload offsets point inside the same publication. (`packages/glyph/src/generated/text-shaper-abi.ts:359`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:65`)
- `primitives` — 64 bytes: `id@0:u32`, `kind@4:u16`, `flags@6:u16`, `techniqueId@8:u32`,
  `resourceId@12:u32`, `resourceGeneration@16:u32`, `programId@20:u32`, `programVariant@24:u16`,
  `recordCount@26:u16`, `bufferId@28:u32`, `recordIndex@32:u32`, `logicalOrder@36:u32`, `clipId@40:u32`,
  `semanticId@44:u32`, `inlineStart@48:f32`, `blockStart@52:f32`, `inlineExtent@56:f32`,
  `blockExtent@60:f32`. A primitive is a logical span over consecutive records, not a GPU object.
  (`packages/glyph/src/generated/text-shaper-abi.ts:373`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:81`)
- `draws` — 64 bytes: `id@0:u32`, `programId@4:u32`, `programVariant@8:u16`, `flags@10:u16`,
  `materialId@12:u32`, `clipId@16:u32`, `depthKey@20:u32`, `transformId@24:u32`, `primitiveStart@28:u32`,
  `primitiveCount@32:u32`, `bufferStart@36:u32`, `bufferCount@40:u32`, `resourceStart@44:u32`,
  `resourceCount@48:u32`, `orderToken@52:u32`, `indirectBufferId@56:u32`, `indirectOffset@60:u32`. The three
  `Start`/`Count` pairs are ranges in the corresponding tables. (`packages/glyph/src/generated/text-shaper-abi.ts:283`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:105`)
- `retirements` — 24 bytes: `kind@0:u16`, `flags@2:u16`, `id@4:u32`, `generation@8:u32`,
  `afterPublicationGeneration@12:u32`, `byteOffset@16:u32`, `byteLength@20:u32`. This is the only release authority for
  engine storage. (`packages/glyph/src/generated/text-shaper-abi.ts:474`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:131`)
- `diagnostics` — 24 bytes: `code@0:u16`, `severity@2:u8`, `phase@3:u8`, `subjectId@4:u32`, `value0@8:u32`,
  `value1@12:u32`, `durationNanosLow@16:u32`, `durationNanosHigh@20:u32`. Treat these as plan telemetry; preserve unknown
  codes rather than inventing rendering behavior from them. (`packages/glyph/src/generated/text-shaper-abi.ts:271`,
  `packages/glyph/rust/shaper/src/engine/render_plan.rs:143`)

### Interpret draw identity at the renderer boundary

- `programId` is the renderer program/pipeline identity supplied to `createProgram()`. `programVariant` originates in the
  font binding and selects the `(capability set, technique, variant)` policy program; a renderer may use it for the matching
  shader specialization. (`packages/glyph/src/core/render-policy.ts:205`,
  `packages/glyph/src/core/font-binding.ts:39`, `packages/glyph/rust/shaper/src/engine/policy.rs:344`)
- `materialId` is renderer-owned data resolved from authored style, never a callback or renderer object in the engine.
  (`packages/glyph/src/core/frame-wire.ts:46`, `packages/glyph/rust/shaper/src/engine/render_plan.rs:112`)
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
  `packages/glyph/src/three/engine-plan-target.ts:649`)

## 7. Retain the frame handoff correctly

The publication transport is an A/B double buffer. A session owns two result arenas; the engine encodes into the inactive
slot, validates and commits, then makes that slot active. The host can keep displaying the previously realized frame while
the engine fills the other slot. (`packages/glyph/rust/shaper/src/engine/transport.rs:42`,
`packages/glyph/rust/shaper/src/engine/transport.rs:119`, `packages/glyph/rust/shaper/src/engine/transport.rs:135`)

The JavaScript ownership rule is deliberately stricter than physical slot arithmetic:

> **A borrowed publication expires when the session answers its next call.**

That includes another update, a measurement, a reserve or growth attempt, a failed call that reserved capacity, and
session disposal. Some bytes may physically survive for another slot turn, but relying on that would make liveness depend
on hidden arena state and eventually feed stale bytes to the GPU. (`packages/glyph/src/core/retention.ts:4`,
`packages/glyph/src/core/host.ts:238`)

Choose one handoff:

- Consume the borrow synchronously: call `session.assertLive(publication)` before decoding, apply every needed table and
  payload before another session call, then call `session.acknowledge(publication)`.
- Keep plan bytes or views: call `session.retain(publication)`. It makes one contiguous copy of the header, all tables, and
  patch payloads; brands the result as `RetainedTextEnginePublication`; and acknowledges consumption. The retained copy
  never expires. (`packages/glyph/src/core/host.ts:254`, `packages/glyph/src/core/host.ts:264`,
  `packages/glyph/src/core/retention.ts:36`)

Use `session.isExpired()` when branching is useful and `session.assertLive()` when a stale read is a defect. Both also
reject a publication issued by another session. (`packages/glyph/src/core/host.ts:238`,
`packages/glyph/src/core/host.ts:254`)

Acknowledgment is load-bearing, not bookkeeping. The engine delays retirements until the host has consumed the required
publication generation; acknowledging late retains old GPU storage, never acknowledging leaks it, and sending a generation
that goes backward is a revision conflict. `session.acknowledgedGeneration` is therefore copied into the next frame update.
(`packages/glyph/src/core/plan-view.ts:179`, `packages/glyph/src/core/retention.ts:17`,
`packages/glyph/src/core/frame-wire.ts:175`) This separate fence exists because “the host consumed plan revision N” does
not prove that storage associated with an earlier publication can be reused or released. Conflating the two would allow
retirement while renderer work still depended on that storage. (`docs/planning/decision-register.md:235`)

## 8. Apply patches instead of uploading whole buffers

Key every physical buffer by `(bufferId, bufferGeneration)`. A changed generation is new storage even when the numeric ID
is unchanged. Apply the `buffers` table first so allocations exist, then apply each patch to the exact generation it names.
(`packages/glyph/src/core/plan-view.ts:141`, `packages/glyph/src/core/retention.ts:23`)

The patch opcodes are `allocateOrResize`, `write`, `fill`, `copy`, and `retire`. Buffer rows describe allocations; write,
fill, and copy carry content deltas. A patch opcode named `retire` is **not** permission to destroy renderer storage. The
first-party consumer ignores allocation/retire patch opcodes for content application and releases only from the
`retirements` table. (`packages/glyph/src/generated/text-shaper-abi.ts:85`,
`packages/glyph/src/three/engine-plan-target.ts:404`, `packages/glyph/src/three/engine-plan-target.ts:1127`)

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
(`packages/glyph/src/three/engine-plan-target.ts:134`)
