---
type: Research Report
title: Superseded Glyph handle and renderer-bound command-buffer investigation
description: Historical investigation superseded by the root GlyphConfig and renderer-decode contract.
documentation_type: explanation
tags: [api, glyph, font-face, threejs, react, r3f, renderer, command-buffer, ownership]
status: deprecated
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
  - id: engine-integration-plan
    resource: engine-integration-boundary.md
    title: Renderer-neutral core and engine integration plan
  - id: current-three-text
    resource: ../../../packages/glyph/src/three/text.ts
    title: Current Three Text and TextGroup lifecycle
  - id: current-three-domain
    resource: ../../../packages/glyph/src/three/handle.ts
    title: Current Three configured handle and roots
  - id: current-three-coordinator
    resource: ../../../packages/glyph/src/internal/configured-handle.ts
    title: Current internal configured-handle ownership
  - id: current-three-plan-target
    resource: ../../../packages/glyph/src/three/engine-plan-target.ts
    title: Current Three render-plan executor
  - id: current-three-codec
    resource: ../../../packages/glyph/src/three/codec.ts
    title: Current Three Codec
  - id: current-three-material
    resource: ../../../packages/glyph/src/three/material.ts
    title: Current Three material extension
  - id: current-react
    resource: ../../../packages/glyph/src/react.ts
    title: Current R3F wrapper
  - id: current-font-contract
    resource: ../../../packages/glyph/src/font.ts
    title: Current immutable Font and discovery-token contract
  - id: current-font-loader
    resource: ../../../packages/glyph/src/loader.ts
    title: Current immutable Font and FontLibrary loader
  - id: current-bake-cli
    resource: ../../../packages/glyph/src/node/cli.ts
    title: Current direct bake CLI defaults and raster flags
  - id: installed-r3f-scheduler
    resource: ../../../packages/glyph/node_modules/@react-three/fiber/dist/index.mjs
    title: Installed R3F 10 scheduler
  - id: installed-r3f-types
    resource: ../../../packages/glyph/node_modules/@react-three/fiber/dist/index.d.ts
    title: Installed R3F 10 root-state types
  - id: installed-three-renderer
    resource: ../../../packages/glyph/node_modules/three/src/renderers/common/Renderer.js
    title: Installed Three 0.185 renderer
  - id: installed-three-backend
    resource: ../../../packages/glyph/node_modules/three/src/renderers/common/Backend.js
    title: Installed Three backend canvas ownership
  - id: installed-three-textures
    resource: ../../../packages/glyph/node_modules/three/src/renderers/common/Textures.js
    title: Installed Three renderer texture manager
  - id: installed-three-webgpu-textures
    resource: ../../../packages/glyph/node_modules/three/src/renderers/webgpu/utils/WebGPUTextureUtils.js
    title: Installed Three WebGPU texture realization
  - id: installed-three-webgpu-backend
    resource: ../../../packages/glyph/node_modules/three/src/renderers/webgpu/WebGPUBackend.js
    title: Installed Three WebGPU device and canvas binding
  - id: current-plan-contract
    resource: ../../../packages/glyph/src/internal/render-planner.ts
    title: Current render-plan delivery and lifetime contract
  - id: current-plan-view
    resource: ../../../packages/glyph/src/internal/plan-view.ts
    title: Current render-plan tables and decoded records
  - id: current-example
    resource: ../../../packages/glyph-example-renderer/src/engine.ts
    title: Current example renderer
  - id: configured-plan-target
    resource: ../../../packages/glyph/src/internal/glyph-plan-target.ts
    title: Shared configured plan target
  - id: implemented-glyph-runtime
    resource: ../../../packages/glyph/src/glyph.ts
    title: Implemented root Glyph runtime
  - id: implemented-config-contract
    resource: ../../../packages/glyph/src/config/glyph.ts
    title: Implemented GlyphConfig and publication helpers
  - id: implemented-three-config
    resource: ../../../packages/glyph/src/three/handle.ts
    title: Implemented ThreeConfig and handle lifecycle
  - id: implemented-three-target
    resource: ../../../packages/glyph/src/three/engine-plan-target.ts
    title: Implemented Three configured plan target
  - id: implemented-transform-sync
    resource: ../../../packages/glyph/src/three/transform-synchronizer.ts
    title: Implemented cheap Three transform path
  - id: implemented-example-config
    resource: ../../../packages/glyph-example-renderer/src/config.ts
    title: Implemented example GlyphConfig
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-01T00:00:00-04:00'
---

# Glyph handle and renderer-bound command-buffer investigation

> **Historical record — superseded.** This report records the investigation and an intermediate implementation, not the
> current integration contract. D-306 and D-308 removed the public `/core`, backend, planner, target, configurable decoder,
> and `renderer.prepare()` architecture described below. Current integrations use root `GlyphConfig`/
> `defineGlyphConfig`, Codec `encode`, internal trusted projection to a borrowed `CommandBufferView` with ordered
> `DisplayList`, `GlyphRenderer.decode`, `glyph.handle`, and anonymous or named roots. See the
> [current renderer integration guide](../guides/renderer-integration.md).

Status: handle/config, FontFace/R3F lifecycle, bound hierarchy, and built-in renderer cutover implemented

## Conclusion

The pre-change code supported the intended direction, with three qualifications. The lifecycle audit below is retained as
the evidence that informed the design; the implementation outcome following it records what now ships in this working
tree.

First, the repository previously did not expose `Glyph`, `glyph`, `GlyphConfig`, `glyph.handle()`, or a public `shape()`
call. D-293 now records the approved ordinary-adapter surface while retaining
`createGlyphEngine() -> GlyphBackend -> RenderPlanner` under `/core` as the low-level integrator escape hatch.

Second, `decode(TypedCommandBuffer)` should return a **borrowed, phase-structured `BoundCommandBuffer<Bindings>`**. `GlyphConfig.decode` is a required, type-safe hook, and every built-in config wires the same engine-supplied `defaultDecoder` unless it deliberately overrides it. The decoder implementation remains owned by the engine package, but decoder selection is explicit in the config. Its output must contain stable object bindings, not plan IDs: resource bindings already produced by `resolve`, buffer bindings in place of buffer IDs, transform and material bindings in place of numeric handles, primitive objects in place of primitive indices, and retirement commands naming those same bindings. The handle and each private publication boundary own the leases and renderer transaction. The renderer may retain its own committed host objects, but it may not retain the bound command arrays or borrowed patch bytes.

Third, React context carries the selected Three handle plus an optional immutable local FontFace alias map. It neither
initializes a second Glyph runtime nor owns an engine, decoder, resource pool, renderer, scene, canvas, or semantic font
cache. A handle or alias-map change requires provider remount and reconstructs the retained Three subtree. Nested inline
`<Text>` remains compiled into the outer paragraph and never reads context independently.

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
  bridge only for its existing concrete device oracle;
- `glyph.fontFace(source, config?)` returns its default selection, with `.default` and declared technique members inferred
  from `format`; each selection owns `load(handle)` and `isLoaded(handle)`, while the handle contributes the technique map
  and default key;
- R3F hooks declare through the same FontFace path, conditionally suspend only while a selection is unloaded, own mounted
  immutable Font leases, and expose Promise-returning `.preload()` plus declaration `.clear()`;
- `GlyphProvider` is optional. It may select one immutable external handle, declare scoped aliases through `fontFaces`,
  and opt into Suspense/font-error fallbacks without becoming a runtime or font-cache owner;
- one `defineTextMaterial()` factory receives closed `kind: 'glyph' | 'decoration'` realizations; only glyph branches
  expose a concrete raster technique, while the reserved `pmndrs.decoration` name stays inside the policy ABI;
  those realizations remain separate ordered draws and separate material objects; and
- the paired `@pmndrs/glyph-examples` app proves imperative Three and R3F over the same assets, while the TypeGPU proof
  uses only a public configured handle and recreates a handle after device loss.

The implementation tests cover repeated/concurrent initialization, two named Three handles over one immutable font,
spread config hooks, explicit decode and resolve calls, standalone and grouped draw-root attachment, multiple scenes on
one handle, cross-handle group rejection, name reuse after disposal, explicit `shape()`, transform-only bypass of semantic
phases, R3F provider/default-handle construction, immutable provider selection, React lease balance, FontFace loading,
decoration material override, paired live examples, and the configured example-renderer path. Current focused results are
recorded in the final verification section and canonical log rather than frozen here while the refactor is active.

## Pre-change evidence status of the handoff

The following audit records the repository state inspected before implementation and distinguishes those facts from the
then-proposed design. The implementation outcome above is authoritative for the resulting working tree.

