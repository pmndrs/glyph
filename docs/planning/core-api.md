---
type: API Specification
title: Core text API
description: Current root application vocabulary and renderer-neutral engine, backend, render planner, policy, plan-target, and semantic record contracts.
documentation_type: reference
tags: [api, fonts, shaping, paragraphs, layout, rendering, ownership]
status: stable
sources:
  - id: decision-register
    resource: decision-register.md
    title: Accepted architectural decisions
  - id: ownership
    resource: font-runtime-ownership.md
    title: Font, engine, backend, render planner, and target ownership
  - id: root-entry
    resource: ../../packages/glyph/src/index.ts
    title: Root application entry point
  - id: glyph-runtime
    resource: ../../packages/glyph/src/glyph.ts
    title: Root Glyph runtime and named handles
  - id: glyph-config
    resource: ../../packages/glyph/src/core/glyph-config.ts
    title: GlyphConfig, decoder, resolver, and renderer contracts
  - id: core-entry
    resource: ../../packages/glyph/src/core.ts
    title: Renderer-neutral integration entry point
  - id: engine
    resource: ../../packages/glyph/src/glyph-engine.ts
    title: Current Glyph engine
  - id: backend
    resource: ../../packages/glyph/src/core/backend.ts
    title: Current backend lifecycle
  - id: render-planner
    resource: ../../packages/glyph/src/core/render-planner.ts
    title: Current render planner and target lifecycle
  - id: guide
    resource: ../guides/renderer-integration.md
    title: Renderer integration guide
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-28T20:20:47Z'
---

# Core text API

Glyph has two additive public surfaces:

- <code>@pmndrs/glyph</code> is application vocabulary: the initialized <code>glyph</code> runtime, immutable fonts, font stacks, formatted text, Paragraph, layout values, technique definition, loading, and baking;
- <code>@pmndrs/glyph/core</code> is integration machinery: <code>GlyphConfig</code>, Codec/decode/resolve/renderer contracts, engine, backend, policy ABI, bindings, render planners, plan targets, portable resource contracts, and semantic plan readers.

Three and React are integrations over those surfaces. Canvas, scene, GPU device, material, pipeline, and render pass remain renderer-owned.

## Root Glyph runtime and handles

Application adapters share one process-local engine initialization and create named, independently disposable handles:

<pre><code>import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';

await glyph.init();
const labels = glyph.handle('labels', ThreeConfig);
const hud = glyph.handle('hud', {
  ...ThreeConfig,
  renderer(context) {
    const renderer = ThreeConfig.renderer(context);
    return { ...renderer, decode: (view) =&gt; instrument(renderer.decode(view)) };
  },
});

labels.dispose();
hud.dispose();</code></pre>

Concurrent or repeated <code>glyph.init()</code> calls share the same initialization. A live name is unique; disposal releases the name for reuse. Handles share only immutable root assets and the initialized engine. Each handle owns its adapter backend, Codec registration, bound font/resource state, and factories. Multiple handles and multiple scenes may coexist; a handle is neither a scene nor a render pass.

<code>GlyphConfig.encode()</code> supplies the adapter's <code>Codec</code>. The engine owns its encoded command buffer and internally projects a borrowed <code>CommandBufferView</code>. <code>resolve</code> returns counted resource leases. Finally <code>renderer.decode()</code> receives that view, organized into resource, buffer, patch, ordered <code>DisplayList</code>, and retirement phases. The display list is a nested view over the same command buffer, not a separately parsed representation. All renderer-facing identities are objects chosen by the config's binding vocabulary; ordinary renderer code never receives numeric plan IDs.

<code>applyGlyphPublication()</code> is the renderer-neutral project → decode → commit/discard transaction shared by the built-in Three adapter and the example renderer. The internal display-list projector retains stable bindings across publications and settles candidate-only resource leases on acceptance or rejection. A config instruments this flow by wrapping its renderer; there is no configurable intermediate decoder.

## Application-owned fonts

Font loading is independent from a shaping engine or renderer:

<pre><code>import { createFontStack, loadFont } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph/raster/msdf';

const inter = await loadFont({ baked: '/fonts/Inter.font.glb' }, msdf);
const body = createFontStack(inter);</code></pre>

<code>Font&lt;Technique&gt;</code> owns immutable artifact backing and decoded portable raster data. It may bind into several engines or backends and may outlive any one of them. <code>font.dispose()</code> prevents new bindings; existing counted bindings keep the backing alive until their own disposal.

<code>FontLibrary</code> is an optional application cache with explicit leases. Top-level <code>loadFont()</code> coalesces only in-flight work and does not make an unbounded global cache.

## Renderer-free Paragraph

Detached measurement is root application vocabulary:

<pre><code>import { createParagraph } from '@pmndrs/glyph';

const paragraph = await createParagraph({
  font: body,
  text: 'Measure before rendering',
  style: { fontSize: 32 },
  layout: { wrap: 'word' },
});

const metrics = paragraph.measure({
  width: { mode: 'at-most', size: 480 },
});
const positioned = paragraph.glyphs({
  width: { mode: 'exact', size: metrics.contentWidth },
});</code></pre>

