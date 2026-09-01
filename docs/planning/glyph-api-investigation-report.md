---
type: Research Report
title: Glyph handle and renderer-bound command-buffer investigation
description: Evidence-backed audit and implementation report for the Glyph, GlyphConfig, FontFace, handle, decode, resolve, renderer, Three, and R3F lifecycle.
documentation_type: explanation
tags: [api, glyph, font-face, threejs, react, r3f, renderer, command-buffer, ownership]
status: draft
sources:
  - id: investigation-handoff
    resource: glyph-api-investigation-handoff.md
    title: Glyph API investigation handoff
  - id: engineering-standard
    resource: ../engineering/code-style.md
    title: Engineering house style
  - id: decision-register
    resource: decision-register.md
    title: Decision register
  - id: current-three-text
    resource: ../../packages/glyph/src/three/text.ts
    title: Current Three Text and TextGroup lifecycle
  - id: current-three-domain
    resource: ../../packages/glyph/src/three/engine-domain.ts
    title: Current Three engine-domain ownership
  - id: current-three-coordinator
    resource: ../../packages/glyph/src/three/engine-coordinator.ts
    title: Current Three engine coordinator
  - id: current-three-plan-target
    resource: ../../packages/glyph/src/three/engine-plan-target.ts
    title: Current Three render-plan executor
  - id: current-three-policy
    resource: ../../packages/glyph/src/three/render-policy.ts
    title: Current Three render policy
  - id: current-three-material
    resource: ../../packages/glyph/src/three/material.ts
    title: Current Three material extension
  - id: current-react
    resource: ../../packages/glyph/src/react.ts
    title: Current R3F wrapper
  - id: current-font-contract
    resource: ../../packages/glyph/src/font.ts
    title: Current immutable Font and discovery-token contract
  - id: current-font-loader
    resource: ../../packages/glyph/src/loader.ts
    title: Current immutable Font and FontLibrary loader
  - id: current-bake-cli
    resource: ../../packages/glyph/src/node/cli.ts
    title: Current direct bake CLI defaults and raster flags
  - id: installed-r3f-scheduler
    resource: ../../packages/glyph/node_modules/@react-three/fiber/dist/index.mjs
    title: Installed R3F 10 scheduler
  - id: installed-r3f-types
    resource: ../../packages/glyph/node_modules/@react-three/fiber/dist/index.d.ts
    title: Installed R3F 10 root-state types
  - id: installed-three-renderer
    resource: ../../packages/glyph/node_modules/three/src/renderers/common/Renderer.js
    title: Installed Three 0.185 renderer
  - id: installed-three-backend
    resource: ../../packages/glyph/node_modules/three/src/renderers/common/Backend.js
    title: Installed Three backend canvas ownership
  - id: installed-three-textures
    resource: ../../packages/glyph/node_modules/three/src/renderers/common/Textures.js
    title: Installed Three renderer texture manager
  - id: installed-three-webgpu-textures
    resource: ../../packages/glyph/node_modules/three/src/renderers/webgpu/utils/WebGPUTextureUtils.js
    title: Installed Three WebGPU texture realization
  - id: installed-three-webgpu-backend
    resource: ../../packages/glyph/node_modules/three/src/renderers/webgpu/WebGPUBackend.js
    title: Installed Three WebGPU device and canvas binding
  - id: current-plan-contract
    resource: ../../packages/glyph/src/core/render-planner.ts
    title: Current render-plan delivery and lifetime contract
  - id: current-plan-view
    resource: ../../packages/glyph/src/core/plan-view.ts
    title: Current render-plan tables and decoded records
  - id: current-example
    resource: ../../packages/glyph-example-renderer/src/engine.ts
    title: Current example renderer
  - id: current-example-reader
    resource: ../../packages/glyph-example-renderer/src/plan-reader.ts
    title: Current example plan decoder
  - id: implemented-glyph-runtime
    resource: ../../packages/glyph/src/glyph.ts
    title: Implemented root Glyph runtime
  - id: implemented-config-contract
    resource: ../../packages/glyph/src/core/glyph-config.ts
    title: Implemented GlyphConfig and publication helpers
  - id: implemented-three-config
    resource: ../../packages/glyph/src/three/handle.ts
    title: Implemented ThreeConfig and handle lifecycle
  - id: implemented-three-binder
    resource: ../../packages/glyph/src/three/command-buffer.ts
    title: Implemented Three command-buffer binder
  - id: implemented-transform-sync
    resource: ../../packages/glyph/src/three/transform-synchronizer.ts
    title: Implemented cheap Three transform path
  - id: implemented-example-config
    resource: ../../packages/glyph-example-renderer/src/config.ts
    title: Implemented example GlyphConfig
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-01T00:00:00-04:00'
---

# Glyph handle and renderer-bound command-buffer investigation

Status: handle/config investigation implemented; D-295 FontFace direction approved with implementation pending

## Conclusion

The pre-change code supported the intended direction, with three qualifications. The lifecycle audit below is retained as
the evidence that informed the design; the implementation outcome following it records what now ships in this working
tree.

First, the repository previously did not expose `Glyph`, `glyph`, `GlyphConfig`, `glyph.handle()`, or a public `shape()`
call. D-293 now records the approved ordinary-adapter surface while retaining
`createGlyphEngine() -> GlyphBackend -> RenderPlanner` under `/core` as the low-level integrator escape hatch.

Second, `decode(TypedCommandBuffer)` should return a **borrowed, phase-structured `BoundCommandBuffer<Bindings>`**. `GlyphConfig.decode` is a required, type-safe hook, and every built-in config wires the same engine-supplied `defaultDecoder` unless it deliberately overrides it. The decoder implementation remains owned by the engine package, but decoder selection is explicit in the config. Its output must contain stable object bindings, not plan IDs: resource bindings already produced by `resolve`, buffer bindings in place of buffer IDs, transform and material bindings in place of numeric handles, primitive objects in place of primitive indices, and retirement commands naming those same bindings. The handle and each private publication boundary own the leases and renderer transaction. The renderer may retain its own committed host objects, but it may not retain the bound command arrays or borrowed patch bytes.

Third, React context should carry only the selected Three handle. It must neither initialize Glyph nor own a second registry, engine, decoder, resource pool, renderer, scene, or canvas binding. A handle selection change reconstructs the retained Three object. Nested inline `<Text>` remains compiled into the outer paragraph and never reads context independently.

Three does not require a renderer, scene, canvas, or `GPUDevice` in `GlyphConfig.resolve`. The resolver creates Three JavaScript objects; `Text`/`TextGroup` own their `Object3D` hierarchy and private publication boundaries; the host's `WebGPURenderer` later encounters those objects and realizes renderer-local GPU resources. A raw WebGPU adapter is different: it needs a `GPUDevice` at the first `device.create*` call, but it still does not need a canvas until it configures a `GPUCanvasContext` and presents a frame. That device can be captured by that adapter's config factory or handle closure without adding a universal host-context or public session concept.

The current implementation already proves the most important lifecycle split: semantic changes publish through the Rust plan, while matrix-only changes call `syncTransforms()` without crossing into Wasm. It also proves that renderer acceptance needs a prepare/commit/discard transaction, that portable payload leases outlive borrowed plan bytes, and that actual drawing remains the host renderer's job.

## Implementation outcome

The approved contract is implemented without making React context, a Three scene, or a Three renderer into another Glyph
runtime:

- root `glyph.init()` is concurrent-safe and idempotent; named live handles are unique and independently disposable;
- `GlyphConfig` requires `encode`, explicit `decode`, `resolve`, `renderer`, and `createHandle`; public `Codec` wraps the
  existing policy-named low-level descriptor without renaming the internal ABI;
- `defaultDecoder` remains engine-owned but is wired explicitly and can be wrapped or replaced with the exact config
  `Bindings` type;
- `GlyphCommandBufferBinder` and `applyGlyphPublication()` are renderer-neutral helpers used by both Three and the example
  renderer. They own the borrowed decode → prepare → commit/discard settlement and candidate resource cleanup;
- `BorrowedBoundCommandBuffer` has resource, buffer, patch, primitive, draw, and retirement phases. Bindings are stable
  objects. Numeric plan/resource/buffer/program/primitive/draw IDs remain private inside each adapter binder;
- `/three` exports `ThreeConfig`, `defineThreeConfig()`, and `ThreeHandle`. `handle.createText()` and
  `handle.createTextGroup()` inject the handle domain through a private constructor seam. The existing `Text` or
  `TextGroup` is the draw root, and committed Three `Mesh` values become its children;
- `Text.shape()` and `TextGroup.shape()` synchronously flush semantic state. Clean boundaries route only through the
  extracted `ThreeTransformSynchronizer`, which has no engine, Codec, decoder, resolver, or publication dependency;
- R3F `<Text>` and `<TextGroup>` use the nearest immutable `GlyphProvider` selection or one lazily initialized default
  `ThreeConfig` handle. They expose no handle prop; provider remounts select another handle, while nested inline `<Text>`
  continues to flatten into the outer paragraph;
- the example renderer implements the same config/binder/publication contract, retaining a private numeric draw-list
  bridge only for its existing concrete device oracle.

The implementation tests cover repeated/concurrent initialization, two named Three handles over one immutable font,
spread config hooks, explicit decode and resolve calls, standalone and grouped draw-root attachment, multiple scenes on
one handle, cross-handle group rejection, name reuse after disposal, explicit `shape()`, transform-only bypass of semantic
phases, R3F provider/default-handle construction, immutable provider selection, React lease balance, and the configured
example-renderer path. The final full Glyph behavioral run passed 938 TypeScript tests plus its Rust suites, declarations,
lint, and formatting. The focused React lifecycle run passed 11 tests, the combined R3F/span run passed 45 tests, and the
example renderer passed 13 tests.

## Pre-change evidence status of the handoff

The following audit records the repository state inspected before implementation and distinguishes those facts from the
then-proposed design. The implementation outcome above is authoritative for the resulting working tree.