| Handoff claim                                                                                   | Status                                                   | Verified evidence or correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current Three has an implicit shared engine domain.                                             | Verified in the pre-change baseline.                     | Historical `engine-domain.ts` evidence was removed when D-306 internalized handle/root ownership.                                                                                                                                                                                                                                                                                                                                                                                                 |
| A Three `Font` must be initialized before `Text` construction.                                  | Verified in the pre-change baseline.                     | Historical `engine-domain.ts` evidence was removed when FontFace loading and handle-relative selection replaced that path.                                                                                                                                                                                                                                                                                                                                                                        |
| Loaded fonts are immutable application values.                                                  | Verified.                                                | `Font` exposes readonly metadata and a disposal lease; stacks are frozen and authenticated ([font.ts:48-55](../../../packages/glyph/src/font.ts#L48-L55), [loaded-font.ts:44-68](../../../packages/glyph/src/loaded-font.ts#L44-L68)).                                                                                                                                                                                                                                                                  |
| Current `Text` retains desired state and binds an opaque transform.                             | Verified in the pre-change baseline.                     | Construction evidence remains in `text.ts`; the historical coordinator `WeakMap` source was removed when D-306 moved ownership behind the configured handle/root.                                                                                                                                                                                                                                                                                                                                 |
| `TextGroup` is the current batch/publication boundary.                                          | Verified.                                                | Nested `TextGroup`s terminate descendant collection, each nonempty group creates one `ThreeTextBatchBinding`, and one synchronization follows reconciliation ([text.ts:639-654](../../../packages/glyph/src/three/text.ts#L639-L654), [1276-1285](../../../packages/glyph/src/three/text.ts#L1276-L1285)).                                                                                                                                                                                              |
| A clean frame uses a transform-only path.                                                       | Verified.                                                | `synchronize()` calls `syncTransforms()` directly when no publication is pending ([text.ts:894-925](../../../packages/glyph/src/three/text.ts#L894-L925)); the executor documents and implements that path without Wasm ([engine-plan-target.ts:384-449](../../../packages/glyph/src/three/engine-plan-target.ts#L384-L449)).                                                                                                                                                                           |
| The current executor decodes, resolves, realizes, commits, and retires.                         | Verified.                                                | Its state includes buffers, resources, textures/pages, materials, transforms, origins, draws, and preparation state ([engine-plan-target.ts:250-275](../../../packages/glyph/src/three/engine-plan-target.ts#L250-L275)); `accept()` calls `prepare()` then `commit()` transactionally ([301-309](../../../packages/glyph/src/three/engine-plan-target.ts#L301-L309), [473-608](../../../packages/glyph/src/three/engine-plan-target.ts#L473-L608)).                                                       |
| Current R3F uses no Glyph context.                                                              | Verified.                                                | `react.ts` imports React hooks but creates no context or provider; `Text` and `TextGroup` construct the existing Three classes through R3F `extend()` ([react.ts:1-14](../../../packages/glyph/src/react.ts#L1-L14), [126-202](../../../packages/glyph/src/react.ts#L126-L202), [204-265](../../../packages/glyph/src/react.ts#L204-L265)).                                                                                                                                                                |
| R3F nested `<Text>` creates no Three object.                                                    | Verified.                                                | `flattenText()` recognizes nested `Text`, derives string ranges, and emits spans into the outer paragraph ([react.ts:442-485](../../../packages/glyph/src/react.ts#L442-L485)).                                                                                                                                                                                                                                                                                                                      |
| The example renderer is a second consumer of the same portable plan.                            | Verified and migrated.                                   | It creates a backend/policy/planner behind `defineExampleConfig()`, delegates canonical mapping and resource settlement to the renderer-neutral configured plan target, consumes the bound hierarchy in its device transaction, commits a submission, and retires resources ([config.ts](../../../packages/glyph-example-renderer/src/config.ts), [glyph-plan-target.ts](../../../packages/glyph/src/internal/glyph-plan-target.ts), [device.ts](../../../packages/glyph-example-renderer/src/device.ts)). |
| `decode => BoundCommandBuffer`, `GlyphConfig`, handles, and `shape()` existed before this work. | Not in the audited baseline; implemented after approval. | The prior published integrator boundary was `PlanCandidate`/`PlanTarget`. D-293 and the implementation outcome above record the added ordinary-adapter surface.                                                                                                                                                                                                                                                                                                                                   |

## 1. Verified current lifecycle: imperative Three

### Initialization and fonts

1. In the audited baseline, constructing the now-removed `FontLoader` did not initialize the engine. Its first load or
   `initFont()` lazily acquired the historical Three loader domain; the implementation was deleted when loading moved to
   Glyph's renderer-neutral font graph.
2. The historical domain started `createGlyphEngine()`, then created one coordinator over that engine. Loader, associated-font, and text leases kept the domain alive. That source was removed when D-306 internalized handle/root ownership.
3. A completed baseline load returned a root `Font` and associated its immutable raster-variant identity with that
   historical domain. The removed association was renderer bookkeeping; it did not make the `Font` mutable or
   renderer-owned.

### Text construction and desired state

4. `new Text(properties)` validates and freezes desired semantic state, locates one domain from all root/span fonts, binds the `Text` object to an opaque backend transform, and creates backend font-stack bindings ([text.ts:184-204](../../../packages/glyph/src/three/text.ts#L184-L204), [1073-1098](../../../packages/glyph/src/three/text.ts#L1073-L1098)). It does **not** create a planner, target, or mesh yet.
5. `Text.set()` computes new desired state, stages an update into an existing batch when one exists, advances the desired revision, and invalidates measurement/bounds. Intermediate desired values can coalesce before traversal ([text.ts:278-310](../../../packages/glyph/src/three/text.ts#L278-L310)).
6. `scene.add(text)` or `group.add(text)` only changes scene hierarchy. The integration test explicitly verifies that add/construction does not shape eagerly ([three-v1.test.mjs:720-735](../../../packages/glyph/tests/integration/three-v1.test.mjs#L720-L735)).

### Scene traversal, publication, and commit

7. Three's traversal reaches `Text.updateMatrixWorld()` after `super.updateMatrixWorld()` has made its world matrix current. A standalone attached `Text` creates/reuses an implicit one-text `ThreeTextBatchBinding`, reconciles, and synchronizes. A `Text` beneath the nearest live `TextGroup` returns and lets that group own the batch ([text.ts:461-500](../../../packages/glyph/src/three/text.ts#L461-L500)).
8. `TextGroup.updateMatrixWorld()` first delegates ordinary recursive matrix traversal to Three. It then collects non-disposed descendant `Text` objects, stopping at nested `TextGroup`s, validates that they share a coordinator, reconciles one group binding, and synchronizes once ([text.ts:639-660](../../../packages/glyph/src/three/text.ts#L639-L660), [1276-1304](../../../packages/glyph/src/three/text.ts#L1276-L1304)).
9. A `ThreeTextBatchBinding` owns one domain lease, `RenderPlanner`, `ThreeTextRenderPlanExecutor`, and map of public `Text` objects to engine `RetainedText` handles ([text.ts:694-756](../../../packages/glyph/src/three/text.ts#L694-L756)). Reconciliation creates, updates, removes, or reorders those retained handles and marks a publication pending ([785-832](../../../packages/glyph/src/three/text.ts#L785-L832), [960-1003](../../../packages/glyph/src/three/text.ts#L960-L1003)).
10. With semantic work pending, `synchronize()` calls `planner.publish()`. The planner offers a borrowed `PlanCandidate` synchronously to the executor and expires the plan immediately after `accept()` returns ([text.ts:894-925](../../../packages/glyph/src/three/text.ts#L894-L925), [render-planner.ts:720-736](../../../packages/glyph/src/internal/render-planner.ts#L720-L736)).
11. The executor decodes table rows, acquires portable payload leases, resolves Three programs/materials/transforms, stages resources and buffers, stages patches, creates or reuses meshes, prepares transforms, and applies retirements. `commit()` attaches new meshes to the batch draw root, removes obsolete meshes, swaps all retained maps, and disposes retired objects; rejection discards only candidate-owned objects and preserves the prior committed branch ([engine-plan-target.ts:473-608](../../../packages/glyph/src/three/engine-plan-target.ts#L473-L608), [1739-1771](../../../packages/glyph/src/three/engine-plan-target.ts#L1739-L1771)).
12. After acceptance, the batch advances each public `Text`'s committed revision and publishes measurement caches, then synchronizes current transforms ([text.ts:917-924](../../../packages/glyph/src/three/text.ts#L917-L924)).

### Transform-only frames and actual drawing

13. With no pending semantic publication, the batch skips `planner.publish()` and calls only `syncTransforms()`. That method updates render order, relative matrices/visibility, and either an indexed storage attribute or direct draw matrices ([text.ts:903-906](../../../packages/glyph/src/three/text.ts#L903-L906), [engine-plan-target.ts:384-449](../../../packages/glyph/src/three/engine-plan-target.ts#L384-L449)). Existing integration evidence verifies zero Rust crossings for no-op work and a single transform-buffer version increment for one moved text ([three-v1.test.mjs:1255-1259](../../../packages/glyph/tests/integration/three-v1.test.mjs#L1255-L1259), [1315-1339](../../../packages/glyph/tests/integration/three-v1.test.mjs#L1315-L1339)).
14. Glyph does not submit the Three render pass. The executor has attached retained `Mesh` draw proxies to the `Text` or `TextGroup` root. The application's `WebGPURenderer.render(scene, camera)` performs scene traversal, render-list construction, buffer/texture upload through Three, and GPU submission. This distinction is observable in tests: after `scene.updateMatrixWorld()`, meshes are children of the group and carry the Rust-produced instance count ([three-v1.test.mjs:728-759](../../../packages/glyph/tests/integration/three-v1.test.mjs#L728-L759)).

### Disposal

15. `Text.dispose()` unbinds its batch, releases font/transform/domain leases, and leaves scene removal to the caller ([text.ts:485-492](../../../packages/glyph/src/three/text.ts#L485-L492)). `TextGroup.dispose()` disposes only its batch, unbinding but not disposing descendant `Text` objects ([662-667](../../../packages/glyph/src/three/text.ts#L662-L667), [three-v1.test.mjs:788-804](../../../packages/glyph/tests/integration/three-v1.test.mjs#L788-L804)). Planner disposal cascades target disposal and all retained renderer state ([text.ts:927-957](../../../packages/glyph/src/three/text.ts#L927-L957)).

## 2. Verified current lifecycle: R3F

### Font loading and ownership

1. `useFont()` uses R3F's Suspense `useLoader` cache with one constructor-memoized `ReactFontLoader`. R3F keys the cache by
   the loader constructor plus the explicit canonical request key; `ReactFontLoader.load()` overrides the Three adapter
   and calls root `loadFont()` directly rather than invoking `THREE.FileLoader` or the parent `FontLoader.load()`
   ([react.ts:325-353](../../../packages/glyph/src/react.ts#L325-L353),
   [400-478](../../../packages/glyph/src/react.ts#L400-L478), [R3F webgpu index.mjs:1083-1139](../../../packages/glyph/node_modules/@react-three/fiber/dist/webgpu/index.mjs#L1083-L1139)).
2. The memoized React loader owns one source `Font` lease per resolved request. Every mounted hook consumer creates an
   independent clone through `createMountedFontStore()` and releases that clone when its final subscriber unmounts
   ([react.ts:481-508](../../../packages/glyph/src/react.ts#L481-L508)). StrictMode and sibling-consumer tests verify balanced,
   independent leases ([react-lease-lifecycle.test.mjs:144-190](../../../packages/glyph/tests/integration/react-lease-lifecycle.test.mjs#L144-L190),
   [193-213](../../../packages/glyph/tests/integration/react-lease-lifecycle.test.mjs#L193-L213)).

### React render and commit

3. During React render, outer `<Text>` flattens strings, numbers, arrays, and nested `<Text>` elements into one string plus grapheme-aligned spans. Nested `<Text>` does not mount a Three object and may use only inline properties ([react.ts:138-155](../../../packages/glyph/src/react.ts#L138-L155), [442-509](../../../packages/glyph/src/react.ts#L442-L509)).
4. `TextObject` captures constructor arguments once with `useState`. R3F constructs the actual Three `Text` during host commit through the extended element. A small external store publishes the committed object back to the wrapper/ref ([react.ts:157-182](../../../packages/glyph/src/react.ts#L157-L182), [196-201](../../../packages/glyph/src/react.ts#L196-L201)).
5. In a layout effect, changed semantic props call `object.set()`, changed capacity calls `setCapacity()`, and the wrapper calls R3F `invalidate()` ([react.ts:184-194](../../../packages/glyph/src/react.ts#L184-L194)). `TextGroup` follows the same construction pattern; its layout effect updates capacity/material and invalidates ([react.ts:219-265](../../../packages/glyph/src/react.ts#L219-L265)).
6. `invalidate()` requests host work; it does not shape or render synchronously. The wrapper has no `useFrame`, no plan target, and no renderer call. This is the key separation between React commit and Glyph publication.

### R3F frame, traversal, and drawing

7. On the requested frame, the installed R3F scheduler calls the configured actual renderer with its scene and camera ([R3F index.mjs:14463-14488](../../../packages/glyph/node_modules/@react-three/fiber/dist/index.mjs#L14463-L14488)). The installed Three renderer performs `scene.updateMatrixWorld()` before render-list construction when matrix auto-update is enabled ([Renderer.js:1598-1615](../../../packages/glyph/node_modules/three/src/renderers/common/Renderer.js#L1598-L1615)). That traversal invokes the same imperative `Text`/`TextGroup` lifecycle above.
8. Therefore the current order is: React commits desired state -> layout effect calls `Text.set()`/`TextGroup` setters -> `invalidate()` schedules a frame -> R3F calls Three's renderer -> Three traverses matrices -> Glyph publishes or syncs transforms -> Three observes the retained draw meshes and submits them.
9. R3F owns unmount disposal of the committed Three objects. Repository tests verify that unmounting returns every paragraph/domain lease, including StrictMode replay, while a mounted `Text` can keep the domain alive after the user releases their font/loader handles ([react-lease-lifecycle.test.mjs:57-142](../../../packages/glyph/tests/integration/react-lease-lifecycle.test.mjs#L57-L142)).

One subtle ordering fact matters for the redesign: `TextGroup.updateMatrixWorld()` calls `super` first, so child matrices are current before the group publishes and calls `syncTransforms(true)`. Moving publication into a React effect would lose that guarantee and would perform work for commits React may later discard.

## 3. Verified current lifecycle: example renderer

1. The application explicitly creates a `GlyphEngine`, passes it to `ExampleTextEngine`, and optionally supplies a renderer device. The example creates one backend, installs one policy, and owns one plan target ([example engine.ts:57-74](../../../packages/glyph-example-renderer/src/engine.ts#L57-L74)).
2. `bindFont()`/`bindFontStack()` bind immutable root fonts to that backend and reject techniques unsupported by the selected shader ([example engine.ts:76-104](../../../packages/glyph-example-renderer/src/engine.ts#L76-L104)).
3. `openPlanner()` creates the engine's single planner and attaches `ExamplePlanTarget`. `createText()` creates a retained engine text; `ExampleText.update()` changes desired state without publishing ([example engine.ts:106-129](../../../packages/glyph-example-renderer/src/engine.ts#L106-L129), [164-203](../../../packages/glyph-example-renderer/src/engine.ts#L164-L203)).
4. `publish()` synchronously publishes and throws if the target rejects; after acceptance it returns the target's last decoded draw list ([example engine.ts:131-135](../../../packages/glyph-example-renderer/src/engine.ts#L131-L135)).
5. The pre-change `readCandidate()` copied operational tables. The migrated target instead delegates admitted plan mapping,
   stable identity, resolver leases, and default decoding to core `createEngine()`. Its device walks the borrowed bound
   hierarchy during `prepare()` and retains only accepted renderer-owned draw/buffer/resource state
   ([glyph-plan-target.ts](../../../packages/glyph/src/internal/glyph-plan-target.ts),
   [device.ts](../../../packages/glyph-example-renderer/src/device.ts)).
6. Without a device, the target stores the decoded list and accepts it. With a device, it acquires missing portable payload leases, validates technique compatibility, stages and commits resources, stages and commits the whole submission, then publishes the new list/maps and releases payloads no longer referenced by the accepted resource generations ([example engine.ts:255-328](../../../packages/glyph-example-renderer/src/engine.ts#L255-L328)).
7. A preparation or submission failure discards candidate state and releases newly acquired leases; the target returns a rejection rather than corrupting its previous accepted state ([example engine.ts:292-313](../../../packages/glyph-example-renderer/src/engine.ts#L292-L313), [329-332](../../../packages/glyph-example-renderer/src/engine.ts#L329-L332)).
8. `ExampleTextEngine.dispose()` disposes its backend; backend/planner ownership cascades target and payload disposal ([example engine.ts:145-151](../../../packages/glyph-example-renderer/src/engine.ts#L145-L151), [335-353](../../../packages/glyph-example-renderer/src/engine.ts#L335-L353)).

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

The exact source hierarchy is:

```ts
interface TypedGroup {
  readonly children: readonly TypedGroupChild[];
}

type TypedGroupChild = TypedBatch | TypedRootInstance;

interface TypedBatch {
  readonly kind: 'batch';
  readonly identity: BatchIdentity;
  readonly instances: readonly TypedInstanceSpan[];
}

interface TypedRootInstance {
  readonly kind: 'instance';
  readonly identity: InstanceIdentity;
  readonly transform: TransformIdentity | undefined;
}

interface TypedInstanceSpan {
  readonly identity: InstanceSpanIdentity;
  readonly kind: 'glyph' | 'decoration' | 'inline-object' | 'clip' | 'codec';
  readonly recordIndex: number;
  readonly recordCount: number;
  readonly logicalOrder: number;
}
```

The array notation describes the hierarchy. The production values are borrowed lazy read-only sequences backed by the
contiguous Rust plan: `length`, indexed access, `at(index)`, and iteration do not require a preparatory scan or a copied
object graph. `TypedGroup.children` preserves the exact Rust order and interleaving. A `TypedBatch` exposes only its ordered
instance-span range; a `TypedRootInstance` exposes only its identity and optional authored transform.

`BatchIdentity`, `InstanceIdentity`, `InstanceSpanIdentity`, and `TransformIdentity` are opaque retained objects. The
package-internal mapper may intern them from numeric wire IDs, but the numeric IDs and raw table/offset vocabulary never
reach `GlyphConfig.decode` or the renderer. The mapper retains only identity-to-plan-location associations; command scalar
data remains in the borrowed Rust publication and is accessed lazily.

The decode contract is:

```ts
type Decoder<Schema extends GlyphSchema> = (
  source: BorrowedTypedCommandBuffer,
  context: DecodeContext<Schema>,
) => BorrowedBoundCommandBuffer<Schema>;

declare const defaultDecoder: <Schema extends GlyphSchema>(
  source: BorrowedTypedCommandBuffer,
  context: DecodeContext<Schema>,
) => BorrowedBoundCommandBuffer<Schema>;
```

The engine package owns the fixed Rust-layout accessor/identity mapper, `defaultDecoder`, and borrowed-view enforcement.
That mapper is internal plumbing and is not another decoder. `GlyphConfig` owns decoder selection through a required
`decode` field. `ThreeConfig`, the example config, and other built-ins explicitly assign `decode: defaultDecoder`; a handle
always invokes the function selected by its config.

An advanced config may replace or wrap `defaultDecoder` type-safely. It receives the whole publication and returns the same
ordered hierarchy with values bound to its inferred schema: `drawRoot`, batch, root instance, instance span, transform,
and resource payloads. Useful work includes choosing renderer payloads, adding derived renderer metadata, or changing the
binding strategy. It cannot introduce another command-buffer dialect, expose raw numeric IDs, or install per-command
functors.

Neither the internal mapper nor a built-in decoder revalidates Rust's semantic decisions. The Wasm boundary mechanically
checks ABI/framing/bounds using generated layout types; after admission, group membership, kinds, ranges, and order are
trusted. A contradiction is an engine bug. Fallible external work still throws where written: `resolve`, a custom decoder,
renderer preparation, host binding lookup, or GPU/device operations.

The authoritative hookup order and zero-copy proof requirements live in
[the renderer-neutral integration plan](engine-integration-boundary.md#5b-expose-the-canonical-ordered-command-hierarchy).

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

| Value                                                        | Validity                                                                      | Retention rule                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Borrowed `TypedCommandBuffer`                                | Only during the synchronous `decode`/target callback                          | No field or byte view may escape. Current borrowed readers deliberately throw after acceptance ([render-planner.ts:720-736](../../../packages/glyph/src/internal/render-planner.ts#L720-L736), [1371-1419](../../../packages/glyph/src/internal/render-planner.ts#L1371-L1419)). |
| `BorrowedBoundCommandBuffer` and lazy sequences              | From decode through `renderer.prepare()` and its synchronous preparation only | Renderer must not store the frame or sequences. The private publication boundary expires them when `shape()` settles.                                                                                                                                                      |
| Write-patch `Uint8Array`                                     | Same lifetime as the bound frame                                              | Renderer must upload or copy it during preparation. The example device applies patches into candidate-owned retained buffers before commit ([device.ts](../../../packages/glyph-example-renderer/src/device.ts)).                                                             |
| Opaque resource/buffer/batch/instance/span/transform binding | Stable object identity for its live generation                                | Renderer may key retained maps by the object. It must not manufacture or numerically decode one.                                                                                                                                                                           |
| Newly resolved `ResourceLease`                               | Candidate-local until renderer commit                                         | The boundary calls `dispose()` on discard; successful commit promotes it to live retained state.                                                                                                                                                                           |
| Committed `ResourceLease`                                    | Until an accepted retirement, boundary disposal, or handle-domain teardown    | The boundary binder owns disposal. Renderer consumes `value` but does not independently release the lease.                                                                                                                                                                 |
| Prepared renderer transaction                                | One `shape()` attempt                                                         | Exactly one of `commit()` or `discard()` is called. Both must be idempotent after settling.                                                                                                                                                                                |
| Renderer result                                              | Config-defined preparation value                                              | Current `shape()` does not surface it. A future adapter return must be stable and self-owned, never plan bytes or cleanup closures.                                                                                                                                        |
| Async/worker plan                                            | Explicit owned-delivery path only                                             | The engine makes one contiguous owned copy. Bound fields that cross a realm must be self-owned/validated; borrowed bindings and realm-local provenance do not transfer ([render-planner.ts:739-789](../../../packages/glyph/src/internal/render-planner.ts#L739-L789)).       |

The publication order is resources -> buffers -> patches -> ordered group traversal -> retirements. The group phase must
distinguish `unchanged` from `replace`: an empty replacement retires the group contents, while a patch-only publication
leaves committed hierarchy intact. The default path uses indexed loops over borrowed sequences. Per-command functors would
obscure order, allocate on the hot path, and make lifetime and rollback behavior difficult to audit.

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

The current wrapper already shows exactly where the handle enters. `extend(ThreeText)` creates an R3F host element, and its `args` prop tells the R3F reconciler which arguments to pass when it constructs `ThreeText` during commit ([react.ts:126-127](../../../packages/glyph/src/react.ts#L126-L127), [168-170](../../../packages/glyph/src/react.ts#L168-L170), [196-201](../../../packages/glyph/src/react.ts#L196-L201)). The redesign does not need R3F to understand Glyph. It changes the package-private construction arguments from conceptually:

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

`Text` and `TextGroup` are triggers and hierarchy owners in that sketch; they do not contain the encoder, planner, decoder, resource stores, or renderer transaction. `shape()` is private boundary work coordinated through the handle. The calls are safe because the current overrides run after `super`, and the group override runs after recursive descendant traversal ([text.ts:461-483](../../../packages/glyph/src/three/text.ts#L461-L483), [639-660](../../../packages/glyph/src/three/text.ts#L639-L660)).

An R3F `useFrame` callback is not an equivalent first choice: the installed R3F registers ordinary `useFrame` jobs separately from its system render job ([R3F index.mjs:1131-1187](../../../packages/glyph/node_modules/@react-three/fiber/dist/index.mjs#L1131-L1187), [14463-14488](../../../packages/glyph/node_modules/@react-three/fiber/dist/index.mjs#L14463-L14488)), while Three performs the ordinary scene matrix update inside `render()` ([Renderer.js:1598-1615](../../../packages/glyph/node_modules/three/src/renderers/common/Renderer.js#L1598-L1615)). A generic pre-render hook therefore sees matrices before Three's normal traversal unless it duplicates or takes over that work. `Object3D.onBeforeRender` is also unsuitable as the primary boundary because it is per drawable, does not run for an empty `TextGroup`, and occurs after draw realization needs to be ready. A renderer wrapper could create a stronger explicit phase—update matrices, shape dirty boundaries, then render with duplicate traversal suppressed—but that is more invasive and should be justified by an experiment rather than assumed necessary.

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
| Multiple handles in one scene                          | Allowed in separate `Text`/`TextGroup` branches. Each retained object is constructed by exactly one handle.                                                             | Handles may select different configs, programs, decoders, and resource pools.                                              | One `TextGroup` cannot mix handles; current code similarly rejects different coordinators ([text.ts:1295-1304](../../../packages/glyph/src/three/text.ts#L1295-L1304)). |
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

`ThreePrimitiveBinding` and `ThreeDrawBinding` are object identities, not public numeric IDs. The renderer maps them to actual `InstancedBufferGeometry` and `Mesh` objects. A direct `Object3D` was considered a suitable transform binding because the pre-change Three coordinator resolved opaque engine transform bindings through a `WeakMap`; that historical coordinator source was removed by D-306.

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

The pre-change Three coordinator installed a policy and retained the exact capability set. That historical source was removed by D-306; the current Codec construction is documented in the renderer integration guide.

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

`defineEncode()` is the valuable generic utility: it validates and compiles the Codec descriptor, ensures that the declared capability set matches the config, and prevents host objects such as `Texture`, `Material`, or `Mesh` from entering the engine input. The current implementation already has reusable builders for schemas, buffers, raster programs, transform modes, and allocation modes ([codec.ts:1-20](../../../packages/glyph/src/three/codec.ts#L1-L20), [51-122](../../../packages/glyph/src/three/codec.ts#L51-L122)).

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

`expectTextureArray()` and `expectGeometry()` were proposed to own portable-payload validation. The executor evidence remains in `engine-plan-target.ts`; the historical coordinator cache source was removed when D-306 internalized handle/root ownership.

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

In the real type, `BoundBufferCommand` would omit its already-bound `buffer` parameter when used as a factory input; the handle binder would associate the returned attribute with the opaque buffer binding. `ThreeBufferStore.ensure()` should additionally enforce alignment, tight packing, generation replacement, and maximum shape once. `applyBoundPatches()` then owns byte views, range merging, `needsUpdate`, and PBO invalidation. These operations already form a coherent seam in the executor ([engine-plan-target.ts:680-793](../../../packages/glyph/src/three/engine-plan-target.ts#L680-L793), [2410-2451](../../../packages/glyph/src/three/engine-plan-target.ts#L2410-L2451)).

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

Those helpers are direct extractions of current working behavior, not new abstraction for its own sake ([engine-plan-target.ts:976-995](../../../packages/glyph/src/three/engine-plan-target.ts#L976-L995), [1987-1997](../../../packages/glyph/src/three/engine-plan-target.ts#L1987-L1997), [2470-2478](../../../packages/glyph/src/three/engine-plan-target.ts#L2470-L2478)). The material helper remains compatible with the existing `defineTextMaterial(context => NodeMaterial)` extension point, so a user-supplied material customizes one material factory instead of reimplementing `renderer` ([material.ts:5-39](../../../packages/glyph/src/three/material.ts#L5-L39)).

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

`prepareRendererCommit()` is the most important helper. Each store registers candidate additions, committed replacements, and discard cleanup; `finish()` returns one `PreparedRendererCommit`. No store publishes early. This is the reusable form of the current `PreparationContext`/`PreparedPublication` split and the example renderer's `prepareResources()` plus `prepareSubmission()` flow ([engine-plan-target.ts:205-229](../../../packages/glyph/src/three/engine-plan-target.ts#L205-L229), [473-608](../../../packages/glyph/src/three/engine-plan-target.ts#L473-L608), [example engine.ts:274-313](../../../packages/glyph-example-renderer/src/engine.ts#L274-L313)).

`ThreeDrawStore` retains a map across publications for reuse and retirement, not to deduplicate repeated draws within one frame. A replacement builds a fresh candidate map: each unique draw binding either stages an update/reuse of its committed mesh or creates a candidate mesh; committed entries absent from the replacement retire only at commit. An `unchanged` phase leaves that map untouched. A `replace` phase containing the same draw binding twice throws instead of silently skipping the second record.

`ThreeTransformStore` should retain the actual `Object3D` bindings, draw membership, one `Matrix4` inverse scratch value, and one indexed `StorageInstancedBufferAttribute`. Its `sync()` computes matrices relative to the draw root and touches only direct mesh matrices or the indexed transform attribute. This preserves the current transform-only path without giving `Text` its own encoder or decoder ([engine-plan-target.ts:384-449](../../../packages/glyph/src/three/engine-plan-target.ts#L384-L449), [1700-1737](../../../packages/glyph/src/three/engine-plan-target.ts#L1700-L1737), [2439-2463](../../../packages/glyph/src/three/engine-plan-target.ts#L2439-L2463)).

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

The draw root also predates resolution. Imperative `handle.createText()` or the R3F constructor seam creates the retained `Text`; that object is the standalone draw root. Creating a `TextGroup` creates the possible group draw root. When a private boundary is formed, it chooses `drawRoot = group ?? seed` and constructs the config renderer with that already-existing object. This is current behavior in `ThreeTextBatchBinding` ([text.ts:718-735](../../../packages/glyph/src/three/text.ts#L718-L735)). `resolve` then creates only portable-resource realizations such as textures or supplied geometry. Later, the bound draw phase tells the config renderer which geometry, material, buffers, and transforms form each generated mesh. Transactional commit attaches only those renderer-owned meshes with `drawRoot.add(mesh)` and removes retired ones with `removeFromParent()` ([engine-plan-target.ts:565-582](../../../packages/glyph/src/three/engine-plan-target.ts#L565-L582)).

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

The current executor proves the resolver side: `#bitmapTexture()` and `#msdfAtlas()` call `new THREE.DataArrayTexture(...)`, set metadata, and mark `needsUpdate`; they do not receive a renderer or canvas ([engine-plan-target.ts:1390-1430](../../../packages/glyph/src/three/engine-plan-target.ts#L1390-L1430)). The actual `WebGPURenderer` later observes the texture through a material. Its renderer-local `Textures` manager asks the backend to create/update device resources ([Textures.js:204-216](../../../packages/glyph/node_modules/three/src/renderers/common/Textures.js#L204-L216), [308-355](../../../packages/glyph/node_modules/three/src/renderers/common/Textures.js#L308-L355)), and the WebGPU backend ultimately calls `device.createTexture()` ([WebGPUTextureUtils.js:390-403](../../../packages/glyph/node_modules/three/src/renderers/webgpu/utils/WebGPUTextureUtils.js#L390-L403)). This is the relevant late binding.

The scene is not an allocation context. It is the existing `Object3D` hierarchy that determines which retained objects Three traverses. The handle and resolver do not need to know which scene eventually contains a `Text`; moving that object between parents remains ordinary Three behavior plus the existing private-boundary rebind rules.

### When the canvas is created

Application code or R3F normally creates/provides the canvas as part of creating the host renderer. If no canvas parameter is supplied, installed Three's backend creates one when `Renderer` constructs its default `CanvasTarget`: the renderer calls `backend.getDomElement()`, whose lazy getter creates the element on that first request ([Renderer.js:286-293](../../../packages/glyph/node_modules/three/src/renderers/common/Renderer.js#L286-L293), [Backend.js:696-711](../../../packages/glyph/node_modules/three/src/renderers/common/Backend.js#L696-L711)). That timing is independent of `handle.createText()`, `shape()`, `decode`, and Three `resolve`.

In the installed WebGPU backend, `renderer.init()` obtains or accepts a `GPUDevice` without first requiring a canvas context ([WebGPUBackend.js:214-283](../../../packages/glyph/node_modules/three/src/renderers/webgpu/WebGPUBackend.js#L214-L283)). The `GPUCanvasContext` is obtained and configured when the backend's presentation context is first needed ([WebGPUBackend.js:326-365](../../../packages/glyph/node_modules/three/src/renderers/webgpu/WebGPUBackend.js#L326-L365)); `getCurrentTexture()` is then used while preparing the default render-pass attachment ([WebGPUBackend.js:463-483](../../../packages/glyph/node_modules/three/src/renderers/webgpu/WebGPUBackend.js#L463-L483)). Thus a canvas is required for presenting to that canvas, not for `new THREE.DataArrayTexture()` and not for raw `GPUDevice.createBuffer()`/`createTexture()`. Ordinary `GPUTexture` and `GPUBuffer` values are device-bound, not canvas-bound; the special texture returned by `GPUCanvasContext.getCurrentTexture()` is the per-frame presentation resource.

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

## Implemented FontFace direction after the handle implementation

D-296 supersedes D-295's source-list and root-relative loading sketches with one canonical two-argument declaration and
handle-relative format resolution. D-301 corrects the method placement: the selection owns `load(handle)` and
`isLoaded(handle)`; no `load()` method is added to `GlyphHandle`. The FontFace surface, fail-fast Three construction,
typed config technique map, conditional React suspension, hook-managed Font leases, and optional provider `fontFaces`
aliases described below are implemented. D-297's complete content-addressed multi-tier dependency graph and the proposed
zero-flag CLI bake default remain separate work and are not claimed by this section.

### Simplest form

The smallest declaration is the source itself. Glyph generates a monotonic unused family name such as `Font1`. Omitting
`format` exposes no keyed technique members; aggregate loading discovers every imported technique advertised by the main
font, and the consuming handle chooses its configured default only when Text binds the face:

```ts
const MyFont = glyph.fontFace('./my-font.glb');

await MyFont.load();

const label = three.createText({
  font: MyFont,
  text: 'Hello',
});

scene.add(label);
```

`MyFont` and `MyFont.default` identify the same aggregate/default selection. Built-in `ThreeConfig` resolves that selection
to MSDF, while a spread/wrapped config may choose another key from its own typed technique map. `face.load()` is idempotent
and resolves to that same face, so `font: await MyFont.load()` is equivalent. Constructing or updating imperative `Text`
with an unloaded selected technique throws synchronously instead of creating a temporarily empty object.

The corresponding minimal R3F form keeps declaration and loading declarative:

```tsx
function Label() {
  const font = useFont('./my-font.glb');
  return <Text font={font}>Hello</Text>;
}
```

`useFont(source, config?)` is the React wrapper around `glyph.fontFace(source, config?)`. It retains one declaration for
that canonical source/config key, loads it through the selected handle, suspends while needed, and returns an independently
mounted immutable `Font<Technique>` lease. `useFont.preload(source, config?)` creates the same declaration and starts the
same stable load early. Ordinary React Suspense and error boundaries around the component own loading UI.

### Canonical declaration and inferred identity

The canonical overload always keeps the source first and one optional `FontFaceConfig` second:

```ts
const MyFont = glyph.fontFace('./my-font.glb', {
  format: ['slug', 'msdf'],
});

MyFont.default === MyFont;
MyFont.slug !== MyFont;
MyFont.msdf !== MyFont;
```

`family` is optional. An omitted family becomes `Font{id++}` using a realm-local monotonic counter that skips an occupied
name and never rewinds on disposal. An explicit family supplies the catalog name:

```ts
const Inter = glyph.fontFace('./Inter.font.glb', {
  family: 'Inter',
  format: ['slug', 'msdf'],
});
```

`format` accepts a string key, an imported renderer-neutral technique, an exact technique request, or a nonempty array of
those forms. The first entry is the default used when the aggregate face is bound. The const-generic result projects every
literal key/kind into a stable typed selection member. Every technique member is distinct from the aggregate face because
their load scopes differ. Third-party techniques participate through the same imported witness; a declared string key must
resolve to an imported technique before it can load.

The ordinary aliases remain plain selections:

```ts
const Body = Inter.bitmap;
const Copy = Inter;
const Title = Inter.slug;
```

### Format options are a bake contract

The current immutable loader derives an exact raster key from the technique descriptor and first asks the GLB for that
reference. It runtime-bakes only after an exact miss and only when retained source bytes plus a matching runtime baker are
available. D-296 preserves and raises that invariant to FontFace:

- a baked GLB declaring `bitmap({ strikes: [8, 16] })` must contain that exact descriptor;
- a GLB cannot be silently re-baked because it contains no TTF/OTF source bytes;
- a TTF/OTF source may be runtime-baked with stated options or the technique's documented defaults;
- one source declaration that promises several formats is validated against the artifact directory when that source is
  opened; and
- an external raster reference in that directory is the sidecar to load, not a second author-declared source candidate.

A URL or Request supplies the base needed to resolve a relative sidecar. A bare Blob or byte source has no such base, so
its sidecars must be embedded or named by absolute references. Failure to authenticate the requested descriptor or load
its declared sidecar rejects that exact selection with source and technique provenance; there is no ordered fallback list
inside one FontFace.

Production should normally receive pre-baked GLBs. A Vite integration may discover FontFace declarations and build the
exact source/format graph ahead of time; runtime baking remains the source-font fallback, not the normal production path.

### One load boundary and fail-fast Text

There is no separate preload operation and no public readiness subscription. Loading is owned by the FontFace declaration
and its declared technique selections. A handle is consulted later to select a default and bind an immutable Font into
Text. The relevant contract is:

```ts
interface GlyphConfig<Formats extends TechniqueMap, Default extends keyof Formats> {
  readonly fonts: {
    readonly techniques: Formats;
    readonly default: Default;
  };
  // encode, decode, resolve, renderer, and constructors omitted here
}

interface FontFaceSelection<Format> {
  load(): Promise<FontFaceSelection<Format>>;
  isLoaded(): boolean;
}

interface FontFace<Formats> {
  readonly default: this;
  load(): Promise<this>; // all declared, or all imported advertised formats
  isLoaded(): boolean;
}
```

The implemented `fonts.techniques` and `fonts.default` fields preserve the required type-level invariant: the default is a
key of the same technique map. An omitted FontFace resolves to that key when bound; an explicit literal key must resolve to
an imported technique and still be supported by the consuming handle. Built-in `ThreeConfig` supplies Bitmap, MSDF, and
Slug and defaults to MSDF:

```ts
const SlugFirstConfig = {
  ...ThreeConfig,
  fonts: { ...ThreeConfig.fonts, default: 'slug' },
} satisfies GlyphConfig<typeof ThreeConfig.fonts.techniques, 'slug'>;

const three = glyph.handle('three-slug', SlugFirstConfig);
await Inter.load();

await Promise.all([Inter.bitmap.load(), Inter.msdf.load(), Inter.slug.load()]);
```

`Inter.isLoaded()` checks aggregate readiness without starting work. Technique members check exact selections. Each stable
operation resolves to the object on which it was called, and the FontFace retains the resulting cache lease. For an
undeclared face, aggregate readiness means all imported formats advertised by the main font have loaded; handle-specific
readiness remains an internal binding-store query because different handles may select different defaults.

Imperative Three remains synchronous. Its constructor and `Text.set({ font })` validate that every root, fallback, and span
selection is loaded before acquiring private immutable Font bindings. An unloaded face or named lookup throws at that call
without mutating desired state, creating a planner entry, or changing the last accepted draw. Callers therefore write:

```ts
await Inter.load();
const label = three.createText({ font: Inter, text: 'Hello' });
```

or select another format directly:

```ts
const title = three.createText({
  font: await Inter.slug.load(),
  text: 'Title',
});
```

This removes the frame-scheduling problem rather than adding a second synchronization protocol. There is no pending `Text`
that needs an invalidation callback: imperative code awaits before construction, and a failed update leaves the current
text intact.

R3F accepts direct FontFace selections and root-catalog family strings on `Text`. Its `useFont(source, config?)` hook is
instead the declarative counterpart of `glyph.fontFace(source, config?)`: the React integration creates or retrieves one
FontFace declaration keyed by the same canonical arguments, then resolves its default or explicitly requested format
through the selected handle. Omitted `format` uses that handle's configured default; explicit string keys, imported
techniques, and exact requests retain the same inference and validation as the root call.

React asks the selected handle's internal binding store whether the exact selected technique is loaded. A loaded selection
takes the synchronous fast path. An unloaded selection takes the Suspense path by conditionally calling `use()` on that
store's stable exact-technique operation; React 19 permits conditional `use()`. After the load, `useFont` acquires an
independent mounted immutable `Font<Technique>` lease. The hook subscription disposes that lease after its last mounted
subscriber unmounts, including StrictMode replay, without disposing the shared declaration.

The graph commits the fully decoded selection and face-owned lease before fulfilling the load Promise. Therefore the
rerender after resolution observes exact handle readiness and skips `use()` entirely—there is no fulfilled Promise
allocation, observation, microtask wait, or Suspense pass on the loaded path.

`useFont.preload(source, config?)` creates the same cached declaration and starts the same stable handle load before a
component requests it; the hook consumes that operation or starts it itself. `useFont.clear(source, config?)` removes and
disposes the cached declaration owner, but independent mounted Font and Text leases remain valid until their own cleanup.
This small React declaration cache owns hook declaration identity and disposal only. The Glyph-owned FontFace and
FontLibrary own decoded Font values, while the handle-local store owns exact technique selection and mounted acquisition.
D-297's finer-grained
content-addressed dependency graph remains follow-up work.

`GlyphProvider` remains optional immutable constructor dependency injection. It can override the handle and can add local
family aliases without adding another loading policy or semantic cache:

```tsx
<GlyphProvider
  handle={customThree}
  fontFaces={{
    Inter: './Inter.font.glb',
    Title: { src: './Title.font.glb', format: 'slug' },
  }}
  fallback={null}
>
  <Text font="Inter">Hello</Text>
</GlyphProvider>
```

The provider captures `handle` and `fontFaces` once; changing either requires a keyed remount. It disposes only FontFaces
it declared from the table, never an externally supplied handle or face. Supplying `fontFaces` or `fallback` installs a
local Suspense boundary; supplying `errorFallback` installs a boundary that handles `FontLoadError` and rethrows unrelated
application/renderer errors. Without a provider, the module selects its shared default Three handle. A static
`useFont.preload(source, config?)` primes that default handle and returns the real `Promise<void>`; advanced code with a
custom handle can load the declaration or exact member before rendering with `void faceSelection.load()`.

Imperative Three remains different because it has no Suspense boundary: constructing or updating Text with an unloaded
selection throws and tells the caller to await `selection.load()` first.

### Ownership and disposal

FontFace adds a cache owner without replacing D-286's immutable loaded `Font` ownership:

- the FontFace strongly owns each successfully loaded format's cache lease so named lookup remains deterministic;
- `face.load()` resolves to the same stable aggregate face, while `face.slug.load()` resolves to the same stable exact
  technique selection; neither creates a caller-owned lease;
- loading state and stable promises are indexed by authenticated technique identity; a handle only selects and binds one
  of those loaded techniques;
- each mounted/bound `Text` acquires its own private engine/renderer binding lease;
- `FontFace.dispose()` aborts pending source work, removes its catalog registration, publishes `disposed`, and releases all
  face-owned cache leases;
- Fonts acquired through the low-level `loadFont()` API and committed renderer bindings remain valid until their
  independent owners release them;
- the root family catalog retains only a `WeakRef`; explicit `FontFace.dispose()` is the deterministic correctness path,
  while `FinalizationRegistry` is a best-effort safety net for an unreachable undisposed declaration, never refcount timing.

### Review against the original plan

| Original plan or current evidence                                                                 | D-296 result                                                                                                                                              | Consequence                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| D-286 makes loaded `Font<Technique>` immutable and independently leased.                          | Preserved internally and in low-level `loadFont()`. FontFace owns its cache lease, while Text acquires a private binding lease.                           | Face disposal releases its cache without invalidating mounted text.                                                                            |
| D-293 lets immutable fonts bind into multiple handles.                                            | Preserved. The root face is renderer-neutral; each handle resolves its configured default/key and independently binds the Font.                           | Binding readiness and key meaning are handle-relative; a family and its loaded techniques are not owned by Three, R3F, a scene, or a renderer. |
| D-294 makes React context immutable constructor injection.                                        | Extended from a bare handle to `{ handle, fontFaces }`, captured once; the map contributes local aliases only.                                            | Provider aliases do not create another runtime or mutable context.                                                                             |
| D-287 uses R3F `useLoader` as the existing font promise cache.                                    | Superseded for FontFace selections by Glyph-owned loads; the current hooks declare FontFaces and suspend on an exact handle-selected technique operation. | React and imperative code share loaded FontFace records without another semantic cache.                                                        |
| `loadFont()` currently requires exact technique options and can runtime-bake after a raster miss. | Preserved as the low-level invariant behind format declarations.                                                                                          | Declared options validate baked artifacts and drive source-font runtime/unplugin baking.                                                       |
| `defineFont()` is the current static discovery token.                                             | Not required for FontFace declarations; discovery can read `glyph.fontFace()` calls and their source/format graph.                                        | Ordinary named-font authoring has no duplicate token ceremony.                                                                                 |
| The current direct CLI emits shaping-only output when no raster flags are supplied.               | Proposed separately: zero flags would bake Bitmap 8/16, MSDF, and Slug. Built-in `ThreeConfig` already uses MSDF as its default key.                      | FontFace loading does not claim this CLI-default change until its own bake checks are implemented.                                             |

### Smallest implementation proofs

1. Bake with no raster flags and authenticate one embedded Bitmap descriptor with strikes 8/16, one MSDF descriptor, and
   one Slug descriptor; prove any explicit raster flag set replaces that bake set.
2. Type-check `glyph.fontFace(source)` and `{ family, format }` forms, generated family uniqueness, explicit-default object
   identity, exact custom-technique members, and rejection of an empty format array.
3. Resolve the same omitted-format face through built-in MSDF-default `ThreeConfig` and an otherwise identical Slug-default
   config; prove each handle gets exact style capabilities and independent load state without changing the root face.
4. Load an external GLB raster sidecar relative to a URL/Request, then reject the same relative reference from a bare Blob;
   prove an embedded or absolute Blob reference succeeds.
5. Reject a baked source whose declared Bitmap options do not match its raster directory; feed a TTF declaration to the
   runtime baker and prove the exact request receives those options.
6. Construct and update imperative Three `Text` with an unloaded face and prove each call throws before shaping, desired
   state mutation, or draw retirement; await `selection.load()` and prove the same selection then succeeds.
7. Mount provider shorthand plus `font="Inter"` under Suspense and StrictMode, prove one stable selection load, immutable
   context, balanced leases, and no Three `Text` construction before resolution; omit `fontFaces` and prove a direct
   FontFace or root-catalog family uses the same readiness branch without requiring a provider.
8. Reject one mapped font load through the provider's font fallback, then throw an unrelated child/renderer error and
   prove the provider rethrows it to an outer boundary.
9. Load several formats through two handles, acquire one low-level independent Font and one mounted Text binding, dispose
   the FontFace, and prove its cache leases release while the independent Font and committed draw remain valid.

## Content-addressed FontFace resource graph

D-297 answers the cache and invalidation questions that D-296 left implicit. The current implementation provides several
pieces of the required behavior but not the complete graph:

- `FontLoader` coalesces loads by a normalized request key while its registered font remains alive.
- top-level `loadFont()` coalesces only an in-flight exact composite request; `FontLibrary` retains successful exact
  composite requests and returns independent leases;
- `FontRegistry` merges an artifact with an equal authenticated shaping hash only inside that registry;
- a registered font retains one loaded raster by `rasterKey`, but it does not coalesce concurrent external-raster fetches;
- `RegisteredRaster.resource()` authenticates external bytes by declared length and SHA-256 but does not memoize the
  promise or successful bytes; and
- the runtime Worker persistently caches only a complete validated baked GLB, keyed by source hash, face, normalized
  ranges, and exact raster plan, and only while the source response grants reusable freshness.

Consequently, two current immutable loads that request different techniques from the same URL can fetch and parse the
core GLB independently. Repeated direct reads of one external page fetch it repeatedly; the loader integration test
currently proves this by observing the same `page.bin` request twice. Technique decode normally hides that weakness after
one immutable variant is retained, but a second FontFace/request graph can pay the work again. Current `FontLibrary.clear()`
also evicts one whole composite request rather than one reachable resource generation.

The replacement is one Glyph-owned internal dependency graph:

```text
family alias ───────┐
generated Font{id} ─┴─> FontFace declaration lease
                           │
URL / Request / Blob locator
                           │ fetch/read + authenticate
                           ▼
                    core GLB content hash
                     │       │        │
              shaping data   │   raster directory
                             │        │ selected lazily by rasterKey
                             │        ▼
                             │  raster artifact hash
                             │        │
                             │        ├─> resource hash + byte length
                             │        └─> resource hash + byte length
                             │
                             └─> decoded technique node
                                      │
                                      └─> handle-local resolve/renderer binding
```

The family name never appears in an identity key. A locator only answers where bytes may be fetched. Equal ordinary URL
requests coalesce their transport operation; Requests with materially different method, headers, credentials, integrity,
or cache semantics must not be conflated. Blob/byte object identity can coalesce before hashing. Once bytes arrive, their
SHA-256 content owns the immutable node, so different locators with equal bytes may converge and one locator that later
serves different bytes creates a new generation. Each acquisition edge retains its own source context—base URL, Request
semantics, fetch implementation, and resolver—so two equal core GLBs from different directories can share parsing without
incorrectly resolving a relative sidecar against the other face's base. Sidecar byte nodes converge only after their own
declared hashes authenticate.

The GLB directory is the dependency manifest. Loading its selected external raster reference fetches that artifact lazily
and authenticates it against the directory's declared hash. A raster decoder requests only the external page/resources it
needs; each is cached by declared SHA-256 plus byte length, with one shared pending promise and one immutable successful
value. A failed promise is removed rather than poisoning the key. If two directory entries reuse identical bytes, they
share the resource node even when their relative URIs differ.

Decoded state adds the immutable core/raster identities and the authenticated technique witness identity. A config string
such as `slug` is only a map lookup and cannot own the cache because two handles may assign the same string differently.
Renderer resources are further downstream and remain handle/config-local; equal portable bytes do not imply that two
renderer bindings, GPU devices, or contexts are interchangeable.

### Lease-based invalidation

Fine-grained invalidation means releasing graph reachability, not deleting by family name or mutating a cached value:

- each successful aggregate or technique-member `load()` gives the owning FontFace a lease on the selected decoded node and its
  transitive dependencies;
- immutable `Font` values, mounted `Text`, and renderer bindings take independent leases;
- `FontFace.dispose()` removes its catalog aliases, aborts work for which it is the final consumer, and releases only its
  leases;
- a child node retires only when no live dependent reaches it;
- disposing one of two faces over the same URL therefore cannot evict the other's core GLB, raster, or page resources; and
- after the final lease retires, a later declaration may refetch the locator. If it produces new bytes, the new content
  generation replaces the locator mapping for future consumers while old mounted consumers continue using the old
  immutable generation.

This does not require a public cache-invalidation API in the first FontFace implementation. `FontFace.dispose()` plus
ordinary HTTP freshness is sufficient for deterministic ownership. A later explicit refresh API, if evidence requires
one, must create a new generation and cannot invalidate live immutable Fonts in place.

### Runtime baking is a source-type edge

Runtime baking is not recovery from a GLB raster miss. The source bytes are classified and authenticated at the load
boundary:

- valid GLB bytes enter the artifact graph; a missing or mismatched selected format throws at `selection.load()`;
- valid TTF/OTF SFNT bytes enter the runtime-bake graph;
- WOFF, WOFF2, arbitrary bytes, and misleading filename/content-type combinations throw unless a future explicit source
  capability supports them.

The check must use the bytes' container signature, not only the URL suffix or Blob MIME type. A `.glb` URL that contains a
TTF and a `.ttf` URL that contains a GLB are malformed inputs rather than alternate cache names.

Within one Glyph runtime, every completed runtime bake is retained in memory while any FontFace or downstream consumer
leases it. Its identity includes source SHA-256, collection face, normalized Unicode ranges, exact requested format
descriptors/raster keys, and all format/baker contract versions. Therefore two equivalent TTF/OTF requests bake once;
different Bitmap strike contracts or other exact options intentionally produce different nodes. The existing optional
CacheStorage layer may preserve the same complete validated GLB across page lifetimes only when the source response's
cache headers permit reuse; `no-store`, absent freshness, quota, and private contexts cannot weaken the guaranteed
in-process cache.

### Required cache proofs

1. Declare two differently named FontFaces over one URL, load the same selection concurrently, and observe one core fetch,
   one parse, one selected raster fetch, one decode, independent face leases, and no family-name key.
2. Load MSDF through one face and Slug through another over the same core URL; observe one core fetch/parse and only each
   selected external raster/resource subtree.
3. Reference one authenticated external resource from multiple pages and raster artifacts; observe one pending fetch and
   one successful immutable byte node keyed by hash and length.
4. Cancel one of two consumers without canceling shared transport; cancel the underlying request only after the final
   consumer releases it; remove failed promises so a retry can succeed.
5. Dispose either of two sharing faces and prove the other remains loaded; dispose the last face while a Text binding is
   alive and prove retirement waits for that binding; release it and prove every unreachable child retires exactly once.
6. Serve changed bytes from one URL after all prior leases retire and prove a new generation is used without mutating an
   independently retained old Font.
7. Use equal URLs with materially different Request credentials/headers and prove they do not transport-coalesce; use
   different URLs with equal authenticated bytes and prove their content nodes converge.
8. Request a missing GLB format and prove no runtime baker is imported or called. Pass authenticated TTF and OTF bytes and
   prove equivalent exact bake contracts execute once and retain one validated composed GLB; reject WOFF and unknown
   bytes.

## Cache-surface cross-check and exact external-format loading

D-298 distinguishes orchestration caches from Glyph's semantic resource ownership.

| Surface                        | Verified current behavior                                                                                                                                                                                               | FontFace direction                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `THREE.Loader`                 | `loadAsync()` only wraps the subclass's `load()` in a Promise. It provides no cache and no dependency discovery.                                                                                                        | Remains only an adapter shape.                                                                                                                   |
| `THREE.FileLoader` r185        | Coalesces concurrent requests in a module-global table by resolved URL. Completed values enter URL-only `THREE.Cache` only when `Cache.enabled` is set; it defaults to false.                                           | Not an authoritative cache because URL alone cannot express content authentication, Request semantics, dependency leases, or technique identity. |
| Current `/three` `FontLoader`  | Extends `THREE.Loader`, reports one display URL through `LoadingManager`, and delegates to root `loadFont()` or an optional `FontLibrary`; it never creates `THREE.FileLoader`.                                         | It remains a compatibility/progress adapter; handle-free FontFace operations own new-API readiness.                                              |
| Current top-level `loadFont()` | Coalesces an exact composite request only while it is in flight.                                                                                                                                                        | Compatibility calls route into the graph.                                                                                                        |
| Current `FontLibrary`          | Retains successful exact composite request entries with bounded LRU eviction.                                                                                                                                           | Its separate semantic cache is unnecessary for FontFace; the face and downstream graph leases provide deterministic ownership.                   |
| Current R3F `useFont()`        | Canonically caches one hook-created FontFace declaration per handle/source/format key, checks the selected handle's exact technique readiness, conditionally suspends on its stable load, and owns mounted Font leases. | React owns declaration identity, suspension, and mounted leases; it does not create a second semantic loader cache.                              |
| Browser HTTP cache             | Applies underneath `fetch()` according to ordinary request and response policy.                                                                                                                                         | Remains a transport optimization, not a Font/technique ownership model.                                                                          |
| Runtime Worker `CacheStorage`  | Optionally persists one validated composed GLB when source freshness permits it.                                                                                                                                        | Remains the cross-page acceleration for authenticated TTF/OTF bakes; the graph guarantees in-process reuse.                                      |

Three's GLTF loader demonstrates why subclass ownership matters: it explicitly uses `FileLoader` for the root document,
parses the document, resolves buffer and image dependencies, and maintains parser-local dependency Promise caches. The
base `Loader` does none of this automatically. Glyph has an analogous manifest, but it is `PMNDRS_font.rasters` plus each
technique extension rather than generic glTF buffers and images, and Glyph must authenticate the reciprocal identities.

The main font GLB is the only runtime manifest. The CLI/unplugin may emit predictable sidecar filenames so humans, CDNs,
and build tools can organize output, but the loader never derives those names. It cannot know that a technique exists
until it has validated the main GLB and found the exact directory entry. A separately obtained raster sidecar is not a
FontFace source and cannot add a technique to the main font; it is accepted only after the main directory selected it and
its hash plus reciprocal shaping/raster identity authenticate it. This remains true when a third party edits or repackages
a conforming GLB—the schema data, not the producer's naming pattern, is the external contract.

The intended complete FontFace dependency-graph algorithm is:

```text
1. Acquire/fetch the FontFace's core source through the Glyph graph.
2. Validate and parse the core GLB once.
3. Resolve the declared technique and normalize its exact options, or enumerate imported techniques advertised by an
   undeclared aggregate face.
4. Derive the exact rasterKey.
5. Find that rasterKey + kind in PMNDRS_font.rasters.
   - absent: throw RASTER_NOT_FOUND; do not probe or guess a sidecar; do not bake.
6. Follow the directory entry.
   - embedded: bind its authenticated extension and buffer views.
   - external: resolve its declared URI against this acquisition's core-GLB base, fetch through the graph, authenticate
     the declared artifact hash, and require the artifact to reciprocally match exactly one directory entry.
7. Run the selected technique decoder.
8. For every external resource named by that technique artifact, resolve relative to the raster artifact, fetch through
   the graph, authenticate SHA-256 and byte length, and decode it.
9. Retain the completed decoded-node lease and resolve the stable selection load promise.
```

The selected FontFace is not loaded after step 2 merely because its directory says the technique exists. It becomes loaded
only after step 9. An absent entry is a capability error; a present entry whose sidecar or nested resource is unavailable,
malformed, hash-mismatched, or incompatible is a dependency-load error. In both cases imperative Text construction still
sees an unloaded selection and throws synchronously. Only authenticated TTF/OTF input enters runtime baking before this
GLB path; a GLB never transitions into a baker after step 5 or later.

R3F consumes that state without a second semantic cache or an always-async gate:

```ts
if (!isHandleTechniqueLoaded(handle, selection)) {
  use(loadHandleTechnique(handle, selection));
}
```

Font-name resolution happens before this check. Failure to resolve a string is an unknown-font error, so it never reaches
the readiness branch. The conditional is valid for React 19's `use()` API. Once the graph has committed step 9, ordinary
Text construction proceeds synchronously on every render.

The current low-level loader already implements most of the directory sequence: it validates the core, reads
`PMNDRS_font.rasters`, derives the raster key, performs exact lookup, resolves an external raster relative to the core URL,
authenticates its artifact hash, and requires reciprocal shaping/raster identity. Slug decode already awaits its external
curve/header/reference resources before returning. The missing work is the single graph owner and per-node coalescing,
completed-value caching, and lease retirement; Bitmap/MSDF external atlas-page decoding also remains explicitly unsupported
today.