<code>createParagraph()</code> asynchronously acquires a private per-realm measurement engine. Once returned, <code>measure()</code>, <code>glyphs()</code>, and <code>update()</code> are synchronous.

- <code>measure()</code> returns aggregate dimensions, intrinsic widths, line metrics, baselines, and glyph count. A cache miss may synchronously incur font and measure lookup work.
- <code>glyphs()</code> returns caller-owned positioned glyph and line columns plus ink boxes. A cache miss may synchronously incur glyph lookup and positioning; every call copies the returned columns.
- neither query publishes a renderer plan, creates GPU resources, needs a scene matrix, or changes renderer acceptance;
- invalid constraints throw at the call that supplied them.

## Engine and backend

<pre><code>import { createGlyphEngine } from '@pmndrs/glyph/core';

const engine = await createGlyphEngine();
const backend = engine.createBackend({
  integration: 'studio.webgpu-text',
});</code></pre>

<code>GlyphEngine</code> owns one Wasm shaping domain, its engine-local font registrations, an engine-wide borrowed-plan gate, and every backend it creates. <code>engine.dispose()</code> disposes child backends before releasing Wasm. A backend cannot detach or rebind.

<code>GlyphBackend</code> owns one integration's installed policies, font and stack bindings, renderer-owned material/resource/transform identities, render planners, and collision-checked wire identities.

Several backends may share one engine when their policy or device lifetimes differ but shared Wasm registration is useful. Use separate engines for worker, memory, or teardown isolation.

## Policy installation and font binding

A renderer combines technique-owned portable policy bodies with renderer-owned system lanes and capabilities:

<pre><code>const policy = backend.installPolicy((ids) =&gt; ({
  capabilitySets: [capabilitySet],
  programs: [
    createRasterPolicyProgram(examplePlan, {
      namespace: 'studio.webgpu-text',
      system: rendererSystemBuffers,
      capabilitySet,
      transformMode: 'direct',
      allocationMode: 'ordered',
      ids,
    }),
  ],
}));

const stack = backend.bindFontStack(body);</code></pre>

Policy authors use semantic capability/scalar names and branded hash helpers. They never type raw ABI ordinals or caller-chosen numeric IDs. Compilation assigns capability-set ordinals and rejects collisions or malformed descriptors before registration.

<code>bindFont()</code> and <code>bindFontStack()</code> are backend-local, idempotent in underlying registration, and return independent counted leases. Binding requires a compatible policy, deduplicates shaping registration in the engine, runs the technique's cold <code>compileFont()</code> path, registers binding bytes, and retains constrained immutable payloads. Cross-backend, disposed, or incompatible bindings throw at the call boundary.

Integrators that need a CPU oracle or allocation diagnostics may call <code>compileRasterFont()</code> followed by <code>readCompiledRasterFont()</code>. The read-only view resolves schema field names, strikes, selected resources, and portable payloads directly from the authenticated compiled binding. It does not expose the technique's internal decoded <code>Font.data</code>, perform another decode, or copy the binding's scalar value tables.

## Render planner and retained text

One render planner owns one desired-text set, target, policy selection, capacity budget, and acceptance frontier:

<pre><code>const planner = backend.createPlanner({
  policy,
  capabilitySet,
  target: () =&gt; target,
  limits,
  requestCapacity: 64 * 1024,
  resultCapacity: 256 * 1024,
  textCapacity: 16 * 1024,
});

const title = planner.createText({
  font: stack,
  text: 'Hello',
  style: { fontSize: 48 },
  constraints: { width: { mode: 'at-most', size: 800 } },
});

title.update({ text: 'Hello, Glyph' });
const metrics = title.measure();
const positioned = title.glyphs();
const acceptance = planner.publish();
if (!acceptance.accepted) reportRendererError(acceptance.error);</code></pre>

<code>update()</code> validates and records desired state. Shaping is deferred until <code>measure()</code>, <code>glyphs()</code>, or <code>publish()</code> needs a current answer. <code>publish()</code> compiles a candidate, calls the target, and advances the accepted revision and retirement fence only after target commit.

<code>measure()</code> and <code>glyphs()</code> are synchronous, on-demand queries over current desired state. A cache miss may incur font/measure or glyph-positioning lookup work; <code>glyphs()</code> returns copied caller-owned columns. Neither query publishes a renderer plan.

Use another render planner for an independently accepted scene, viewport, render target, or worker. Render planners may share their backend's policies and font bindings but never share revision cursors.

### Copy committed records into an independent target

Renderer integrations may request a complete one-shot checkpoint from one committed retained text:

```ts
const result = title.copyGlyphs(drawableStableIds, detachedTarget);
if (!result.accepted) throw result.error;

const decorationResult = title.copyDecorations(detachedDecorationTarget);
if (!decorationResult.accepted) throw decorationResult.error;
```

