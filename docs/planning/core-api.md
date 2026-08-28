---
type: API Specification
title: Core text API
description: Current root application vocabulary and renderer-neutral engine, backend, retained plan, policy, plan-target, and semantic record contracts.
documentation_type: reference
tags: [api, fonts, shaping, paragraphs, layout, rendering, ownership]
status: stable
sources:
  - id: decision-register
    resource: decision-register.md
    title: Accepted architectural decisions
  - id: ownership
    resource: font-runtime-ownership.md
    title: Font, engine, backend, retained plan, and target ownership
  - id: root-entry
    resource: ../../packages/glyph/src/index.ts
    title: Root application entry point
  - id: core-entry
    resource: ../../packages/glyph/src/core.ts
    title: Renderer-neutral integration entry point
  - id: engine
    resource: ../../packages/glyph/src/glyph-engine.ts
    title: Current Glyph engine
  - id: backend
    resource: ../../packages/glyph/src/core/backend.ts
    title: Current backend lifecycle
  - id: retained-plan
    resource: ../../packages/glyph/src/core/retained-plan.ts
    title: Current retained plan and target lifecycle
  - id: guide
    resource: ../guides/renderer-integration.md
    title: Renderer integration guide
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-28T20:20:47Z'
---

# Core text API

Glyph has two additive public surfaces:

- <code>@pmndrs/glyph</code> is application vocabulary: immutable fonts, font stacks, formatted text, Paragraph, layout values, technique definition, loading, and baking;
- <code>@pmndrs/glyph/core</code> is integration machinery: engine, backend, policy, bindings, retained plans, plan targets, portable resource contracts, and semantic plan readers.

Three and React are integrations over those surfaces. Canvas, scene, GPU device, material, pipeline, and render pass remain renderer-owned.

## Application-owned fonts

Font loading is independent from a shaping engine or renderer:

<pre><code>import { createFontStack, loadFont } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph/raster/msdf';

const inter = await loadFont({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: msdf },
});
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
  policy: { wrap: 'word' },
});

const metrics = paragraph.layout({
  width: { mode: 'at-most', size: 480 },
});
const positioned = paragraph.glyphs({
  width: { mode: 'exactly', size: metrics.contentWidth },
});</code></pre>

<code>createParagraph()</code> asynchronously acquires a private per-realm measurement engine. Once returned, <code>layout()</code>, <code>glyphs()</code>, and <code>update()</code> are synchronous.

- <code>layout()</code> returns aggregate dimensions, intrinsic widths, line metrics, baselines, and glyph count. A cache miss may synchronously incur font and layout lookup work.
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

<code>GlyphBackend</code> owns one integration's installed policies, font and stack bindings, renderer-owned material/resource/transform identities, retained plans, and collision-checked wire identities.

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

## Retained plan and retained text

One retained plan owns one retained batch, target, policy selection, capacity budget, and acceptance frontier:

<pre><code>const retainedPlan = backend.createRetainedPlan({
  policy,
  capabilitySet,
  target: () =&gt; target,
  limits,
  requestCapacity: 64 * 1024,
  resultCapacity: 256 * 1024,
  textCapacity: 16 * 1024,
});

const title = retainedPlan.createText({
  font: stack,
  text: 'Hello',
  style: { fontSize: 48 },
  contentBox: { width: { mode: 'at-most', size: 800 } },
});

title.update({ text: 'Hello, Glyph' });
const metrics = title.layout();
const positioned = title.glyphs();
const acceptance = retainedPlan.publish();
if (!acceptance.accepted) reportRendererError(acceptance.error);</code></pre>

<code>update()</code> validates and records desired state. Shaping is deferred until <code>layout()</code>, <code>glyphs()</code>, or <code>publish()</code> needs a current answer. <code>publish()</code> compiles a candidate, calls the target, and advances the accepted revision and retirement fence only after target commit.

<code>layout()</code> and <code>glyphs()</code> are synchronous, on-demand queries over current desired state. A cache miss may incur font/layout or glyph-positioning lookup work; <code>glyphs()</code> returns copied caller-owned columns. Neither query publishes a renderer plan.

Use another retained plan for an independently accepted scene, viewport, render target, or worker. Retained plans may share their backend's policies and font bindings but never share revision cursors.

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

Use <code>AsyncPlanTarget</code> only when CPU consumption crosses an asynchronous boundary, usually a Worker. The retained plan makes exactly one full-span standalone copy after checking the target's declared maximum. The sender transfers that allocation without another clone; the result returns the same buffer identity for bounded pool reuse.

Referenced payloads and transforms cross with validated manifests. Canonical font backing is never detached. The receiver treats transferred plan bytes as untrusted and binds them through <code>TextEngineRenderPlanView.bindBytes()</code>.

Synchronous and asynchronous retained plans may coexist under one backend. The engine-wide borrow gate prevents any backend from re-entering shared Wasm while a synchronous candidate is active.

## Semantic render-plan surface

<code>TextEngineRenderPlanView</code> validates publication framing. Integrations consume records through semantic readers:

| Table       | Reader                                  | Meaning                                                       |
| ----------- | --------------------------------------- | ------------------------------------------------------------- |
| resources   | <code>readTextEngineResource()</code>   | Create, update, or retain a portable resource realization.    |
| buffers     | <code>readTextEngineBuffer()</code>     | Declare renderer storage and semantic policy binding.         |
| patches     | <code>readTextEnginePatch()</code>      | Allocate/resize, write, fill, copy, or retire byte ranges.    |
| primitives  | <code>readTextEnginePrimitive()</code>  | Map record spans to technique, resource, geometry, and order. |
| draws       | <code>readTextEngineDraw()</code>       | Submit ordered program/material/transform spans.              |
| retirements | <code>readTextEngineRetirement()</code> | Release exact generations after the acknowledged fence.       |
| diagnostics | table access only                       | Optional telemetry; it does not define renderer behavior.     |

Readers return semantic discriminated unions and branded numeric identities. Raw shaper ABI layouts, offsets, enum ordinals, and internal handles are package-private.

<code>candidate.acquirePayload(referenceId)</code> returns a counted lease over one immutable portable payload and its declared companions. A renderer realizes it per physical device/context and keeps the lease while cached GPU state references it. Plan <code>(id, generation)</code> values key the renderer cache; <code>resourceName</code> is the schema name expected by the selected shader.

## Failure and disposal

Public inputs are checked at their call. Invalid policy, font, stack, text, capacities, plan framing, record relationships, or cross-owner values do not become deferred renderer failures.

A valid emitted plan that contradicts its own metadata is an engine defect, not recoverable user input. The target rejects the candidate transaction predictably and preserves the last accepted renderer state without replaying it as new content.

Dispose leaf objects when their lifetime ends:

<pre><code>title.dispose();
retainedPlan.dispose();
stack.dispose();
policy.dispose();
backend.dispose();
engine.dispose();
inter.dispose();</code></pre>

Parent disposal cascades as a safety net. Explicit disposal remains the correctness mechanism; finalization is not used to guess ordering among engine, backend, device, retained plan, and resource lifetimes.

## Related current documentation

- [Integrate a renderer with Glyph](../guides/renderer-integration.md)
- [Portable raster-technique implementation report](../guides/technique-implementation-report.md)
- [Font, engine, backend, retained plan, and render-target ownership](font-runtime-ownership.md)
- [Current Glyph package reference](../packages/glyph.md)