| Handoff claim                                                                                   | Status                                                   | Verified evidence or correction                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current Three has an implicit shared engine domain.                                             | Verified.                                                | First loader use creates one weakly cached domain; initialization creates one `GlyphEngine` and one `ThreeTextEngineCoordinator` ([engine-domain.ts:58-73](../../packages/glyph/src/three/engine-domain.ts#L58-L73), [126-149](../../packages/glyph/src/three/engine-domain.ts#L126-L149)).                                                                                                                                                 |
| A Three `Font` must be initialized before `Text` construction.                                  | Verified for the current API.                            | `acquireThreeTextDomain()` rejects any selected variant without a ready associated domain ([engine-domain.ts:87-104](../../packages/glyph/src/three/engine-domain.ts#L87-L104)).                                                                                                                                                                                                                                                            |
| Loaded fonts are immutable application values.                                                  | Verified.                                                | `Font` exposes readonly metadata and a disposal lease; stacks are frozen and authenticated ([font.ts:48-55](../../packages/glyph/src/font.ts#L48-L55), [loaded-font.ts:44-68](../../packages/glyph/src/loaded-font.ts#L44-L68)).                                                                                                                                                                                                            |
| Current `Text` retains desired state and binds an opaque transform.                             | Verified.                                                | Construction normalizes desired state, acquires the domain, binds `this` through the coordinator, and binds fonts ([text.ts:168-204](../../packages/glyph/src/three/text.ts#L168-L204)); the coordinator maps a backend binding to `Object3D` through a `WeakMap` ([engine-coordinator.ts:84-87](../../packages/glyph/src/three/engine-coordinator.ts#L84-L87), [185-196](../../packages/glyph/src/three/engine-coordinator.ts#L185-L196)). |
| `TextGroup` is the current batch/publication boundary.                                          | Verified.                                                | Nested `TextGroup`s terminate descendant collection, each nonempty group creates one `ThreeTextBatchBinding`, and one synchronization follows reconciliation ([text.ts:639-654](../../packages/glyph/src/three/text.ts#L639-L654), [1276-1285](../../packages/glyph/src/three/text.ts#L1276-L1285)).                                                                                                                                        |
| A clean frame uses a transform-only path.                                                       | Verified.                                                | `synchronize()` calls `syncTransforms()` directly when no publication is pending ([text.ts:894-925](../../packages/glyph/src/three/text.ts#L894-L925)); the executor documents and implements that path without Wasm ([engine-plan-target.ts:384-449](../../packages/glyph/src/three/engine-plan-target.ts#L384-L449)).                                                                                                                     |
| The current executor decodes, resolves, realizes, commits, and retires.                         | Verified.                                                | Its state includes buffers, resources, textures/pages, materials, transforms, origins, draws, and preparation state ([engine-plan-target.ts:250-275](../../packages/glyph/src/three/engine-plan-target.ts#L250-L275)); `accept()` calls `prepare()` then `commit()` transactionally ([301-309](../../packages/glyph/src/three/engine-plan-target.ts#L301-L309), [473-608](../../packages/glyph/src/three/engine-plan-target.ts#L473-L608)). |
| Current R3F uses no Glyph context.                                                              | Verified.                                                | `react.ts` imports React hooks but creates no context or provider; `Text` and `TextGroup` construct the existing Three classes through R3F `extend()` ([react.ts:1-14](../../packages/glyph/src/react.ts#L1-L14), [126-202](../../packages/glyph/src/react.ts#L126-L202), [204-265](../../packages/glyph/src/react.ts#L204-L265)).                                                                                                          |
| R3F nested `<Text>` creates no Three object.                                                    | Verified.                                                | `flattenText()` recognizes nested `Text`, derives string ranges, and emits spans into the outer paragraph ([react.ts:442-485](../../packages/glyph/src/react.ts#L442-L485)).                                                                                                                                                                                                                                                                |
| The example renderer is a second consumer of the same portable plan.                            | Verified.                                                | It creates a backend/policy/planner, decodes all plan tables, realizes resources through a device, commits a submission, and retires payloads ([example engine.ts:57-135](../../packages/glyph-example-renderer/src/engine.ts#L57-L135), [255-333](../../packages/glyph-example-renderer/src/engine.ts#L255-L333), [plan-reader.ts:16-71](../../packages/glyph-example-renderer/src/plan-reader.ts#L16-L71)).                               |
| `decode => BoundCommandBuffer`, `GlyphConfig`, handles, and `shape()` existed before this work. | Not in the audited baseline; implemented after approval. | The prior published integrator boundary was `PlanCandidate`/`PlanTarget`. D-293 and the implementation outcome above record the added ordinary-adapter surface.                                                                                                                                                                                                                                                                             |

## 1. Verified current lifecycle: imperative Three

### Initialization and fonts

1. Constructing `FontLoader` does not initialize the engine. The first load or `initFont()` lazily calls `acquireThreeLoaderDomain()` ([font-loader.ts:115-123](../../packages/glyph/src/three/font-loader.ts#L115-L123), [155-158](../../packages/glyph/src/three/font-loader.ts#L155-L158)).
2. The domain starts `createGlyphEngine()`, then creates one coordinator over that engine ([engine-domain.ts:126-149](../../packages/glyph/src/three/engine-domain.ts#L126-L149)). Loader, associated-font, and text leases keep the domain alive; it disposes the coordinator and engine only when all three counts reach zero ([engine-domain.ts:175-184](../../packages/glyph/src/three/engine-domain.ts#L175-L184)).
3. A completed load returns a root `Font` and associates its immutable technique-variant identity with the current domain ([font-loader.ts:132-152](../../packages/glyph/src/three/font-loader.ts#L132-L152), [engine-domain.ts:157-172](../../packages/glyph/src/three/engine-domain.ts#L157-L172)). The association is renderer bookkeeping; it does not make the `Font` mutable or renderer-owned.

### Text construction and desired state

4. `new Text(properties)` validates and freezes desired semantic state, locates one domain from all root/span fonts, binds the `Text` object to an opaque backend transform, and creates backend font-stack bindings ([text.ts:184-204](../../packages/glyph/src/three/text.ts#L184-L204), [1073-1098](../../packages/glyph/src/three/text.ts#L1073-L1098)). It does **not** create a planner, target, or mesh yet.
5. `Text.set()` computes new desired state, stages an update into an existing batch when one exists, advances the desired revision, and invalidates measurement/bounds. Intermediate desired values can coalesce before traversal ([text.ts:278-310](../../packages/glyph/src/three/text.ts#L278-L310)).
6. `scene.add(text)` or `group.add(text)` only changes scene hierarchy. The integration test explicitly verifies that add/construction does not shape eagerly ([three-v1.test.mjs:720-735](../../packages/glyph/tests/integration/three-v1.test.mjs#L720-L735)).

### Scene traversal, publication, and commit

7. Three's traversal reaches `Text.updateMatrixWorld()` after `super.updateMatrixWorld()` has made its world matrix current. A standalone attached `Text` creates/reuses an implicit one-text `ThreeTextBatchBinding`, reconciles, and synchronizes. A `Text` beneath the nearest live `TextGroup` returns and lets that group own the batch ([text.ts:461-500](../../packages/glyph/src/three/text.ts#L461-L500)).
8. `TextGroup.updateMatrixWorld()` first delegates ordinary recursive matrix traversal to Three. It then collects non-disposed descendant `Text` objects, stopping at nested `TextGroup`s, validates that they share a coordinator, reconciles one group binding, and synchronizes once ([text.ts:639-660](../../packages/glyph/src/three/text.ts#L639-L660), [1276-1304](../../packages/glyph/src/three/text.ts#L1276-L1304)).
9. A `ThreeTextBatchBinding` owns one domain lease, `RenderPlanner`, `ThreeTextRenderPlanExecutor`, and map of public `Text` objects to engine `RetainedText` handles ([text.ts:694-756](../../packages/glyph/src/three/text.ts#L694-L756)). Reconciliation creates, updates, removes, or reorders those retained handles and marks a publication pending ([785-832](../../packages/glyph/src/three/text.ts#L785-L832), [960-1003](../../packages/glyph/src/three/text.ts#L960-L1003)).
10. With semantic work pending, `synchronize()` calls `planner.publish()`. The planner offers a borrowed `PlanCandidate` synchronously to the executor and expires the plan immediately after `accept()` returns ([text.ts:894-925](../../packages/glyph/src/three/text.ts#L894-L925), [render-planner.ts:720-736](../../packages/glyph/src/core/render-planner.ts#L720-L736)).
11. The executor decodes table rows, acquires portable payload leases, resolves Three programs/materials/transforms, stages resources and buffers, stages patches, creates or reuses meshes, prepares transforms, and applies retirements. `commit()` attaches new meshes to the batch draw root, removes obsolete meshes, swaps all retained maps, and disposes retired objects; rejection discards only candidate-owned objects and preserves the prior committed branch ([engine-plan-target.ts:473-608](../../packages/glyph/src/three/engine-plan-target.ts#L473-L608), [1739-1771](../../packages/glyph/src/three/engine-plan-target.ts#L1739-L1771)).
12. After acceptance, the batch advances each public `Text`'s committed revision and publishes measurement caches, then synchronizes current transforms ([text.ts:917-924](../../packages/glyph/src/three/text.ts#L917-L924)).

### Transform-only frames and actual drawing

13. With no pending semantic publication, the batch skips `planner.publish()` and calls only `syncTransforms()`. That method updates render order, relative matrices/visibility, and either an indexed storage attribute or direct draw matrices ([text.ts:903-906](../../packages/glyph/src/three/text.ts#L903-L906), [engine-plan-target.ts:384-449](../../packages/glyph/src/three/engine-plan-target.ts#L384-L449)). Existing integration evidence verifies zero Rust crossings for no-op work and a single transform-buffer version increment for one moved text ([three-v1.test.mjs:1255-1259](../../packages/glyph/tests/integration/three-v1.test.mjs#L1255-L1259), [1315-1339](../../packages/glyph/tests/integration/three-v1.test.mjs#L1315-L1339)).
14. Glyph does not submit the Three render pass. The executor has attached retained `Mesh` draw proxies to the `Text` or `TextGroup` root. The application's `WebGPURenderer.render(scene, camera)` performs scene traversal, render-list construction, buffer/texture upload through Three, and GPU submission. This distinction is observable in tests: after `scene.updateMatrixWorld()`, meshes are children of the group and carry the Rust-produced instance count ([three-v1.test.mjs:728-759](../../packages/glyph/tests/integration/three-v1.test.mjs#L728-L759)).

### Disposal

15. `Text.dispose()` unbinds its batch, releases font/transform/domain leases, and leaves scene removal to the caller ([text.ts:485-492](../../packages/glyph/src/three/text.ts#L485-L492)). `TextGroup.dispose()` disposes only its batch, unbinding but not disposing descendant `Text` objects ([662-667](../../packages/glyph/src/three/text.ts#L662-L667), [three-v1.test.mjs:788-804](../../packages/glyph/tests/integration/three-v1.test.mjs#L788-L804)). Planner disposal cascades target disposal and all retained renderer state ([text.ts:927-957](../../packages/glyph/src/three/text.ts#L927-L957)).

## 2. Verified current lifecycle: R3F

### Font loading and ownership

1. `useFont()` uses R3F's Suspense `useLoader` cache with `ReactFontLoader`, which delegates each request to a fresh current Three `FontLoader` and therefore the same implicit Three domain association described above ([react.ts:267-285](../../packages/glyph/src/react.ts#L267-L285), [332-375](../../packages/glyph/src/react.ts#L332-L375)).
2. The cached loader owns one source `Font` lease. Every mounted hook consumer creates an independent clone through `createMountedFontStore()` and releases that clone when its final subscriber unmounts ([react.ts:413-439](../../packages/glyph/src/react.ts#L413-L439)). StrictMode and sibling-consumer tests verify balanced, independent leases ([react-lease-lifecycle.test.mjs:144-190](../../packages/glyph/tests/integration/react-lease-lifecycle.test.mjs#L144-L190), [193-213](../../packages/glyph/tests/integration/react-lease-lifecycle.test.mjs#L193-L213)).

### React render and commit

3. During React render, outer `<Text>` flattens strings, numbers, arrays, and nested `<Text>` elements into one string plus grapheme-aligned spans. Nested `<Text>` does not mount a Three object and may use only inline properties ([react.ts:138-155](../../packages/glyph/src/react.ts#L138-L155), [442-509](../../packages/glyph/src/react.ts#L442-L509)).
4. `TextObject` captures constructor arguments once with `useState`. R3F constructs the actual Three `Text` during host commit through the extended element. A small external store publishes the committed object back to the wrapper/ref ([react.ts:157-182](../../packages/glyph/src/react.ts#L157-L182), [196-201](../../packages/glyph/src/react.ts#L196-L201)).
5. In a layout effect, changed semantic props call `object.set()`, changed capacity calls `setCapacity()`, and the wrapper calls R3F `invalidate()` ([react.ts:184-194](../../packages/glyph/src/react.ts#L184-L194)). `TextGroup` follows the same construction pattern; its layout effect updates capacity/material and invalidates ([react.ts:219-265](../../packages/glyph/src/react.ts#L219-L265)).
6. `invalidate()` requests host work; it does not shape or render synchronously. The wrapper has no `useFrame`, no plan target, and no renderer call. This is the key separation between React commit and Glyph publication.

### R3F frame, traversal, and drawing

7. On the requested frame, the installed R3F scheduler calls the configured actual renderer with its scene and camera ([R3F index.mjs:14463-14488](../../packages/glyph/node_modules/@react-three/fiber/dist/index.mjs#L14463-L14488)). The installed Three renderer performs `scene.updateMatrixWorld()` before render-list construction when matrix auto-update is enabled ([Renderer.js:1598-1615](../../packages/glyph/node_modules/three/src/renderers/common/Renderer.js#L1598-L1615)). That traversal invokes the same imperative `Text`/`TextGroup` lifecycle above.
8. Therefore the current order is: React commits desired state -> layout effect calls `Text.set()`/`TextGroup` setters -> `invalidate()` schedules a frame -> R3F calls Three's renderer -> Three traverses matrices -> Glyph publishes or syncs transforms -> Three observes the retained draw meshes and submits them.
9. R3F owns unmount disposal of the committed Three objects. Repository tests verify that unmounting returns every paragraph/domain lease, including StrictMode replay, while a mounted `Text` can keep the domain alive after the user releases their font/loader handles ([react-lease-lifecycle.test.mjs:57-142](../../packages/glyph/tests/integration/react-lease-lifecycle.test.mjs#L57-L142)).

One subtle ordering fact matters for the redesign: `TextGroup.updateMatrixWorld()` calls `super` first, so child matrices are current before the group publishes and calls `syncTransforms(true)`. Moving publication into a React effect would lose that guarantee and would perform work for commits React may later discard.

## 3. Verified current lifecycle: example renderer

1. The application explicitly creates a `GlyphEngine`, passes it to `ExampleTextEngine`, and optionally supplies a renderer device. The example creates one backend, installs one policy, and owns one plan target ([example engine.ts:57-74](../../packages/glyph-example-renderer/src/engine.ts#L57-L74)).
2. `bindFont()`/`bindFontStack()` bind immutable root fonts to that backend and reject techniques unsupported by the selected shader ([example engine.ts:76-104](../../packages/glyph-example-renderer/src/engine.ts#L76-L104)).
3. `openPlanner()` creates the engine's single planner and attaches `ExamplePlanTarget`. `createText()` creates a retained engine text; `ExampleText.update()` changes desired state without publishing ([example engine.ts:106-129](../../packages/glyph-example-renderer/src/engine.ts#L106-L129), [164-203](../../packages/glyph-example-renderer/src/engine.ts#L164-L203)).
4. `publish()` synchronously publishes and throws if the target rejects; after acceptance it returns the target's last decoded draw list ([example engine.ts:131-135](../../packages/glyph-example-renderer/src/engine.ts#L131-L135)).
5. `readCandidate()` decodes all six operational tables plus diagnostics. Because the target requests borrowed delivery, it copies only write-patch payloads and table snapshots that escape acceptance; scalar decoded records are already owned JS values ([plan-reader.ts:16-87](../../packages/glyph-example-renderer/src/plan-reader.ts#L16-L87)).
6. Without a device, the target stores the decoded list and accepts it. With a device, it acquires missing portable payload leases, validates technique compatibility, stages and commits resources, stages and commits the whole submission, then publishes the new list/maps and releases payloads no longer referenced by the accepted resource generations ([example engine.ts:255-328](../../packages/glyph-example-renderer/src/engine.ts#L255-L328)).
7. A preparation or submission failure discards candidate state and releases newly acquired leases; the target returns a rejection rather than corrupting its previous accepted state ([example engine.ts:292-313](../../packages/glyph-example-renderer/src/engine.ts#L292-L313), [329-332](../../packages/glyph-example-renderer/src/engine.ts#L329-L332)).
8. `ExampleTextEngine.dispose()` disposes its backend; backend/planner ownership cascades target and payload disposal ([example engine.ts:145-151](../../packages/glyph-example-renderer/src/engine.ts#L145-L151), [335-353](../../packages/glyph-example-renderer/src/engine.ts#L335-L353)).

The example renderer proves that the canonical plan is not Three-specific. It also exposes the current duplication the new default decoder should remove: both the example and Three independently iterate and validate plan tables, but their host realization and commit logic appropriately differ.

## 4. Audited current-versus-implemented ownership mapping

| Concern                             | Audited pre-change owner                                                                                                        | Implemented owner                                                   | Contract consequence                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wasm initialization                 | Each explicit `GlyphEngine`; implicit Three domain creates one lazily                                                           | Root `Glyph`, exposed as the one `glyph` instance                   | `await glyph.init()` is idempotent and concurrency-safe; no renderer config initializes another runtime.                                                                                                                |
| Renderer integration identity       | `GlyphBackend.integration` plus an implicit Three coordinator                                                                   | Named handle from `glyph.handle(name, config)`                      | Handle names are diagnostics/registry identity, not renderer type, device, scene, canvas, or wire ID.                                                                                                                   |
| Adapter configuration               | Three coordinator constructor, current policy registry, executor code; example engine/device constructor                        | `GlyphConfig`, with `/three` exporting `ThreeConfig`                | Config owns Codec selection through `encode`, decoder selection through `decode`, resolve factories, and renderer construction; spreading/wrapping creates an independent handle configuration.                         |
| Renderer/scene/canvas context       | Implicit Three domain does not retain the host renderer; R3F wrapper reads only `invalidate`; example device is passed directly | Not part of built-in `ThreeConfig`                                  | Three resource objects late-bind when a host renderer encounters them. A raw GPU adapter may close over a device in its config factory; the canvas remains host presentation state.                                     |
| Immutable fonts                     | Root `Font` values; current Three additionally maps each variant to one implicit domain                                         | Root `Font` values unchanged                                        | A handle binds a font through counted internal leases. The font is not loaded “into” or owned by a handle. Multiple handles must be able to bind the same immutable font.                                               |
| Desired text/style/layout state     | Public Three `Text`; example `ExampleText` plus engine `RetainedText`                                                           | `Text`                                                              | Mutations only replace desired state and mark the owning publication boundary dirty.                                                                                                                                    |
| Scene hierarchy and batching hint   | `Text`/`TextGroup` Object3D hierarchy                                                                                           | `Text`/`TextGroup`                                                  | `TextGroup` remains a hierarchy boundary and publication/batching boundary; it is not the Glyph runtime.                                                                                                                |
| Planner/publication stream          | `ThreeTextBatchBinding` or example engine's one planner                                                                         | Private handle-owned publication boundary                           | Each standalone `Text` and `TextGroup` boundary is independently schedulable; it is not a public runtime object.                                                                                                        |
| Encode/Codec                        | Coordinator `PolicyDescriptor` or example policy under the current implementation names                                         | `GlyphConfig.encode` and engine Codec compiler                      | The public type is `Codec`: encode converts semantic authoring state into canonical engine input. It cannot return renderer commands or host objects.                                                                   |
| Canonical typed plan                | Rust/Wasm plan plus `RenderPlanReader` and record readers                                                                       | Glyph engine                                                        | One versioned `TypedCommandBuffer`; configs do not invent alternate plan dialects.                                                                                                                                      |
| Decode and binding                  | Reimplemented in Three executor and example `readCandidate`/device                                                              | `GlyphConfig.decode`, normally `defaultDecoder`, plus handle binder | Produces the one closed `BoundCommandBuffer`, resolving internal IDs to stable object bindings before renderer consumption. An override is type-constrained to the same input/output contract. No per-command functors. |
| Portable payload acquisition        | `PlanCandidate.acquirePayload()`                                                                                                | Handle/boundary binder                                              | Borrowed plan access ends during `shape()`; retained payload/resource leases survive according to generation and retirement.                                                                                            |
| Host resource creation              | Three executor texture/page methods; example `prepareResources()`                                                               | `GlyphConfig.resolve`                                               | Synchronous factory returns a disposable lease. The handle/boundary stages it, commits only with the renderer transaction, and disposes it on rejection/retirement.                                                     |
| Host buffers/materials/draw objects | `ThreeTextRenderPlanExecutor`; example device                                                                                   | Config renderer                                                     | Renderer maps bound buffer/program/material/primitive objects to retained host objects and applies patches.                                                                                                             |
| Transform synchronization           | Three executor side path                                                                                                        | Private boundary + Three renderer transform store                   | `shape()` may finish with transform sync, but transform-only host frames do not encode, publish, or decode.                                                                                                             |
| Renderer transaction                | Executor `prepare/commit/discard`; example `prepareSubmission`                                                                  | Config renderer, coordinated by private boundary                    | Renderer must stage a complete candidate and expose commit/discard; the last committed result remains live on failure.                                                                                                  |
| Actual host draw submission         | Three `WebGPURenderer`; example device backend                                                                                  | Host renderer/device                                                | Glyph's `renderer` prepares/commits retained host state; Three/R3F or another host still submits the actual render pass.                                                                                                |
| React selection                     | Implicit font-derived Three domain                                                                                              | React context carrying one handle                                   | Context performs construction-time dependency injection only and owns no engine, registry, renderer, scene, canvas, or publication state.                                                                               |

## 5. End-to-end sequence

```mermaid
sequenceDiagram
  autonumber
  participant React as React/R3F
  participant Text as Text / TextGroup
  participant Host as R3F scheduler + Three scene
  participant Handle as selected handle
  participant Boundary as private Text/TextGroup boundary
  participant Engine as Glyph engine
  participant Binder as config.decode + handle binder
  participant Config as GlyphConfig resolve/factories
  participant GR as GlyphConfig renderer
  participant Three as THREE.WebGPURenderer

  React->>Handle: read selected handle from context
  Handle->>Text: create retained Three object with opaque binding
  Boundary->>Config: renderer({ drawRoot, signal })
  Config-->>GR: construct retained config renderer
  React->>Text: commit retained object and desired props
  React->>Host: invalidate()
  Note over React,Text: No shape or decode during React render
  Host->>Three: render(scene, camera)
  Three->>Text: updateMatrixWorld() scene traversal
  Text->>Boundary: reconcile desired state and hierarchy
  alt semantic boundary is dirty
    Boundary->>Engine: shape/publish encoded semantic state
    Engine-->>Boundary: borrowed canonical TypedCommandBuffer
    Boundary->>Binder: config.decode(source, binding context)
    Binder->>Binder: validate closed phases and replace IDs with bindings
    Binder->>Config: resolve({ payload, previous, signal })
    Config-->>Binder: staged ResourceLease values
    Binder-->>GR: prepare(BoundCommandBuffer)
    GR-->>Boundary: PreparedRendererCommit
    Boundary->>GR: commit()
    Boundary->>Boundary: retain new leases; retire old leases
  else only matrices/visibility/render order changed
    Boundary->>GR: syncTransforms(bound transform updates)
  end
  GR-->>Text: retained host meshes/buffers/materials are current
  Three->>Three: build render list; late-bind/upload resources; submit host rendering
```

For imperative Three, application code calls the host renderer directly. For R3F, `invalidate()` causes the scheduler to call it. In both paths, `shape()` belongs at the traversal/publication boundary after desired state has committed and matrices are current, not in React render or a per-`Text` effect.

## 6. `decode(TypedCommandBuffer) => WHAT?`

### Concrete answer

The exact candidate is:

```ts
type Decoder<Bindings extends AnyGlyphBindings> = (
  source: BorrowedTypedCommandBuffer,
  context: DecodeContext<Bindings>,
) => BorrowedBoundCommandBuffer<Bindings>;

declare const defaultDecoder: <Bindings extends AnyGlyphBindings>(
  source: BorrowedTypedCommandBuffer,
  context: DecodeContext<Bindings>,
) => BorrowedBoundCommandBuffer<Bindings>;
```

The engine package owns `defaultDecoder`, the canonical source ABI, the closed output unions, validation helpers, and borrowed-view enforcement. `GlyphConfig` owns decoder selection through a required `decode: Decoder<Bindings>` field. `ThreeConfig`, the example config, and other built-ins should all assign `decode: defaultDecoder`; the handle invokes `config.decode` rather than reaching around the config to an internal decoder.

An advanced config may replace or wrap that function. Type safety requires the exact `BorrowedTypedCommandBuffer` input, the config's exact `DecodeContext<Bindings>`, and `BorrowedBoundCommandBuffer<Bindings>` output. The override remains synchronous, must obey the same borrowed lifetime, must return the same phase vocabulary, and must throw at the call site for invalid input. It cannot introduce a second command-buffer dialect or expose raw numeric IDs to its renderer. `defineDecoder<Bindings>()` preserves inference; stronger development-time lifetime guards remain an explicit risk/experiment below rather than an unimplemented claim.

The renderer-facing candidate types are:

```ts
interface GlyphBindings<
  Resource extends object,
  Buffer extends object,
  Program extends object,
  Material extends object,
  Transform extends object,
  Primitive extends object,
  Draw extends object,
> {
  readonly resource: Resource;
  readonly buffer: Buffer;
  readonly program: Program;
  readonly material: Material;
  readonly transform: Transform;
  readonly primitive: Primitive;
  readonly draw: Draw;
}

type AnyGlyphBindings = GlyphBindings<object, object, object, object, object, object, object>;

interface ResourceLease<Value> {
  readonly value: Value;
  dispose(): void;
}

interface ResolveContext<PortableResource, Previous> {
  readonly technique: string;
  readonly resourceKind: string;
  readonly resourceName: string;
  readonly payload: PortableResource;
  readonly previous: Previous | undefined;
  readonly signal: AbortSignal;
}

type BoundResourceCommand<Resource> =
  | Readonly<{ kind: 'acquire'; resource: Resource }>
  | Readonly<{ kind: 'update'; resource: Resource }>
  | Readonly<{ kind: 'retain'; resource: Resource }>;

type BoundBufferCommand<Buffer, Program> = Readonly<{
  kind: 'ensure';
  buffer: Buffer;
  program: Program;
  scalarType: 'f32' | 'u32' | 'u16';
  vectorWidth: number;
  capacityRecords: number;
  byteLength: number;
}>;

type BoundPatchCommand<Buffer> =
  | Readonly<{ kind: 'write'; buffer: Buffer; destinationOffset: number; payload: Uint8Array }>
  | Readonly<{ kind: 'fill'; buffer: Buffer; destinationOffset: number; byteLength: number; value: number }>
  | Readonly<{
      kind: 'copy';
      source: Buffer;
      sourceOffset: number;
      destination: Buffer;
      destinationOffset: number;
      byteLength: number;
    }>;

interface BoundPrimitiveCommand<Resource, Buffer, Program, Primitive> {
  readonly primitive: Primitive;
  readonly kind: 'glyph' | 'decoration' | 'inline-object' | 'clip' | 'codec';
  readonly program: Program;
  readonly resource: Resource | undefined;
  readonly buffers: readonly Buffer[];
  readonly recordIndex: number;
  readonly recordCount: number;
  readonly logicalOrder: number;
}

interface BoundDrawCommand<Buffer, Program, Material, Transform, Primitive, Draw> {
  readonly draw: Draw;
  readonly program: Program;
  readonly material: Material | undefined;
  readonly transform: Transform;
  readonly buffers: readonly Buffer[];
  readonly primitives: readonly Primitive[];
  readonly depthKey: number;
}

type BoundDrawPhase<DrawCommand> =
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'replace'; values: readonly DrawCommand[] }>;

type BoundRetirementCommand<Resource, Buffer> =
  | Readonly<{ kind: 'resource'; resource: Resource }>
  | Readonly<{ kind: 'buffer'; buffer: Buffer }>;

interface BorrowedBoundCommandBuffer<Bindings extends AnyGlyphBindings> {
  readonly delivery: 'borrowed-bound';
  readonly checkpoint: boolean;
  readonly resources: readonly BoundResourceCommand<Bindings['resource']>[];
  readonly buffers: readonly BoundBufferCommand<Bindings['buffer'], Bindings['program']>[];
  readonly patches: readonly BoundPatchCommand<Bindings['buffer']>[];
  readonly primitives: readonly BoundPrimitiveCommand<
    Bindings['resource'],
    Bindings['buffer'],
    Bindings['program'],
    Bindings['primitive']
  >[];
  readonly draws: BoundDrawPhase<
    BoundDrawCommand<
      Bindings['buffer'],
      Bindings['program'],
      Bindings['material'],
      Bindings['transform'],
      Bindings['primitive'],
      Bindings['draw']
    >
  >;
  readonly retirements: readonly BoundRetirementCommand<Bindings['resource'], Bindings['buffer']>[];
}

interface PreparedRendererCommit<Result> {
  readonly result: Result;
  commit(): void;
  discard(): void;
}

interface BoundTransformUpdate<Transform> {
  readonly transform: Transform;
}

interface Renderer<Bindings extends AnyGlyphBindings, Result> {
  prepare(frame: BorrowedBoundCommandBuffer<Bindings>): PreparedRendererCommit<Result>;
  syncTransforms(updates: readonly BoundTransformUpdate<Bindings['transform']>[]): void;
  dispose(): void;
}

interface RendererContext<Bindings extends AnyGlyphBindings> {
  readonly drawRoot: Bindings['transform'];
  readonly signal: AbortSignal;
}
```

The binding types are opaque object identities created by the engine/handle binder. They may wrap host values, but ordinary renderer code never receives or looks up `RenderPlanResourceId`, `RenderPlanBufferId`, `RenderPlanPrimitiveId`, `RenderPlanDrawId`, material handles, or transform indices. This differs intentionally from the decoded record types, whose IDs remain correct for low-level `/core` integrators but are below the implemented config renderer boundary.

`resolve` has this role:

```ts
interface GlyphConfig<PortableResource, Bindings extends AnyGlyphBindings, RendererResult> {
  readonly capabilities: CapabilitySet;
  encode(context: EncodeContext): Codec;
  decode: Decoder<Bindings>;
  resolve(context: ResolveContext<PortableResource, Bindings['resource']>): ResourceLease<Bindings['resource']>;
  renderer(context: RendererContext<Bindings>): Renderer<Bindings, RendererResult>;
}
```

`Codec` is the implemented public encode-side contract formerly described conceptually as a policy. Existing low-level
symbols remain `BackendPolicy`, `PolicyDescriptor`, `PolicyCapabilitySet`, and `threeRenderPolicyDescriptor`, and the wire
reader still has policy-named primitive/buffer tags. `Codec` intentionally wraps that descriptor rather than churning the
validated ABI; `defaultDecoder` normalizes the internal policy primitive tag to the renderer-facing `codec` vocabulary.

The boundary binder calls `resolve` only for an acquired or changed portable resource identity. It stages the returned
lease, inserts its `value` into the bound resource phase, and disposes the lease if decode, renderer preparation, or
commit fails. After a successful commit, boundary-owned resource bookkeeping retains the lease until a committed
retirement, boundary disposal, or final handle-domain teardown. The current plan's `slot-range` and `output-bytes`
retirements remain binder bookkeeping; they do not become invented renderer resource kinds. `resolve` is synchronous:
asynchronous font/resource acquisition must finish before `shape()`, matching the rule that an engine call answers or
throws where it was written.

### Lifetime rules

| Value                                                                    | Validity                                                                      | Retention rule                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Borrowed `TypedCommandBuffer`                                            | Only during the synchronous `decode`/target callback                          | No field or byte view may escape. Current borrowed readers deliberately throw after acceptance ([render-planner.ts:720-736](../../packages/glyph/src/core/render-planner.ts#L720-L736), [1371-1419](../../packages/glyph/src/core/render-planner.ts#L1371-L1419)). |
| `BorrowedBoundCommandBuffer` and phase arrays                            | From decode through `renderer.prepare()` and its synchronous preparation only | Renderer must not store the frame or arrays. The private publication boundary expires them when `shape()` settles.                                                                                                                                                 |
| Write-patch `Uint8Array`                                                 | Same lifetime as the bound frame                                              | Renderer must upload or copy it during preparation. The current example copies escaping writes, proving the need ([plan-reader.ts:44-50](../../packages/glyph-example-renderer/src/plan-reader.ts#L44-L50)).                                                       |
| Opaque resource/buffer/program/material/transform/primitive/draw binding | Stable object identity for its live generation                                | Renderer may key retained maps by the object. It must not manufacture or numerically decode one.                                                                                                                                                                   |
| Newly resolved `ResourceLease`                                           | Candidate-local until renderer commit                                         | The boundary calls `dispose()` on discard; successful commit promotes it to live retained state.                                                                                                                                                                   |
| Committed `ResourceLease`                                                | Until an accepted retirement, boundary disposal, or handle-domain teardown    | The boundary binder owns disposal. Renderer consumes `value` but does not independently release the lease.                                                                                                                                                         |
| Prepared renderer transaction                                            | One `shape()` attempt                                                         | Exactly one of `commit()` or `discard()` is called. Both must be idempotent after settling.                                                                                                                                                                        |
| Renderer result                                                          | Config-defined preparation value                                              | Current `shape()` does not surface it. A future adapter return must be stable and self-owned, never plan bytes or cleanup closures.                                                                                                                                |
| Async/worker plan                                                        | Explicit owned-delivery path only                                             | The engine makes one contiguous owned copy. Bound fields that cross a realm must be self-owned/validated; borrowed bindings and realm-local provenance do not transfer ([render-planner.ts:739-789](../../packages/glyph/src/core/render-planner.ts#L739-L789)).   |

The phases are ordered by contract: resources -> buffers -> patches -> primitives -> draws -> retirements. The draw phase must distinguish `unchanged` from `replace` because an empty replacement means “retire all draws,” while a patch-only publication means “leave committed draw topology alone.” Within one `replace`, every draw binding is unique; repetition is a decoder error. A fixed interpreter over closed discriminated unions is the intended implementation. Per-command functors would obscure phase order, allocate on the hot path, and make lifetime/rollback behavior impossible to audit.

## 7. R3F injection without a second runtime

Ordinary R3F carries no adapter configuration at each object:

```tsx
<Text font={font}>Default Three text</Text>
<TextGroup>
  <Text font={font}>One group publication boundary</Text>
</TextGroup>
```

When a subtree needs a custom handle, the implemented React boundary carries exactly one already-created Three handle:

```tsx
<GlyphProvider handle={threeHandle}>
  <Text font={font}>Handle-bound text</Text>
  <TextGroup>
    <Text font={font}>One group publication boundary</Text>
  </TextGroup>
</GlyphProvider>
```

The wrapper reads context with React `use(Context)`. When the result is absent, it conditionally `use()`s one module-owned
promise that calls idempotent `glyph.init()` and creates the built-in `ThreeConfig` handle once. The provider captures its
initial handle and rejects a later handle prop change, so its context value is immutable for that mount. It does not call
`useThree()` to capture a renderer, scene, root store, or canvas. R3F already owns those presentation concerns. The only
R3F host value Glyph still needs is the existing `invalidate()` callback after desired properties change; that is
scheduling coordination performed by the wrapper, not part of `GlyphConfig`, the handle, or resource resolution.

### The concrete R3F construction seam

The current wrapper already shows exactly where the handle enters. `extend(ThreeText)` creates an R3F host element, and its `args` prop tells the R3F reconciler which arguments to pass when it constructs `ThreeText` during commit ([react.ts:126-127](../../packages/glyph/src/react.ts#L126-L127), [168-170](../../packages/glyph/src/react.ts#L168-L170), [196-201](../../packages/glyph/src/react.ts#L196-L201)). The redesign does not need R3F to understand Glyph. It changes the package-private construction arguments from conceptually:

```ts
[desiredProperties];
```

to the actual retained constructor arguments:

```ts
[desiredProperties, opaqueHandleDomain];
```

The React `<Text>` wrapper reads `opaqueHandleTextBinding` from context before it creates the R3F element. R3F then constructs the Three object at its normal host-commit point. Imperative code uses `handle.createText(properties)` with the same internal factory/binding. The opaque binding is not a numeric ID and is not exposed for ordinary application construction.

This seam still requires an approved constructor policy. The clean API makes `handle.createText()` the imperative application constructor and keeps the handle-bearing `Text` constructor package-private. If backward compatibility requires `new Text(properties)`, its runtime selection must be specified explicitly; silently reaching for a process-global default handle would reintroduce ambiguity.

The handle is captured for the retained object's lifetime. A mounted provider cannot change its selection. To switch,
the application remounts the provider (normally with a new React `key`), which disposes the old subtree and
commit-constructs new objects with the new binding. The wrapper's internal key also includes handle identity so changing
between a provider and the default cannot migrate a live Three object's handle owner.

### The concrete synchronization seam

React context solves construction, not frame timing. The safest first synchronization design preserves the current Three ordering while moving all shaping ownership behind a private boundary:

```ts
TextGroup.updateMatrixWorld():
  super.updateMatrixWorld() // descendants now have current world matrices
  boundary.reconcile(descendantDesiredState)
  boundary.semanticDirty ? boundary.shape() : boundary.syncTransforms()

standalone Text.updateMatrixWorld():
  super.updateMatrixWorld()
  privateBoundary.reconcile(textDesiredState)
  privateBoundary.semanticDirty ? privateBoundary.shape() : privateBoundary.syncTransforms()
```

`Text` and `TextGroup` are triggers and hierarchy owners in that sketch; they do not contain the encoder, planner, decoder, resource stores, or renderer transaction. `shape()` is private boundary work coordinated through the handle. The calls are safe because the current overrides run after `super`, and the group override runs after recursive descendant traversal ([text.ts:461-483](../../packages/glyph/src/three/text.ts#L461-L483), [639-660](../../packages/glyph/src/three/text.ts#L639-L660)).

An R3F `useFrame` callback is not an equivalent first choice: the installed R3F registers ordinary `useFrame` jobs separately from its system render job ([R3F index.mjs:1131-1187](../../packages/glyph/node_modules/@react-three/fiber/dist/index.mjs#L1131-L1187), [14463-14488](../../packages/glyph/node_modules/@react-three/fiber/dist/index.mjs#L14463-L14488)), while Three performs the ordinary scene matrix update inside `render()` ([Renderer.js:1598-1615](../../packages/glyph/node_modules/three/src/renderers/common/Renderer.js#L1598-L1615)). A generic pre-render hook therefore sees matrices before Three's normal traversal unless it duplicates or takes over that work. `Object3D.onBeforeRender` is also unsuitable as the primary boundary because it is per drawable, does not run for an empty `TextGroup`, and occurs after draw realization needs to be ready. A renderer wrapper could create a stronger explicit phase—update matrices, shape dirty boundaries, then render with duplicate traversal suppressed—but that is more invasive and should be justified by an experiment rather than assumed necessary.

The first implementation should therefore keep one shape decision per current publication boundary: once after a `TextGroup` traversal, or once for a standalone text's private boundary. It should not attempt to coalesce every handle-owned text across a scene until a host-level boundary can prove all relevant matrices are current and preserve scene/order semantics.

The contract should be:

1. `glyph` owns initialization and the named handle registry. The no-provider path calls idempotent `glyph.init()` and
   creates one internal default `ThreeConfig` handle. `GlyphProvider` itself never registers a handle, clones config,
   creates a renderer, or owns global disposal.
2. `Text` and `TextGroup` expose no handle prop. The nearest provider supplies an already-created handle; absent a
   provider, both use the shared default handle. No renderer, scene, canvas, or GPU context is captured by either path.
3. `Text` reads the handle before its R3F constructor arguments are captured. The handle creates the retained Three
   `Text` and gives it a direct opaque binding. Context never supplies a numeric ID.
4. A provider captures its initial handle and rejects a changed handle prop. Selecting another handle requires a provider
   remount, which reconstructs `Text` and `TextGroup`; it never rebinds a live object. The wrapper's internal key includes
   opaque handle identity as a second guard.
5. Nested inline `<Text>` is still flattened before host construction, so it inherits the outer paragraph's selected handle and creates no separate renderer object.
6. `TextGroup` does not create a Glyph runtime or handle. It creates/owns a private publication boundary for descendants selected from the same handle. A nested `TextGroup` remains a terminal boundary, matching current traversal.
7. React render and layout effects only publish desired state and invalidate R3F. Three scene traversal calls boundary `shape()` or `syncTransforms()` after matrices are current.
8. Provider unmount does not dispose an externally supplied handle. Retained Three objects and the handle's normal
   disposal rules own their leases; context owns only the immutable reference. The internal default handle has module
   lifetime and is not exposed for application disposal.

This is not a second runtime because context contains no mutable runtime state. It is equivalent to dependency injection of one object reference at construction time.

## 8. Decomposing `ThreeTextRenderPlanExecutor`

The audited class mixed six lifecycle domains. This implementation landed the first three concrete extractions:
`ThreeCommandBufferBinder` owns decode-time stable binding/resource leases, renderer-neutral `applyGlyphPublication()`
owns decode → prepare → commit/discard settlement, and `ThreeTransformSynchronizer` owns the engine-free matrix/visibility
side path. The executor still declares 26 retained/coordinator fields because the physical resource, buffer, material,
draw, and inspection stores have not yet been mechanically split. The following target decomposition remains internal; it
does not add public concepts or rename the requested API vocabulary.

| Internal component                   | Current state moved into it                                                                                                                             | Current methods/functions moved into it                                                                                                                                                                   | Resulting invariant                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PlanDecoder`                        | No retained Three objects; reusable table/command scratch only                                                                                          | Table selection in `#prepare`; pure record reading/validation portions of `#readResources`, `#readBuffers`, `#stageBufferMutations`, `#prepareDraws`, and `#applyRetirementsToCandidate`                  | Converts the canonical reader into one closed phase model. It never creates a mesh, texture, material, or lease.                                                                         |
| `ResourceStore`                      | `#resources`, `#bitmapTextures`, `#msdfAtlases`, `#slugPages`                                                                                           | Payload acquisition currently in `#readResources`; `#bitmapTexture`, `#msdfAtlas`, `#slugPage`, `#retiredTextures`, resource half of `#applyRetirementsToCandidate`; resource disposal                    | Owns portable payload leases and shared Three GPU-resource leases by authenticated identity/generation. Candidate additions can be discarded independently.                              |
| `BufferStore`                        | `#buffers`                                                                                                                                              | `#readBuffers`, `#stageBufferMutations`, `#buffer`; free helpers `retainedBuffer`, `commitBufferMutations`, `commitBufferOperation`, `commitBufferUpload`                                                 | Owns one storage attribute per bound buffer generation and applies ordered, bounds-checked dirty ranges atomically.                                                                      |
| `MaterialStore`                      | `#materials`, `#ownedMaterials`                                                                                                                         | `#bitmapMaterial`, `#msdfMaterial`, `#slugMaterial`, `#decorationMaterial`, `#planProgramMaterial`, `#material`, `#createMaterial`, `#materialDefinition`, `#ownMaterial`, `#retainMaterial`              | Owns fresh NodeMaterial instances and keys them only by already-bound resource/buffer/program/transform state. Technique-specific factories can be small collaborators under this store. |
| `TransformStore`                     | `#activeTransformIndices`, `#directDrawsByTransform`, `#transforms`, `#transformAttribute`, `#transformGeneration`; matrix scratch is already extracted | `ThreeTransformSynchronizer.sync()` is implemented; realization/capacity/commit methods remain in the executor                                                                                            | Direct opaque `Object3D` synchronization is already engine-free. A later store extraction can own indexed realization without changing that side path.                                   |
| `DrawStore`                          | `#draws`, `#drawKeys`, `#originSegments`, `#originRecords`                                                                                              | Draw/geometry half of `#prepareDraws`, `#ensureOriginRecords`, `#prepareOwnerGlyphStorage`, `#glyphStorage`, `#glyphPosition`, `#disposeDraws`, glyph inspection helpers and geometry realization helpers | Owns retained meshes, geometry, draw reuse, physical record addressing, and inspection augmentation. It receives already-bound resources, buffers, materials, and transforms.            |
| `RendererCommit`                     | `#preparation` becomes one local transaction object                                                                                                     | `#prepare`, `#commit`, `#discardPreparation`, plus retirement ordering                                                                                                                                    | Prepares all stores against snapshots; commit swaps them in one direction; discard releases only candidate-owned state. No store publishes early.                                        |
| `ThreeTextRenderPlanExecutor` facade | `#coordinator`, `#owner`, `#disposed`, references to the stores                                                                                         | `accept`, `dispose`, `gpuBytes`, `draws`, `materials`, inspection delegation, `syncTransforms` delegation                                                                                                 | Remains the `PlanTarget`/future renderer adapter. It coordinates components but no longer implements their storage details.                                                              |

The decomposition follows actual seams already present in `PreparationContext` and `PreparedPublication`. The reusable
publication transaction and command binder now make rejection and lease ownership visible without changing physical
Three output. The transform synchronizer protects the no-Wasm fast path. `ResourceStore`, `BufferStore`, `MaterialStore`,
and `DrawStore` are intentionally not claimed complete: the current built-in renderer still bridges from its private
candidate association into the proven realization code. Those are mechanical, test-backed follow-ups rather than reasons
to leak numeric IDs or per-command functors into `GlyphConfig`.

## 9. Handle and boundary decision matrix

The implemented rule is that a **handle owns configuration, shared adapter bookkeeping, resource leases, and factories; every standalone `Text` and `TextGroup` owns a private publication boundary; Three owns scenes, renderers, canvases, and renderer-local GPU realization**. No public session object is needed.

| Scenario                                               | Implemented rule                                                                                                                                                        | Why                                                                                                                        | Required guard                                                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imperative `handle.createText()`                       | Construct one Three `Text` with an opaque handle binding and a private standalone publication boundary.                                                                 | No renderer, scene, or canvas is needed to construct it or resolve Three objects.                                          | The handle-bearing constructor remains package-private; the public factory rejects disposed handles.                                                                 |
| R3F default                                            | With no provider, `<Text>` and `<TextGroup>` share one lazily initialized built-in `ThreeConfig` handle.                                                                | Ordinary R3F is already renderer-specific and needs no repeated adapter configuration.                                     | Initialization is one retryable Suspense promise; the internal handle has module lifetime and is not exposed.                                                        |
| R3F provider                                           | Context supplies one immutable custom handle directly to outer `<Text>` and `<TextGroup>` construction.                                                                 | React needs dependency injection only because JSX does not call `handle.createText()` directly.                            | Components expose no handle prop; a changed provider prop throws; keyed remount selects another handle; unmount does not dispose the externally owned handle.        |
| `TextGroup`                                            | Own one private publication boundary; descendant `Text` objects from the same handle share one planner/decode/renderer transaction.                                     | Matches current one-group/one-publication behavior and batching evidence.                                                  | Nested groups terminate collection and own separate boundaries; no descendant is published twice.                                                                    |
| Standalone `Text`                                      | Own a private boundary until it joins a `TextGroup`.                                                                                                                    | Current standalone text has its own draw root and planner.                                                                 | Do not globally coalesce standalone texts without proving traversal and failure isolation.                                                                           |
| Multiple `TextGroup`s on one handle                    | Keep separate publication streams while sharing only documented handle-owned resource/config caches.                                                                    | Current groups have independent planners/draw roots, while coordinator resources can be shared above them.                 | Dirty state, acceptance cursor, errors, and retries remain per boundary.                                                                                             |
| One handle used by multiple Three scenes               | Allowed without binding either scene to the handle. Each scene contains distinct retained `Text`/`TextGroup` objects and boundaries.                                    | A Three object has one parent, while the same adapter configuration and immutable font data can serve many objects/scenes. | Rendering one scene must not mark another boundary accepted; resolved Three-object sharing across independent renderers remains experimental.                        |
| Multiple cameras rendering one scene in one host frame | Semantic state is camera-independent; each traversal synchronizes the encountered boundary, with a no-op when revisions/matrices are unchanged.                         | Current synchronization is revision driven, not camera driven.                                                             | Test repeated traversals to prove no duplicate shape and define behavior if the application mutates matrices between cameras.                                        |
| Multiple handles in one scene                          | Allowed in separate `Text`/`TextGroup` branches. Each retained object is constructed by exactly one handle.                                                             | Handles may select different configs, programs, decoders, and resource pools.                                              | One `TextGroup` cannot mix handles; current code similarly rejects different coordinators ([text.ts:1295-1304](../../packages/glyph/src/three/text.ts#L1295-L1304)). |
| Nested providers selecting different handles           | Allowed only at an outer retained `Text` or `TextGroup` construction boundary.                                                                                          | Context naturally scopes construction.                                                                                     | A nested inline `<Text>` is semantic content flattened into its outer paragraph and cannot select a different handle independently.                                  |
| Reparent within one handle                             | Preserve `Text` identity and move transactionally between its private boundary and a group boundary.                                                                    | Matches current group/standalone rebinding.                                                                                | Destination publication must commit before source retirement becomes visible.                                                                                        |
| Reparent across handles                                | Require reconstruction or an explicit future migration operation; ordinary grouping must reject mixed ownership.                                                        | Transform, font bindings, resource stores, and planner bindings are handle-local.                                          | Do not silently mutate a live object's handle identity or expose numeric migration IDs.                                                                              |
| Raw WebGPU adapter                                     | Capture a caller-owned initialized `GPUDevice` in the adapter config/handle closure; keep `GPUCanvasContext` in the host rendering layer unless resolve truly needs it. | `device.createBuffer/Texture/Sampler/Pipeline` needs a device, not a scene or canvas.                                      | Device loss and disposal are adapter concerns; do not add renderer/scene/canvas parameters to `ThreeConfig` to accommodate this different adapter.                   |

## 10. Remaining questions, risks, and smallest decisive experiments

The implemented tests settle initialization, live-name reuse, two Three handles over one immutable font, standalone and
group boundary ownership, multiple scenes, default-handle behavior, spread config wrapping, transform-only bypass, and
example-renderer portability. These narrower questions remain:

| Question or risk                  | Why still material                                                                                                                        | Smallest experiment or test                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failed root initialization policy | Success is idempotent and concurrent-safe; retry after a failed Wasm load is implemented but not yet isolated in a root-runtime test.     | Inject one rejected `createGlyphEngine`, retry with valid bytes, and assert exactly one live engine and no leaked backend.                                                         |
| R3F multiple-render timing        | Traversal suppresses duplicate semantic work, but two cameras/render passes in one R3F frame have not been instrumented directly.         | Commit two prop updates, invalidate once, render two cameras, and assert one semantic prepare plus cheap synchronization on the second traversal.                                  |
| Provider handle replacement       | A mounted provider now rejects a changed handle prop; keyed remount settlement under StrictMode still needs a dedicated test.             | Remount keyed provider A as keyed provider B under StrictMode and assert one old-object disposal, distinct new object identity, retained desired props, and no cross-handle group. |
| Two real Three renderer backends  | `resolve` deliberately creates renderer-agnostic Three objects; actual WebGPU/WebGL renderer-local realization is late-bound by Three.    | Render separate objects from one handle through two real renderers and observe texture/buffer creation and final disposal without adding canvas identity to resolve.               |
| Resolver cache identity           | The current built-in resolver returns fresh binding leases; safe sharing across boundaries must use authenticated payload/config keys.    | Resolve one payload in two boundaries and handles, add a counted cache experimentally, and prove exact sharing plus final release under rejection and retirement.                  |
| Async-only GPU resource creation  | Borrowed decode/prepare is synchronous; a future adapter may require asynchronous device initialization or uploads.                       | Build a raw WebGPU adapter that captures an initialized device. If resource creation cannot remain synchronous, add explicit handle prefetch/init rather than async decode.        |
| Custom decoder runtime guards     | Types prevent the wrong binding vocabulary but cannot expire a retained frame or prove that an override called the canonical binder.      | Retain a frame past acceptance, return a foreign frame, and throw after resolve; add development guards only where the negative tests demonstrate a real gap.                      |
| Phase-by-phase rollback           | Current transaction tests cover renderer rejection, but not an injected failure after every individual resolve/buffer/material/draw step. | Parameterize failure injection across every phase and assert previous meshes and leases survive while every candidate-only lease disposes exactly once.                            |
| GPU completion fences             | CPU commit does not prove prior GPU reads have completed for every adapter.                                                               | Add an explicit recording fence and verify retired resource leases remain live until the renderer's completion token is safe.                                                      |
| `shape()` return value            | Three correctly returns `void`; another adapter may want immutable publication telemetry.                                                 | Type a config-specific `ShapeResult` in the example adapter before adding any root/general return type.                                                                            |
| Program-registry isolation        | Current Three program snapshots are coordinator-local but registration remains package-global before a coordinator reads it.              | Create two handles around intentionally distinct extension snapshots and assert no cross-handle program/material selection.                                                        |

## 11. Illustrative `ThreeConfig` code and helper seams

This section preserves the concrete design sketches used to evaluate helper seams. `defineGlyphConfig`, `defineDecoder`,
the bound phase types, and renderer `prepare()` now exist; narrower store helpers such as `createThreeRenderer` remain
illustrative decomposition targets rather than public exports. The Three primitives are real APIs from the installed
`three` 0.185.1 package and mirror executor usage: `DataArrayTexture`, `DataTexture`,
`StorageInstancedBufferAttribute`, `InstancedBufferGeometry`, `BufferAttribute`, `MeshBasicNodeMaterial`, `Mesh`,
`Object3D`, and `Matrix4`.

### Intended application use

The ordinary Three user should not implement any of the machinery below:

```ts
import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';

await glyph.init();

const three = glyph.handle('main-three', ThreeConfig);
const text = three.createText({ font, text: 'Hello Glyph' });

scene.add(text);
renderer.render(scene, camera); // traversal shapes or synchronizes as needed
```

`three.createText()` is host-neutral. It creates a retained Three object and private publication boundary; attaching that object to a scene and rendering it are ordinary Three responsibilities. The handle does not guess or retain a renderer, scene, or canvas.

Ordinary R3F uses the built-in handle without a provider:

```tsx
<Canvas>
  <Text font={font}>Hello Glyph</Text>
</Canvas>
```

The optional provider selects the same explicit handle for a custom subtree:

```tsx
<Canvas>
  <GlyphProvider handle={three}>
    <Text font={font}>Hello Glyph</Text>
  </GlyphProvider>
</Canvas>
```

Internally the outer `<Text>` passes a handle-owned binding in its R3F constructor arguments. It is conceptually equivalent to this package-private element:

```tsx
<glyphThreeText args={[handle.textBinding, desired]} />
```

Neither `Canvas` nor `GlyphProvider` initializes another Glyph runtime. The constructed Three `Text` retains the opaque binding and uses its `updateMatrixWorld()` override only as a post-matrix synchronization trigger.

### Concrete Three binding types

The bound command buffer can use real Three values where that is safe and opaque object tokens where renderer state needs a stable key:

```ts
import * as THREE from 'three/webgpu';

type ThreeResolvedResource =
  | Readonly<{ kind: 'texture-array'; texture: THREE.DataArrayTexture }>
  | Readonly<{ kind: 'data-texture'; texture: THREE.DataTexture }>
  | Readonly<{ kind: 'geometry'; geometry: THREE.BufferGeometry }>;

interface ThreeProgramBinding {
  createMaterial(context: ThreeMaterialContext): THREE.NodeMaterial;
}

interface ThreePrimitiveBinding {
  readonly kind: 'three-primitive-binding';
}

interface ThreeDrawBinding {
  readonly kind: 'three-draw-binding';
}

type ThreeBindings = GlyphBindings<
  ThreeResolvedResource,
  THREE.StorageInstancedBufferAttribute,
  ThreeProgramBinding,
  THREE.NodeMaterial,
  THREE.Object3D,
  ThreePrimitiveBinding,
  ThreeDrawBinding
>;
```

`ThreePrimitiveBinding` and `ThreeDrawBinding` are object identities, not public numeric IDs. The renderer maps them to actual `InstancedBufferGeometry` and `Mesh` objects. A direct `Object3D` is a suitable transform binding because current Three already resolves opaque engine transform bindings through a `WeakMap<BackendTransformBinding, Object3D>` ([engine-coordinator.ts:84-87](../../packages/glyph/src/three/engine-coordinator.ts#L84-L87), [185-196](../../packages/glyph/src/three/engine-coordinator.ts#L185-L196)).

### Requirement-to-helper map

| `GlyphConfig` requirement      | Minimal config-authored expression                                                           | Helper that removes repeated work                                                                                                                                                                                               | Recommended visibility                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Capabilities and `encode`      | Select transform/allocation modes and additional technique programs.                         | Implemented `defineThreeConfig(options)` keeps capabilities and encode together while reusing the validated internal `threeRenderPolicyDescriptor()` compiler.                                                                  | `/three` for supported options; compiler plumbing remains `/core` or package-private.                  |
| `decode`                       | Usually assign the shared `defaultDecoder`; optionally provide one closed typed replacement. | Implemented `defineDecoder<Bindings>()` preserves inference. Config spreading/wrapping instruments the whole phase; runtime expiry guards remain a focused follow-up only if negative tests require them.                       | `Decoder`, `defaultDecoder`, and `defineDecoder` in `/core`; `ThreeConfig` wires them.                 |
| `resolve`                      | Handle renderer-specific portable resource kinds.                                            | Implemented `resourceLease(value, dispose)` centralizes exactly-once ownership. Case dispatch, payload validators, or counted cross-boundary sharing remain adapter-local until another implementation proves a reusable shape. | Generic lease helper in `/core`; Three payload-to-object factories package-private.                    |
| Buffer realization             | Choose the host buffer primitive.                                                            | `ThreeBufferStore.ensure(command)` creates and validates `StorageInstancedBufferAttribute`; `applyBoundPatches()` applies ordered write/fill/copy operations and update ranges.                                                 | Package-private implementation utility.                                                                |
| Program/material realization   | Produce a Three material from already-bound program/resource/buffer state.                   | `defineTextMaterial()` already provides the correct phase-level material factory; a future `ThreeMaterialStore` can own keys, reuse, and disposal.                                                                              | Existing `/three` authoring helper plus package-private store.                                         |
| Primitive realization          | Map a bound primitive identity to geometry and material.                                     | `createUnitQuadGeometry()`, `createPortableGeometry()`, and `ThreePrimitiveStore.prepare()`.                                                                                                                                    | Geometry payload validators may be `/core`; Three geometry creation package-private.                   |
| Draw realization               | Map a bound draw identity to a retained host draw.                                           | `ThreeDrawStore.prepare()` creates/reuses `THREE.Mesh` and applies `renderOrder`, visibility, culling, and instance count.                                                                                                      | Package-private.                                                                                       |
| Renderer transaction           | Keep the last accepted branch live on any failure.                                           | `prepareRendererCommit()` collects commit/discard actions for every store and returns exactly one `PreparedRendererCommit`.                                                                                                     | Generic transaction helper in `/core` if the example renderer also uses it; otherwise package-private. |
| Transform-only synchronization | Update matrices without encode, decode, resolve, or material work.                           | `ThreeTransformStore.sync(root, transforms)` owns `Matrix4` scratch, direct draws, indexed transform storage, and update ranges.                                                                                                | Package-private, exposed only through `renderer.syncTransforms()`.                                     |
| Spread/wrap ergonomics         | Override one phase without depending on method `this`.                                       | `defineGlyphConfig()`, `wrapResolve()`, and `wrapRenderer()` preserve generic inference, freeze descriptors, and instrument whole phases.                                                                                       | `defineGlyphConfig` in `/core`; adapter-specific wrappers in `/three`.                                 |

These are phase-level helpers. They do not introduce per-command functors: the renderer still contains one fixed interpreter over the closed command unions.

### Codec, `encode`, and `decode`

The current Three coordinator already installs a policy from `threeRenderPolicyDescriptor()` and retains the exact capability set ([engine-coordinator.ts:87-122](../../packages/glyph/src/three/engine-coordinator.ts#L87-L122)). The helper should package those together:

```ts
// Candidate /three helper; not a current export.
const threeCodec = defineThreeCodec({
  transformMode: 'indexed',
  allocationMode: 'ordered',
  additionalPrograms: [],
});

const ThreeConfig = defineGlyphConfig({
  capabilities: threeCodec.capabilities,
  encode: threeCodec.encode,
  decode: defaultDecoder,
  resolve: resolveThreeResource,
  renderer: createThreeRenderer,
});
```

Conceptually, the helper is small:

```ts
function defineThreeCodec(options: ThreeCodecOptions) {
  const capabilities = threePolicyCapabilitySet();

  return Object.freeze({
    capabilities,
    encode: defineEncode(({ ids }) =>
      threeRenderPolicyDescriptor(ids, options.transformMode, options.additionalPrograms, options.allocationMode),
    ),
  });
}
```

`defineEncode()` is the valuable generic utility: it validates and compiles the Codec descriptor, ensures that the declared capability set matches the config, and prevents host objects such as `Texture`, `Material`, or `Mesh` from entering the engine input. The current implementation—still using policy-named symbols—already has reusable builders for schemas, buffers, raster programs, transform modes, and allocation modes ([render-policy.ts:1-20](../../packages/glyph/src/three/render-policy.ts#L1-L20), [51-122](../../packages/glyph/src/three/render-policy.ts#L51-L122)).

The common decoder is explicit in the config rather than hidden:

```ts
const TracedThreeConfig = defineGlyphConfig({
  ...ThreeConfig,
  decode: defineDecoder<ThreeBindings>((source, context) => {
    const frame = defaultDecoder(source, context);
    metrics.decoded({
      resources: frame.resources.length,
      buffers: frame.buffers.length,
      draws: frame.draws.kind === 'replace' ? frame.draws.values.length : 0,
    });
    return frame;
  }),
});
```

That wrapper is still one decoder call, not a per-command callback. A from-scratch implementation receives the same borrowed canonical buffer and binding context and must return the same `BorrowedBoundCommandBuffer<ThreeBindings>`. `defineDecoder()` cannot prove semantic correctness by TypeScript alone, but it can make alternate return shapes unassignable and install the same development-only phase and expiration guards used by the default implementation.

### `resolve` with real textures and geometry

A closed dispatcher plus an idempotent lease helper keeps every resolver small:

```ts
const resolveThreeResource = defineResourceResolver<ThreeResolvedResource>({
  'bitmap-atlas'(context) {
    const data = expectTextureArray(context.payload, 'r8');
    const texture = new THREE.DataArrayTexture(data.bytes, data.width, data.height, data.layers);

    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.needsUpdate = true;

    return resourceLease({ kind: 'texture-array', texture }, () => texture.dispose());
  },

  'supplied-geometry'(context) {
    const payload = expectGeometry(context.payload);
    const geometry = createPortableInstancedGeometry(payload);
    return resourceLease({ kind: 'geometry', geometry }, () => geometry.dispose());
  },
});
```

The generic lease helper should guarantee exactly-once cleanup rather than requiring every config to rewrite it:

```ts
function resourceLease<Value>(value: Value, release: () => void): ResourceLease<Value> {
  let live = true;
  return Object.freeze({
    value,
    dispose() {
      if (!live) return;
      live = false;
      release();
    },
  });
}
```

`expectTextureArray()` and `expectGeometry()` should own portable-payload validation. The current executor already repeats this kind of validation in `textureArrayResource()`, geometry accessors, and index/topology handling ([engine-plan-target.ts:2000-2013](../../packages/glyph/src/three/engine-plan-target.ts#L2000-L2013), [2264-2304](../../packages/glyph/src/three/engine-plan-target.ts#L2264-L2304)). `shareResourceLeases()` can lift the current coordinator's counted resource cache into a reusable handle-owned utility; boundaries receive independent leases while one `DataArrayTexture` remains shared until the final lease settles ([engine-coordinator.ts:198-225](../../packages/glyph/src/three/engine-coordinator.ts#L198-L225)).

### Renderer buffers, primitives, and draws

The buffer utility should turn a bound ensure command into the real storage primitive once:

```ts
type ThreeBufferSpec = Omit<BoundBufferCommand<unknown, unknown>, 'buffer' | 'program'>;

function createThreeStorageBuffer(command: ThreeBufferSpec) {
  const array =
    command.scalarType === 'f32'
      ? new Float32Array(command.byteLength / 4)
      : command.scalarType === 'u32'
        ? new Uint32Array(command.byteLength / 4)
        : new Uint16Array(command.byteLength / 2);

  const attribute = new THREE.StorageInstancedBufferAttribute(array, command.vectorWidth);
  attribute.setUsage(THREE.DynamicDrawUsage);
  attribute.needsUpdate = true;
  return attribute;
}
```

In the real type, `BoundBufferCommand` would omit its already-bound `buffer` parameter when used as a factory input; the handle binder would associate the returned attribute with the opaque buffer binding. `ThreeBufferStore.ensure()` should additionally enforce alignment, tight packing, generation replacement, and maximum shape once. `applyBoundPatches()` then owns byte views, range merging, `needsUpdate`, and PBO invalidation. These operations already form a coherent seam in the executor ([engine-plan-target.ts:680-793](../../packages/glyph/src/three/engine-plan-target.ts#L680-L793), [2410-2451](../../packages/glyph/src/three/engine-plan-target.ts#L2410-L2451)).

A geometry helper can be both concrete and boring:

```ts
function createUnitQuadGeometry(instanceCount: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
  geometry.instanceCount = instanceCount;
  return geometry;
}

function createDefaultTextMaterial(): THREE.MeshBasicNodeMaterial {
  return new THREE.MeshBasicNodeMaterial({
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
}

function createGlyphMesh(
  geometry: THREE.InstancedBufferGeometry,
  material: THREE.NodeMaterial,
  renderOrder: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}
```

Those helpers are direct extractions of current working behavior, not new abstraction for its own sake ([engine-plan-target.ts:976-995](../../packages/glyph/src/three/engine-plan-target.ts#L976-L995), [1987-1997](../../packages/glyph/src/three/engine-plan-target.ts#L1987-L1997), [2470-2478](../../packages/glyph/src/three/engine-plan-target.ts#L2470-L2478)). The material helper remains compatible with the existing `defineTextMaterial(context => NodeMaterial)` extension point, so a user-supplied material customizes one material factory instead of reimplementing `renderer` ([material.ts:5-39](../../packages/glyph/src/three/material.ts#L5-L39)).

The fixed renderer interpreter can then read like orchestration rather than one large executor:

```ts
function createThreeRenderer(context: ThreeRendererContext): Renderer<ThreeBindings, void> {
  const resources = new ThreeResourceStore();
  const buffers = new ThreeBufferStore();
  const materials = new ThreeMaterialStore();
  const primitives = new ThreePrimitiveStore();
  const draws = new ThreeDrawStore(context.drawRoot);
  const transforms = new ThreeTransformStore(context.drawRoot);

  return {
    prepare(frame) {
      const transaction = prepareRendererCommit<void>();
      try {
        resources.prepare(frame.resources, transaction);
        buffers.prepare(frame.buffers, transaction);
        buffers.patch(frame.patches, transaction);
        primitives.prepare(frame.primitives, { resources, buffers, materials }, transaction);
        if (frame.draws.kind === 'replace') {
          draws.prepareReplacement(frame.draws.values, { buffers, primitives, transforms }, transaction);
        }
        resources.retire(frame.retirements, transaction);
        buffers.retire(frame.retirements, transaction);
        return transaction.finish(undefined);
      } catch (error) {
        transaction.discard();
        throw error;
      }
    },

    syncTransforms(updates) {
      transforms.sync(updates.map((update) => update.transform));
    },

    dispose() {
      draws.dispose();
      primitives.dispose();
      materials.dispose();
      buffers.dispose();
      transforms.dispose();
      resources.disposeBindings(); // handle remains the ResourceLease owner
    },
  };
}
```

`prepareRendererCommit()` is the most important helper. Each store registers candidate additions, committed replacements, and discard cleanup; `finish()` returns one `PreparedRendererCommit`. No store publishes early. This is the reusable form of the current `PreparationContext`/`PreparedPublication` split and the example renderer's `prepareResources()` plus `prepareSubmission()` flow ([engine-plan-target.ts:205-229](../../packages/glyph/src/three/engine-plan-target.ts#L205-L229), [473-608](../../packages/glyph/src/three/engine-plan-target.ts#L473-L608), [example engine.ts:274-313](../../packages/glyph-example-renderer/src/engine.ts#L274-L313)).

`ThreeDrawStore` retains a map across publications for reuse and retirement, not to deduplicate repeated draws within one frame. A replacement builds a fresh candidate map: each unique draw binding either stages an update/reuse of its committed mesh or creates a candidate mesh; committed entries absent from the replacement retire only at commit. An `unchanged` phase leaves that map untouched. A `replace` phase containing the same draw binding twice throws instead of silently skipping the second record.

`ThreeTransformStore` should retain the actual `Object3D` bindings, draw membership, one `Matrix4` inverse scratch value, and one indexed `StorageInstancedBufferAttribute`. Its `sync()` computes matrices relative to the draw root and touches only direct mesh matrices or the indexed transform attribute. This preserves the current transform-only path without giving `Text` its own encoder or decoder ([engine-plan-target.ts:384-449](../../packages/glyph/src/three/engine-plan-target.ts#L384-L449), [1700-1737](../../packages/glyph/src/three/engine-plan-target.ts#L1700-L1737), [2439-2463](../../packages/glyph/src/three/engine-plan-target.ts#L2439-L2463)).

### Safe config wrapping

Config hooks must be pure function values that do not depend on `this`, so ordinary spreading remains safe:

```ts
const InstrumentedThreeConfig = defineGlyphConfig({
  ...ThreeConfig,

  resolve: wrapResolve(ThreeConfig.resolve, {
    after(context, lease) {
      metrics.resourceResolved(context.resourceKind);
      return lease;
    },
  }),

  renderer: wrapRenderer(ThreeConfig.renderer, (renderer) => ({
    prepare(frame) {
      metrics.commandCounts(frame);
      return renderer.prepare(frame);
    },
    syncTransforms(updates) {
      renderer.syncTransforms(updates);
    },
    dispose() {
      renderer.dispose();
    },
  })),
});
```

`wrapResolve()` and `wrapRenderer()` wrap whole phases, not commands. They must preserve synchronous throws, borrowed lifetimes, exactly-once lease settlement, and renderer commit/discard behavior. A narrower user need should get a narrower helper—for example `withThreeMaterial(ThreeConfig, materialFactory)` or `withThreeResourceResolver(ThreeConfig, kind, resolver)`—so most users never replace the fixed command interpreter.

For example, a material helper can expose the existing phase-level material context while leaving decode, resources, buffers, draws, and transactions untouched:

```ts
import * as THREE from 'three/webgpu';
import { mul, vec3 } from 'three/tsl';
import { defineTextMaterial } from '@pmndrs/glyph/three';

const warmMsdf = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.technique !== 'pmndrs.msdf') return material;
  if (!(material instanceof THREE.MeshBasicNodeMaterial)) {
    throw new TypeError('the built-in MSDF material must be a MeshBasicNodeMaterial');
  }

  material.colorNode = mul(context.shader.color, vec3(1, 0.72, 0.45));
  return material;
});

const WarmThreeConfig = withThreeMaterial(ThreeConfig, warmMsdf);
```

Here JavaScript selects graph structure from the stable technique binding, while `mul()` and `vec3()` build the installed Three TSL graph evaluated by the GPU. The helper should cache the resulting `NodeMaterial` by the same bound program/resource/buffer/transform state as the built-in renderer and dispose only materials it owns.

The main implementation payoff is readability: `ThreeConfig` becomes five declarative requirements—capabilities, `encode`, `decode`, `resolve`, and `renderer`—while each difficult invariant has one named utility and one test surface. The helpers also remain useful to the example renderer where their semantics are genuinely portable: Codec compilation, default decode, payload validation, resource leases, and renderer transactions can be shared; Three buffers, materials, meshes, and transforms cannot.

## 12. When context, renderer, scene, device, and canvas are actually needed

### Direct answer

For built-in Three, `GlyphConfig` needs none of the renderer, scene, canvas, `GPUCanvasContext`, or `GPUDevice`. The only new React context is a construction-time handle selector. It exists because JSX cannot call `handle.createText()` directly; it is not a rendering context.

The two renderer terms must not be conflated. `GlyphConfig.renderer` is Glyph's adapter-side consumer of the bound command buffer: for `ThreeConfig`, it creates and transactionally commits Three meshes, materials, attributes, and transform state under the `Text`/`TextGroup` draw root. `THREE.WebGPURenderer` is the application's host renderer that later traverses those objects and submits GPU work. The former does not need the latter as an argument.

The draw root also predates resolution. Imperative `handle.createText()` or the R3F constructor seam creates the retained `Text`; that object is the standalone draw root. Creating a `TextGroup` creates the possible group draw root. When a private boundary is formed, it chooses `drawRoot = group ?? seed` and constructs the config renderer with that already-existing object. This is current behavior in `ThreeTextBatchBinding` ([text.ts:718-735](../../packages/glyph/src/three/text.ts#L718-L735)). `resolve` then creates only portable-resource realizations such as textures or supplied geometry. Later, the bound draw phase tells the config renderer which geometry, material, buffers, and transforms form each generated mesh. Transactional commit attaches only those renderer-owned meshes with `drawRoot.add(mesh)` and removes retired ones with `removeFromParent()` ([engine-plan-target.ts:565-582](../../packages/glyph/src/three/engine-plan-target.ts#L565-L582)).

For a standalone `Text`, parenting the generated mesh beneath the `Text` supplies ordinary transform inheritance. For a batched `TextGroup`, generated meshes are children of the group rather than of any one descendant `Text`; the renderer binds each text's transform relative to the group through indexed transform storage or a direct mesh matrix. The renderer knows which children belong in the draw root from the closed bound draw commands and its retained draw-binding map, not by scanning arbitrary scene children and not from `resolve`.

The stages are distinct:

| Stage/value                                                               | Needs handle | Needs scene               | Needs renderer/device | Needs canvas/context  |
| ------------------------------------------------------------------------- | ------------ | ------------------------- | --------------------- | --------------------- |
| Create retained Three `Text`/`TextGroup`                                  | Yes          | No                        | No                    | No                    |
| Encode, shape, decode, and bind one private publication boundary          | Yes          | No                        | No                    | No                    |
| `resolve` to `DataArrayTexture`, geometry, storage attribute, or material | Yes          | No                        | No                    | No                    |
| Attach retained `Mesh` children to the `Text`/`TextGroup` draw root       | Yes          | No                        | No                    | No                    |
| Put the retained object into an application hierarchy                     | No           | No; any `Object3D` parent | No                    | No                    |
| Three realizes/uploads backend `GPUTexture`/buffers/pipelines             | No           | Traversed                 | Yes                   | Not for those objects |
| Three presents the default framebuffer                                    | No           | Yes                       | Yes                   | Yes                   |

The current executor proves the resolver side: `#bitmapTexture()` and `#msdfAtlas()` call `new THREE.DataArrayTexture(...)`, set metadata, and mark `needsUpdate`; they do not receive a renderer or canvas ([engine-plan-target.ts:1390-1430](../../packages/glyph/src/three/engine-plan-target.ts#L1390-L1430)). The actual `WebGPURenderer` later observes the texture through a material. Its renderer-local `Textures` manager asks the backend to create/update device resources ([Textures.js:204-216](../../packages/glyph/node_modules/three/src/renderers/common/Textures.js#L204-L216), [308-355](../../packages/glyph/node_modules/three/src/renderers/common/Textures.js#L308-L355)), and the WebGPU backend ultimately calls `device.createTexture()` ([WebGPUTextureUtils.js:390-403](../../packages/glyph/node_modules/three/src/renderers/webgpu/utils/WebGPUTextureUtils.js#L390-L403)). This is the relevant late binding.

The scene is not an allocation context. It is the existing `Object3D` hierarchy that determines which retained objects Three traverses. The handle and resolver do not need to know which scene eventually contains a `Text`; moving that object between parents remains ordinary Three behavior plus the existing private-boundary rebind rules.

### When the canvas is created

Application code or R3F normally creates/provides the canvas as part of creating the host renderer. If no canvas parameter is supplied, installed Three's backend creates one when `Renderer` constructs its default `CanvasTarget`: the renderer calls `backend.getDomElement()`, whose lazy getter creates the element on that first request ([Renderer.js:286-293](../../packages/glyph/node_modules/three/src/renderers/common/Renderer.js#L286-L293), [Backend.js:696-711](../../packages/glyph/node_modules/three/src/renderers/common/Backend.js#L696-L711)). That timing is independent of `handle.createText()`, `shape()`, `decode`, and Three `resolve`.

In the installed WebGPU backend, `renderer.init()` obtains or accepts a `GPUDevice` without first requiring a canvas context ([WebGPUBackend.js:214-283](../../packages/glyph/node_modules/three/src/renderers/webgpu/WebGPUBackend.js#L214-L283)). The `GPUCanvasContext` is obtained and configured when the backend's presentation context is first needed ([WebGPUBackend.js:326-365](../../packages/glyph/node_modules/three/src/renderers/webgpu/WebGPUBackend.js#L326-L365)); `getCurrentTexture()` is then used while preparing the default render-pass attachment ([WebGPUBackend.js:463-483](../../packages/glyph/node_modules/three/src/renderers/webgpu/WebGPUBackend.js#L463-L483)). Thus a canvas is required for presenting to that canvas, not for `new THREE.DataArrayTexture()` and not for raw `GPUDevice.createBuffer()`/`createTexture()`. Ordinary `GPUTexture` and `GPUBuffer` values are device-bound, not canvas-bound; the special texture returned by `GPUCanvasContext.getCurrentTexture()` is the per-frame presentation resource.

### Raw GPU resource adapters

If a different `GlyphConfig` returns actual `GPUBuffer`, `GPUTexture`, `GPUSampler`, or pipelines from `resolve`—the hypothetical `new GpuResourceThing(...)` case—that resolver needs a live `GPUDevice` at the first `device.create*` operation or constructor that demands the device. It still does not intrinsically need a renderer, scene, canvas, or `GPUCanvasContext`.

That device should be supplied when authoring the adapter config, using an ordinary typed closure:

```ts
function createWebGpuConfig(device: GPUDevice): GlyphConfig<WebGpuPayload, WebGpuBindings, void> {
  return defineGlyphConfig({
    capabilities,
    encode,
    decode: defaultDecoder,
    resolve: (context) => resolveGpuResource(device, context),
    renderer: (context) => createGpuCommandRenderer(device, context),
  });
}

const gpuHandle = glyph.handle('raw-webgpu', createWebGpuConfig(device));
```

If that adapter also owns presentation, its host renderer can separately capture a configured `GPUCanvasContext`. The context is used when acquiring the current presentation texture and encoding/submitting a render pass; it should not be threaded through `decode` or every resource resolver merely because one renderer eventually presents to a canvas. Device loss is likewise a handle/config lifecycle concern, not a scene concern.

### Exact Three and R3F flow

```text
R3F selects nearest immutable context handle or suspends on built-in default
  -> handle.createText() or R3F constructor args create retained Text/TextGroup
  -> application/R3F attaches it anywhere in an Object3D hierarchy
  -> React layout effect updates desired state and calls invalidate()
  -> host renderer starts scene traversal
  -> Text/TextGroup.updateMatrixWorld() runs after matrices are current
  -> dirty boundary: shape -> TypedCommandBuffer -> decode -> resolve -> bound commands -> commit draw-root children
  -> clean boundary: syncTransforms only
  -> Three builds the render list from those children
  -> Three renderer-local managers realize/upload buffers, textures, materials, and pipelines on the active backend/device
  -> only presentation uses the renderer's active canvas target/GPUCanvasContext
```

### Smallest decisive tests

1. Construct and shape a Three `Text` with `DataArrayTexture` resources in a headless test with no renderer, scene, or canvas. Assert the retained Three objects exist and no backend allocation was attempted.
2. Render distinct text branches from one handle through two independent `WebGPURenderer`s. Verify each renderer realizes its own backend resources and that disposing one branch/renderer does not invalidate the other. This decides whether handle caches may safely share resolved Three objects across renderers.
3. Mount ordinary R3F text with no provider and assert one default handle initializes through Suspense. Separately remount
   keyed provider A as keyed provider B under StrictMode and assert reconstruction plus exactly-once lease settlement.
   No test should inspect R3F's renderer, scene, root store, or canvas target for construction.
4. Create a raw-WebGPU config from a device with no canvas, resolve a buffer/texture successfully, then add and configure a canvas context only for presentation. Separately test device loss and reject further synchronous resource creation at the call site.

## Approved contract outcome

The user explicitly approved implementation in this task. D-293 records the adapter contract and D-294 records the
refined R3F default-or-provider selection contract:

1. `glyph` is the sole root `Glyph` instance and `glyph.init()` is the sole runtime initialization path for the application-facing API.
2. `glyph.handle(name, config)` creates an independently disposable, host-neutral configured adapter handle; `/three` exports the spreadable `ThreeConfig`.
3. `/three` exposes `handle.createText()`; R3F context carries only that selected handle into the existing constructor-argument seam. No public session, renderer, scene, canvas, or host-context binding is introduced.
4. Immutable root `Font` values bind to any number of handles through private counted leases.
5. `Codec` is the public encode-side name. `GlyphConfig.encode` supplies that Codec, and the engine alone defines the canonical `TypedCommandBuffer` it produces.
6. `GlyphConfig.decode` is required. Built-in configs wire the engine-supplied `defaultDecoder`; a config may replace it only with a type-safe `Decoder<Bindings>` returning the same borrowed `BoundCommandBuffer` vocabulary. Ordinary renderer consumers see stable object bindings and never numeric plan IDs.
7. `resolve` is synchronous and returns a boundary-owned disposable lease; renderer preparation is transactional. Three's resolver creates Three objects without a renderer/device/canvas, while the actual `WebGPURenderer` owns backend GPU realization and presentation binding.
8. A raw GPU config that creates `GPU*` resources captures its required `GPUDevice` in its config/handle closure; a `GPUCanvasContext` is introduced only by the presenting host renderer unless a genuinely canvas-specific resource requires otherwise.
9. `shape()` flushes dirty semantic state once per private publication boundary and commits the renderer transaction; transform-only synchronization is a separate cheap path.
10. `Text` and `TextGroup` retain desired state and hierarchy. Handle/private-boundary infrastructure owns planning, decode/bind, resource leases, renderer commit, and disposal.
11. Standalone `Text` and each `TextGroup` keep independent private publication boundaries. Multiple handles and multiple scenes may coexist; one `TextGroup` cannot mix handles.

The low-level `GlyphEngine`/`GlyphBackend`/`RenderPlanner` surface remains authoritative for integrations that deliberately
own transport and target mechanics. The root handle surface is authoritative for ordinary configured adapter use.

## Approved FontFace direction after the handle implementation

D-295 extends the implemented handle/config contract with a root font-family declaration and load-before-use selection.
This section records the intended contract and explicitly distinguishes it from current behavior. No FontFace public
surface, fail-fast Three binding, provider font catalog, or new CLI default described here is implemented yet.

### Simplest form

The smallest explicit declaration needs only a family and one source. Omitted format and default declarations mean MSDF:

```ts
const Inter = glyph.fontFace({
  family: 'Inter',
  src: [{ url: interUrl }],
});

await Inter.load();

const label = three.createText({
  font: Inter,
  text: 'Hello',
});

scene.add(label);
```

`Inter`, `Inter.default`, and `Inter.msdf` identify the same default format contract. `load()` is idempotent and resolves
to the same selection, so `font: await Inter.load()` is equivalent. Constructing or updating imperative `Text` with an
unloaded face throws synchronously instead of creating a temporarily empty object.

The corresponding minimal R3F form uses the provider key as the local family name and authorizes automatic loading:

```tsx
<GlyphProvider fonts={{ Inter: interUrl }} fallback={<LoadingFonts />}>
  <Text font="Inter">Hello</Text>
</GlyphProvider>
```

The provider value is captured once. A raw source shorthand creates a provider-owned face; an already-created FontFace is
borrowed. The provider releases only faces it created when it unmounts and never disposes an externally supplied handle or
FontFace. `fallback` is the provider's Suspense fallback; omitting it may use `null` without changing load ownership.

### Complete ordinary declaration

One GLB can contain several raster formats, and its authenticated raster directory is the runtime authority. The source
declaration supplies the static type information and states what each ordered candidate is expected to provide:

```ts
const Inter = glyph.fontFace({
  family: 'Inter',
  src: [
    { url: './Inter.font.glb', format: [bitmap({ strikes: [8, 16] }), msdf, slug] },
    { url: './Inter.slug.font.glb', format: slug },
    { blob: FONT_BLOB, format: slug },
  ],
});

const Body = Inter.bitmap;
const Title = Inter.slug;
```

`src` remains an array instead of a format-keyed record because source identity and ordered fallback are real authoring
information. Several techniques may share one fetched/parsed GLB, and several sources may be candidates for one technique.
The const-generic result projects the union of declared technique kinds into typed properties without a separate
`defineFont()` token. Third-party raster techniques participate through the same technique witness and acquire a property
from their literal `kind`.

The FontFace object itself implements the default selection contract. `.default` remains useful when code wants to state
that choice explicitly, while `.bitmap`, `.msdf`, `.slug`, and inferred custom members select one declared technique. A
family with no explicit default uses MSDF. A different default is a technique request, not a renderer setting:

```ts
const InterXSmall = glyph.fontFace({
  family: 'Inter X-Small',
  default: bitmap({ strikes: [8, 16] }),
  src: [{ url: './Inter-x-small.font.glb', format: bitmap({ strikes: [8, 16] }) }],
});
```

`InterXSmall` is a different face, not a second Bitmap member keyed by strike size inside `Inter`. Bitmap owns one ordered
strike set and selects the appropriate baked strike for the requested CSS size and raster pixel ratio. MSDF is the normal
scalable default, Bitmap covers intentionally baked small sizes, and Slug covers extra-large or otherwise high-fidelity
use. The ordinary family can therefore expose all three while higher-level aliases remain plain selections:

```ts
const Body = Inter.bitmap;
const Copy = Inter;
const Title = Inter.slug;
```

### Format options are a bake contract

The current immutable loader derives an exact raster key from the technique descriptor and first asks the GLB for that
reference. It runtime-bakes only after an exact miss and only when retained source bytes plus a matching runtime baker are
available. D-295 preserves and raises that invariant to FontFace:

- a baked GLB candidate declaring `bitmap({ strikes: [8, 16] })` must contain that exact descriptor;
- a GLB cannot be silently re-baked because it contains no TTF/OTF source bytes;
- a TTF/OTF candidate may be runtime-baked with stated options or the technique's documented defaults;
- a source declaration that promises several formats is validated against the artifact directory when that source is
  opened;
- ordered fallback may continue to the next candidate, but the failed candidate remains a precise diagnostic and the load
  rejects if no candidate satisfies the selected contract.

Production should normally receive pre-baked GLBs. A Vite integration may discover FontFace declarations and build the
exact source/format graph ahead of time; runtime baking remains the source-font fallback, not the normal production path.

### One load boundary and fail-fast Text

There is no separate preload operation and no public readiness subscription. Each default or technique-specific selection
has one idempotent `load()` operation, and the face retains the resulting cache lease:

```ts
interface FontFaceSelection<Technique extends AnyRasterTechnique> {
  readonly loaded: boolean;
  load(): Promise<this>;
}
```

`Inter.loaded` inspects the default selection, while `Inter.bitmap.loaded` and `Inter.slug.loaded` inspect exact members;
family-level `isLoaded()` answers the default and `isLoaded(technique)` answers a declared technique without starting
work. `Inter.load()` loads the default, `Inter.bitmap.load()` loads Bitmap, and loading all declared formats is explicit:

```ts
await Promise.all([Inter.bitmap.load(), Inter.msdf.load(), Inter.slug.load()]);
```

Imperative Three remains synchronous. Its constructor and `Text.set({ font })` validate that every root, fallback, and span
selection is loaded before acquiring private immutable Font bindings. An unloaded face or named lookup throws at that call
without mutating desired state, creating a planner entry, or changing the last accepted draw. Callers therefore write:

```ts
await Inter.load();
const label = three.createText({ font: Inter, text: 'Hello' });
```

or select another format directly:

```ts
const title = three.createText({ font: await Inter.slug.load(), text: 'Title' });
```

This removes the frame-scheduling problem rather than adding a second synchronization protocol. There is no pending `Text`
that needs an invalidation callback: imperative code awaits before construction, and a failed update leaves the current
text intact.

R3F accepts FontFace selections and strings at its declarative boundary, but automatic loading is an explicit provider
capability. The nearest immutable `GlyphProvider fonts` map supplies aliases and the set of faces whose `load()` operations
the subtree may start. For one of those mapped selections, React calls `use(selection.load())` and constructs or updates
the Three object only after the stable Promise resolves. Calling `void Inter.load()` before rendering starts the same
operation early; there is no separate preload cache or API.

Without a provider font map, R3F may use a loaded direct selection or loaded root-catalog name, but it does not initiate a
load. An unloaded selection throws the same load-before-use error as imperative Three. This keeps hidden network and
runtime-bake work out of components that did not declare a font-loading boundary.

`GlyphProvider` may itself supply both boundaries around its immutable context value:

```tsx
<GlyphProvider
  fonts={{ Inter: interUrl }}
  fallback={<LoadingFonts />}
  errorFallback={(error) => <FontLoadFailure error={error} />}
>
  <Text font="Inter">Hello</Text>
</GlyphProvider>
```

The internal error boundary handles only authenticated FontFace load errors whose owning face belongs to that provider's
map. A parse/fetch/bake error is wrapped at the FontFace boundary with family and source provenance, so the provider does
not classify errors from messages or `instanceof` alone. Errors from application children, Three realization, another
catalog, or an unmapped externally supplied face are rethrown to the next application error boundary. With no
`errorFallback`, font errors are rethrown as well rather than being silently swallowed.

Context carries one immutable construction selection containing the chosen Three handle and font catalog; it remains
neither a second Glyph runtime nor a mutable font store. A `GlyphProvider` without `fonts` may still select a handle and
provide UI boundaries, but it authorizes no font loads.

### Ownership and disposal

FontFace adds a cache owner without replacing D-286's immutable loaded `Font` ownership:

- the FontFace strongly owns each successfully loaded format's cache lease so named lookup remains deterministic;
- `load()` resolves to the same stable default or technique-specific selection and does not create a caller-owned lease;
- each mounted/bound `Text` acquires its own private engine/renderer binding lease;
- `FontFace.dispose()` aborts pending source work, removes its catalog registration, publishes `disposed`, and releases all
  face-owned cache leases;
- Fonts acquired through the low-level `loadFont()` API and committed renderer bindings remain valid until their
  independent owners release them;
- ignoring the returned FontFace deliberately chooses realm lifetime, so a finalizer is neither necessary nor effective
  while the catalog retains the declaration.

### Review against the original plan

| Original plan or current evidence                                                                 | D-295 result                                                                                                                           | Consequence                                                                                               |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| D-286 makes loaded `Font<Technique>` immutable and independently leased.                          | Preserved internally and in low-level `loadFont()`. FontFace owns its cache lease, while Text acquires a private binding lease.        | Face disposal releases its cache without invalidating mounted text.                                       |
| D-293 lets immutable fonts bind into multiple handles.                                            | Preserved. FontFace is root-owned and renderer-neutral; each handle binds the resolved Font independently.                             | A named family is not owned by Three, R3F, a scene, or a renderer.                                        |
| D-294 makes React context immutable constructor injection.                                        | Extended from a bare handle to `{ handle, fonts }`, captured once; the map also authorizes automatic loading.                          | Provider aliases and loading policy do not create another runtime or mutable context.                     |
| D-287 uses R3F `useLoader` as the existing font promise cache.                                    | Superseded for FontFace selections by the root idempotent load promise; the existing `useFont` hooks may remain compatibility loaders. | React suspends on the same operation imperative callers await.                                            |
| `loadFont()` currently requires exact technique options and can runtime-bake after a raster miss. | Preserved as the low-level invariant behind format declarations.                                                                       | Declared options validate baked artifacts and drive source-font runtime/unplugin baking.                  |
| `defineFont()` is the current static discovery token.                                             | Not required for FontFace declarations; discovery can read `glyph.fontFace()` calls and their source/format graph.                     | Ordinary named-font authoring has no duplicate token ceremony.                                            |
| The current direct CLI emits shaping-only output when no raster flags are supplied.               | Intentionally changed: no raster flags mean embedded Bitmap 8/16, default MSDF, and Slug; explicit flags replace the defaults.         | The default artifact covers small, normal, and extra-large rendering while string selection remains MSDF. |

### Smallest implementation proofs

1. Bake with no raster flags and authenticate one embedded Bitmap descriptor with strikes 8/16, one default MSDF
   descriptor, and one Slug descriptor; prove any explicit raster flag set replaces that default set.
2. Infer `Inter`/`.default` as MSDF and `.bitmap`/`.slug` from one multi-format source plus ordered Slug fallbacks; infer one
   custom technique member without `defineFont()`.
3. Reject a baked source whose declared Bitmap options do not match its raster directory; feed the same declaration a
   TTF and prove the exact runtime baker request receives those options.
4. Construct and update imperative Three `Text` with an unloaded face and prove each call throws before shaping, desired
   state mutation, or draw retirement; await `load()` and prove the same selection then succeeds.
5. Mount provider shorthand plus `font="Inter"` under Suspense and StrictMode, prove one stable load, immutable context,
   balanced leases, and no Three `Text` construction before resolution; omit `fonts` and prove the same unloaded
   selection throws without starting a request.
6. Reject one mapped font load through the provider's font fallback, then throw an unrelated child/renderer error and
   prove the provider rethrows it to an outer boundary.
7. Load several formats, acquire one low-level independent Font and one mounted Text binding, dispose the FontFace, and
   prove its cache leases release while the independent Font and committed draw remain valid.