`copyGlyphs()` accepts unique non-zero stable IDs that the renderer observed on drawable physical records in that
paragraph's accepted plan. It is not a second publication stream and does not mutate desired text, source plan buffers,
revisions, A/B slots, publication generation, or the source planner's acceptance frontier. Rust re-runs the installed
policy over those committed records and emits one complete compact checkpoint. `copyDecorations()` does the same for the
paragraph's complete under/over decoration set.

Both calls require a synchronous borrowed `PlanTarget`. The target must import every buffer, draw, payload lease,
material, transform, and resource relationship before `accept()` returns; borrowed Wasm bytes expire immediately after
that return. A successful renderer import is self-contained and independently disposable. No Promise resolution or
asynchronous readiness state exists in this hot path.

The copy is planner-assisted because only the planner has authoritative semantic-to-physical record, buffer, resource,
program, and draw relationships. A renderer should not reverse-engineer those relationships from current GPU objects.
The complete contract and Three.js realization are recorded in
[Planner-assisted detached glyph slices](detached-glyph-slice.md).

## PlanTarget: normal borrowed delivery

<code>PlanTarget</code> is the default same-thread renderer contract:

<pre><code>const target: PlanTarget = {
  delivery: 'borrowed',
  accept(candidate, signal) {
    signal.throwIfAborted();
    const transaction = device.beginCandidate(candidate.planRevision);
    try {
      decodeAndStage(candidate, transaction);
      transaction.commit();
      return { accepted: true };
    } catch (error) {
      transaction.discard();
      return { accepted: false, error };
    }
  },
  dispose() {
    device.disposeTarget();
  },
};</code></pre>

The candidate borrows Wasm A/B memory only for synchronous <code>accept()</code>. A renderer copies patch bytes into its own upload/GPU storage and encodes commands before returning; later GPU execution does not retain plan memory.

Acceptance is transactional. A rejected candidate releases provisional objects, does not substitute stale resources, does not advance acceptance, and is not retried unchanged. Explicit renderer invalidation may request a checkpoint after device/resource recovery.

## AsyncPlanTarget: actual asynchronous boundaries

Use <code>AsyncPlanTarget</code> only when CPU consumption crosses an asynchronous boundary, usually a Worker. The render planner makes exactly one full-span standalone copy after checking the target's declared maximum. The sender transfers that allocation without another clone; the result returns the same buffer identity for bounded pool reuse.

Referenced payloads and transforms cross with validated manifests. Canonical font backing is never detached. The receiver treats transferred plan bytes as untrusted and binds them through <code>RenderPlanView.bindBytes()</code>.

Synchronous and asynchronous render planners may coexist under one backend. The engine-wide borrow gate prevents any backend from re-entering shared Wasm while a synchronous candidate is active.

## Semantic render-plan surface

<code>RenderPlanView</code> validates publication framing. Integrations consume records through semantic readers:

| Table       | Reader                                  | Meaning                                                       |
| ----------- | --------------------------------------- | ------------------------------------------------------------- |
| resources   | <code>readRenderPlanResource()</code>   | Create, update, or retain a portable resource realization.    |
| buffers     | <code>readRenderPlanBuffer()</code>     | Declare renderer storage and semantic policy binding.         |
| patches     | <code>readRenderPlanPatch()</code>      | Allocate/resize, write, fill, copy, or retire byte ranges.    |
| primitives  | <code>readRenderPlanPrimitive()</code>  | Map record spans to technique, resource, geometry, and order. |
| draws       | <code>readRenderPlanDraw()</code>       | Submit ordered program/material/transform spans.              |
| retirements | <code>readRenderPlanRetirement()</code> | Release exact generations after the acknowledged fence.       |
| diagnostics | table access only                       | Optional telemetry; it does not define renderer behavior.     |

Readers return semantic discriminated unions and branded numeric identities. Raw shaper ABI layouts, offsets, enum ordinals, and internal handles are package-private.

<code>candidate.acquirePayload(referenceId)</code> returns a counted lease over one immutable portable payload and its declared companions. A renderer realizes it per physical device/context and keeps the lease while cached GPU state references it. Plan <code>(id, generation)</code> values key the renderer cache; <code>resourceName</code> is the schema name expected by the selected shader.

## Failure and disposal

Public inputs are checked at their call. Invalid policy, font, stack, text, capacities, plan framing, record relationships, or cross-owner values do not become deferred renderer failures.

A valid emitted plan that contradicts its own metadata is an engine defect, not recoverable user input. The target rejects the candidate transaction predictably and preserves the last accepted renderer state without replaying it as new content.

Dispose leaf objects when their lifetime ends:

<pre><code>title.dispose();
planner.dispose();
stack.dispose();
policy.dispose();
backend.dispose();
engine.dispose();
inter.dispose();</code></pre>

Parent disposal cascades as a safety net. Explicit disposal remains the correctness mechanism; finalization is not used to guess ordering among engine, backend, device, render planner, and resource lifetimes.

## Related current documentation

- [Integrate a renderer with Glyph](../guides/renderer-integration.md)
- [Portable raster-technique implementation report](../guides/technique-implementation-report.md)
- [Font, engine, backend, render planner, and render-target ownership](font-runtime-ownership.md)
- [Current Glyph package reference](../packages/glyph.md)
