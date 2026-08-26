---
type: API Specification
title: Public API surface audit and cleanup plan
description: Findings from auditing every published entry point against Skia, Flutter, React Native, troika, Unity TextMeshPro, and Unreal Slate, with the cleanup and the animation API the findings require.
documentation_type: explanation
tags: [api, audit, cleanup, animation, ergonomics]
status: draft
sources:
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: core-api
    resource: core-api.md
    title: Core text API
  - id: decision-register
    resource: decision-register.md
    title: Decision register
generated:
  by: openai-codex/gpt-5
  at: '2026-08-26T00:00:00Z'
---

# Public API surface audit and cleanup plan

## Why this exists

Two shipped defects had one shape: **an internal representation was published, and the caller was made responsible for keeping it valid.**

- A span boundary that split a grapheme cluster reached the engine and rejected the whole paragraph frame with a numeric status naming nothing. The caller had authored no offsets at all; the tree compilers derived one at a concatenation join, and concatenation fuses clusters.
- `insertText`/`deleteText`/`replaceText`/`setSpan`/`removeSpan` published the flattened offset array as a mutation API. They had zero callers outside their own tests, and `set()` already derived the identical incremental edit from a plain `text` assignment.

Both are fixed. This document records everything the follow-up audit found that is the _same shape_, and the animation API the evidence says we should build instead of the one we have.

The audit measured usage across `apps/*`, `packages/glyph-example-raster/*`, and `docs/*`, and compared every design decision against Skia (`skparagraph`), Flutter (`TextSpan`/`TextPainter`), React Native, troika-three-text, `@react-three/drei`, Unity TextMeshPro, Unreal Slate, the DOM/CSSOM, ProseMirror, and Lexical.

## The rule this codifies

> **A caller must never be handed a value they are responsible for keeping consistent with engine state, and must never be able to reach a state the engine will reject.**

Every finding below is an instance of violating it.

## What the industry comparison settled

Findings worth keeping, because they answer questions that would otherwise be re-litigated.

- **Flat sorted ranges are the right durable representation.** Skia stores `Block { TextRange fRange; TextStyle fStyle; }`; Flutter and React Native both flatten their trees to one immediately. `ParagraphSpan[]` is not the mistake. Publishing _mutation operations_ on it was — no surveyed system does that. Skia's one incremental range API, `updateFontSize(from, to, size)`, is marked experimental and asserts the range covers the whole text.
- **Our cluster resolution matches the normative rule.** Rounding a style boundary outward to the containing cluster is CSSOM View's normative behaviour and Skia's painting behaviour. troika's `colorRanges` has no cluster logic at all; ProseMirror, Lexical, and React Native split blindly; Unreal snaps clusters for the caret but **not** at style boundaries. Our previous behaviour — rejecting the whole frame — was harsher than every system surveyed.
- **Our React tree is the strongest rich-text story in the three.js ecosystem.** drei's `Text` has no styled-run model; non-string children become scene children parked at the mesh origin. troika's `colorRanges` is colour-only in the published version.
- **Nobody hands out offsets the caller must maintain.** The DOM adjusts every live `Range` on mutation; ProseMirror gives a `Mapping` per transaction; Lexical never issues a document offset. Unity invalidates everything on each regeneration and signals through an event; Unreal re-offsets run ranges itself but leaves highlight ranges to the caller to rebuild.
- **Per-glyph write is where we are genuinely ahead.** `applyGlyphs()` patches a retained GPU buffer with no CPU re-upload and no reshape, and `restoreGlyphs()` explicitly returns authority to layout. troika's route fights `sync()`, Skia's `RSXform` requires rebuilding the blob, Unreal has no per-glyph placement at all, and Unity makes the application mutate and re-snapshot arrays.
- **Per-glyph read was the missing half and now shares one source.** Positioned glyph advances and ink boxes come from the engine's semantic view, not technique-specific packed records. `snapshotGlyphs()`, `caretAt()`, and `selectionRects()` build on that data. F13 records the remaining cluster-end/caret-edge defects in those derived helpers.

## Delete

Published surface with no use case. Each row carries the evidence that justifies removal.

| Surface                                                                                                                                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Text.coreProperties`, `needsApply`, `semanticChanges`, `textMutations`, `markApplied`, `bind`, `unbindFrom`, `runtime`; `TextGroup.bindText` | The reconciler protocol, published. Zero external callers, zero doc mentions. Two take or return types the emitted `.d.ts` declares but does not export, so a caller can invoke them but cannot name them. `markApplied()` clears the mutation queue, so one call publishes a paragraph whose text buffer no longer matches the engine's. `textMutations()` hands out the exact `{start, deleteCount, insert}` records the deleted mutation API was removed for publishing.                                                                                                                                                                                                                                                                                                                                       |
| `SpanNestingError`, `SpanRange`, `IdentifiedSpanRange`                                                                                        | Exported straight out of `internal/span-cascade.ts`. `assertSpanNesting` and `resolveSpanCascade` have zero callers package-wide, so the error is never thrown. Its premise is also stale: `cascadeOrder` is assigned from array index and the engine resolves by `(root, cascade_order)`, so partial overlap is well defined as last-wins. The type asserts a constraint the engine does not impose.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Text.retry()`, `TextGroup.retry()`                                                                                                           | Zero uses. `synchronize()` already self-retries. Nothing a caller can do that the next frame does not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ~~`capacity.policy: 'fixed'`~~                                                                                                                | **Rejected on re-measurement.** The rationale was false: the guard runs from `#ensureCapacity` _before_ `session.update()` and compares a text-length upper bound, so a caller can size content against the cap rather than discover it after shaping. Removing it deleted a working capability as an unannounced breaking change. Kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `FontLeaseError`                                                                                                                              | Exported, never thrown; used only to build a warning string behind a `DEV` guard, so the lease-leak warning does not exist in production.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `normalizeRasterCoverage`, `RasterCoverageError`, `MAX_RASTER_COVERAGE_*`                                                                     | Zero uses outside `internal/`, where the module stays.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ~~`createFontStack`~~, ~~`FontLoadError`~~                                                                                                    | **Rejected on re-measurement (D-267).** The "zero uses anywhere, including tests" claim was wrong for both. `FontLoadError` is thrown from roughly forty sites in `loader.ts` and `text-runtime.ts` — surviving public API — and `loader.test.mjs` and `loader-fuzz-smoke.test.mjs` classify failures by its `code`; withdrawing it leaves a consumer unable to tell a load failure from any other `Error`, which is what Fix 1 below argues against. `createFontStack` is the only validating constructor of the exported `FontStack` interface (same-runtime membership, no duplicates) and builds the D-223 heterogeneous stack in `three-v1.test.mjs`; deleting the factory while keeping the interface leaves callers hand-rolling `{ fonts }` and reaching exactly the state the engine rejects. Both kept. |
| `./text-shaper-abi`, `./font-baker-abi`, `./bitmap-baker-abi`, `./mtsdf-baker-abi`, `./slug-baker-abi`                                        | Zero external uses. They exist to publish struct offsets for pointer arithmetic. `textShaperAbi` already reaches its one legitimate consumer through `/core`. The package's own tests and scripts import them and now do so by relative path; only the entry points are withdrawn.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `./bakers/{bitmap,msdf,slug}/validate`                                                                                                        | Zero uses outside the package; the package's own tests and scripts reach them by relative path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Keep published, and harden

An earlier revision of this audit demoted `/core` (96 symbols) and `/tsl` (22 symbols) on the claim that they have **no consumers**. That claim is false. `@pmndrs/glyph/three` imports `/core` directly ([`three/text.ts:15`](../../packages/glyph/src/three/text.ts) and `:42`, [`three/engine-plan-target.ts:4`](../../packages/glyph/src/three/engine-plan-target.ts)), exactly as `core.ts`'s own docstring says: "`@pmndrs/glyph/three` is implemented on exactly this surface." The accurate statement is that `/core` has no consumers _outside this package_ yet, which is a different fact and does not support withdrawal.

Both subpaths stay published. `/core` is the engine-integration surface, and it is the answer to "how do I integrate this with something that is not our `Text`":

| A host wants                                                | It uses                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Scene objects, our batching, our ordering                   | `/three` -- `Text` and `TextGroup`                                                                            |
| The render plan, its own instancing, clipping, and ordering | `/core` -- `TextEngineHost`, `compileRenderPolicy`, `TextEngineRenderPlanView`, plus `/tsl` if it is three.js |
| A different renderer entirely (TypeGPU, another engine)     | the same `/core` path                                                                                         |

pmndrs/uikit is the second row, not a special case. It is a three.js library, so it needs no bespoke surface; it wants the plan rather than our `Object3D`s because it owns instancing, clipping, and render ordering across every element type. That is precisely what `/core` is for, and `/three` is simply its first consumer.

What survives from the original objection is a hardening requirement rather than a demotion. `/core`'s contract is currently the Wasm ABI: caller-chosen raw `u32` handles where the repository already has branded `FontHandle` and `RasterHandle` available, caller-supplied opaque byte blobs, a publication whose bytes are valid only until the next Wasm call, and a manual acquire and release refcount pair. The README teaches `plan.u8(patch + patchLayout.opcode)` as the supported idiom. Those are real sharp edges on a surface third parties are now expected to build on, and they are addressed as items 11 and 19 below rather than by withdrawing the entry point.

One stale decision to reconcile: D-118 accepted a renderer-neutral `stageBatch(previous, layout, resource, fontSlot, paint, rasterPixelRatio)` transaction and a `RasterDrawBatch` contract. Neither symbol exists in `packages/glyph/src`. Milestone 10 shipped the render policy and plan view instead, and the three executor consumes those. D-118 describes an architecture that was superseded and should be marked as such, not treated as an outstanding deliverable.

## Fix

These are the audit findings in the form in which they were discovered. The handoff table under **Goal and current state** is authoritative about whether each one has landed; imperative wording here records the defect and required invariant rather than implying every item remains open. A reference to "item 6" means the numbered requirement; "F6" means the fix below.

F1. **Distinguish frame-rejection causes.** `EngineError::InvalidRequest` collapses more than twenty distinct failures — style splits a cluster, missing style index, missing run, missing font metrics, every arithmetic overflow — into `status 6`. It names no span, paragraph, or offset. Give the engine distinct variants for at least the caller-actionable cases, carry the offending paragraph and style id in the result header, and re-raise as a typed error from `/three` so a consumer never sees a bare integer. `textShaperAbi.status` is exported from `/core` but not `/three`, so a `/three` consumer cannot even map the number to a name without a second import.
F2. **Stop the per-frame rejection loop.** The first proposed fix was a rejection latch. It was rejected because it hid a renderer lifetime or ordering defect until unrelated authored input changed. The landed split is stricter: every caller-controlled invalid input throws at its public call boundary; an engine-accepted renderer publication is prepared and validated as one candidate before device state changes. If realization fails, the renderer keeps the previous complete scene live and retries the exact unpublished publication bytes without another engine call. A newer desired input supersedes that candidate from the last device-accepted plan revision. There is no stale-state restoration and no input-driven recovery latch (D-279).

**Shaping and layout answer once their validated data exists.** A bad span, constraint, identity, resource descriptor, policy, or plan reference is rejected while the responsible caller is still on the stack. A renderer preparation error is therefore an implementation or device-boundary fault, not an alternate content state for the application to repair. Three reports it, leaves the accepted scene intact, and retries only the exact candidate it has not yet consumed.

`capacity.policy: 'fixed'` is deliberately not in that class. A caller declaring a hard glyph budget is a real thing to want in a memory-constrained scene, so exceeding it is the policy doing its job, not a failure. The defined behaviour is that the update does not apply, the last complete revision stays visible, development builds warn once with both numbers, and `capacityExceeded` carries it for reporting. It self-heals: the comparison is recomputed each frame rather than latched, so shortening the text or raising the capacity clears it. It used to throw a `RangeError` from inside `updateMatrixWorld`, taking out the whole scene traversal for something the caller had asked for.

F3. **Validate `spans` at `set()`, not at `synchronize()`.** The array carries four invariants enforced at three different times by three different policies: cluster alignment is silently repaired at `set()`, inverted ranges are forwarded and rejected every frame, collapsed ranges are silently dropped at `synchronize()`, and disjoint-or-nested is not enforced at all. Inverted and out-of-range spans are caller arithmetic errors and should throw from `set()` where the stack points at the caller, as `normalizedColumns` and `normalizeCapacity` already do. Cluster resolution stays silent — it is correct and matches CSSOM View.
F4. **Report partial application in the origin lane.** `setGlyphOriginOverrides` and `snapshotGlyphOrigins` both `continue` past a stable id with no record, so an animation frame writing two hundred origins may apply forty with no error and no count. `snapshotGlyphOrigins` additionally seeds `displayed` from the caller's shaped-space fallback, returning one `Float32Array` holding two coordinate spaces with nothing marking the boundary.
F5. **Guarantee the parallel-array invariant.** The one real consumer hand-wrote `assertParallelGlyphIdentity` over six public arrays. Construct `ParagraphLayoutInspection` behind a factory that cannot produce a ragged one, or make `glyphCount` the single authority and document every array as sliced to it.
F6. **Make late `registerThreeRasterPlanProgram` an error.** The registry is module-global and each `TextRuntime` snapshots it once at first coordinator creation, so a later registration is a legal call that silently does nothing and surfaces later as a missing technique. A doc comment is not enforcement.
F7. **Export the `glyphFlags` bit names or drop the field.** Sixteen bits whose meaning lives only in a planning document, which a consumer would have to find and then hardcode indices from.
F8. **Split the React inline props type.** `R3fTextChild` is typed as the full outer props, but `flattenText` honours only `font`, `style`, `paint`, `material`, and `children`. `contentBox`, `capacity`, `pixelSnapping`, `rasterPixelRatio`, `onError`, `ref`, and every `Object3D` prop are silently discarded, and a `ref` on a nested `Text` never fires. Flutter's split of `RichText` (box-level) from `TextSpan` (inline-level) is the precedent.
F9. **Re-export `ParagraphLayoutSummary` and `ParagraphLayoutInspection` from `/three`.** `Text.layout()` and `Text.glyphs()` return types a `/three` importer cannot name.

F10. **Give `RasterTechnique` behaviour, the way `RasterBakerModule` already has it.** The bake and raster sides are dependent twins across the artifact boundary, and only one of them got this pass.

    `RasterBakerModule` (`packages/glyph/src/bake.ts:101-107`) is an open contract: `kind`, `extension`, `version`, and two methods -- `descriptor(options)` and `bake(request)`. A third party implements the interface and bakes. `RasterTechnique` (`packages/glyph/src/raster-technique.ts:30-42`) is a pure descriptor: `id`, `kind`, `extension`, `version`, and a phantom type map. **No methods.** A technique therefore cannot say how to consume what its twin produced, so the consuming code must know every technique by name:

    - `core/font-binding.ts:55-74` -- a closed branch over `bitmap`, `msdf`, `slug`, ending in `throw new TypeError('no first-party font-binding compiler is registered for ...')`;
    - `three/engine-runtime.ts:217-234` -- the same shape again, ending in `'no first-party Three resource resolver is registered for ...'`;
    - `three/engine-plan-target.ts:781` -- a third `technique === bitmap.id` branch.

    Nothing is registered in any of them; the word describes a hard-coded `if`. The consequence is that **a third-party technique cannot bind a font or resolve a Three resource at all**, even though `compileFontBinding`, `schemaFieldTable`, `FontBindingDescriptor`, and `fontBindingResources` are exported from `/core` so an integrator can build the binding correctly and then find nowhere to put it. That contradicts what `/core` is for -- the example-renderer package exists to prove a renderer can drive the engine itself -- and it is the one place first-party techniques get a private path.

    The technique already owns the data shape (`BitmapData`, `BitmapStrikeData`) and the binding layout (`bitmapSchema.binding.f32` / `.u32`, `raster/bitmap-technique.ts:205-233`). Only the compiler that walks one into the other was split out into `core/`. Put it back on the technique so `loadedFontBindingBytes` resolves through `font.technique` -- which the call site already holds to compare ids -- and do the same for the Three resource resolver. Prefer that to import-side-effect registration into a module-global registry: a registry adds order dependence, needs a `sideEffects` declaration to survive bundling, and re-creates the late-registration hazard F6 already records. Carrying behaviour on the object the caller passed in has none of those failure modes and makes both sides of the boundary the same shape.

    Removing the switch also removes the eager import of all three techniques, which is what currently blocks `Paragraph` from the root entry: the delivery gate rejects the root pulling `raster/bitmap-technique.js`, and a consumer shipping one technique pays for three. That is a consequence of the fix, not the reason for it.

F11. **Stop committing `source_digest` per commit.** Every commit touching source re-pins a generated hash into `docs/packages/*.md`, so replaying N commits during a rebase produces N conflicts whose correct value is neither side -- it is whatever `docs:update` computes at the end. Across the six-layer rebase onto main this was roughly nine of every ten conflicts, and the cost scales with commit count times stack depth. A `.gitattributes` merge driver for `docs/packages/*.md`, or regenerating in CI rather than storing per commit, removes it. `docs:check` already enforces correctness independently, which is what makes the stored copy redundant rather than authoritative.

F12. **Make the paragraph measurement invariant true.** `BaselineMetrics` promises `ascent + descent === lineHeight`, but a paragraph publishes `ascent = firstBaseline`, `descent = contentHeight - lastBaseline`, and `lineHeight = contentHeight` (`packages/glyph/src/layout.ts:39`, `packages/glyph/src/core/layout-query-view.ts:88`). With baselines at 10 and 30 in a 40-tall paragraph, `10 + 10 !== 40`. Anyone sizing or baseline-aligning from the exported type gets a wrong extent on every wrapped paragraph; the existing test covers one line only. Either stop implementing `BaselineMetrics` for paragraph measurements, or define descent against the same baseline.

F13. **Keep word ranges on cluster boundaries.** `packages/glyph/src/glyph-placement.ts:479-492` derives `textEnd` as `cluster + 1`, so a word that is one astral character reports an end of 1 and splits the surrogate pair instead of returning 2. Combining sequences and multi-character ligatures split the same way. Derive the end from the next logical cluster boundary. Caret affinity has the neighbouring defect (`:544-552`): at an internal boundary the trailing edge wins the tie, then the offset advances while `leading: false` is retained, so the reported rectangle contradicts the reported offset, and RTL is not accounted for at all.

F14. **Advance `layoutRevision` whenever the answer could differ.** Revisiting a cached constraint does not advance it, so a host that treats the revision as its change signal renders stale content. The retention brand is separately forgeable, which defeats both the compile-time and runtime ownership checks it exists to provide.

F15. **Stop publishing mutable cached arrays as results.** `layout()` and `glyphs()` hand back typed arrays retained in the cache (`packages/glyph/src/core/layout-query-view.ts:133-174`, `:234-258`), so `result.layout.x.fill(0)` corrupts what the next identical query returns. `Object.freeze` does not protect typed-array elements and `readonly` does not exist at runtime. "Caller-owned memory" and "identical cached object" cannot both be true; pick one and state it.

F16. **Reject contradictory span authorities in `ParagraphOptions`.** The type admits a `FormattedText` value and a separate `spans` array at once, and because `formatted.spans` always exists the explicit array is silently ignored (`packages/glyph/src/paragraph.ts:93-104`). `TextProperties` already models these as mutually exclusive variants; publishing an invalid combination is the same class this audit removes everywhere else.

## Reshape

| Surface | Resolution | State | Precedent |
| --- | --- | :---: | --- |
| `Text.layout()` previously required a committed scene frame | An attached `Text.layout()` now measures current desired local state synchronously before the first frame, without matrix traversal, renderer realization, plan publication, or revision advancement. Detached measurement belongs to `Paragraph.layout(constraints)`. | ✅ D-282 | Flutter `TextPainter.layout()` then `.size` |
| `Text.error` / `onError` was the only signal | `commitState()` distinguishes `unbound`, `pending`, `committed`, and `failed`. | ✅ D-272 | troika `onSync` |
| No anchoring | Add `anchorX`/`anchorY` as a separate Three positioning feature. It must not alter renderer-neutral paragraph measurement or force semantic inspection on every render. | ⬜ | troika and drei |
| No glyph extents | Paragraph and line summaries now publish advance and ink extents; positioned glyph output carries advances and ink boxes; Three exposes cluster-aware `caretAt()` and `selectionRects()`. | ✅ D-274 through D-276 | Skia, Flutter, troika, DOM |

## Goal and current state

**Goal.** Every item in this document implemented, **every open decision entry it depends on resolved**, and **performance benchmarking we can trust across every core API path**, landed as a GitHub Stack of pull requests, each one green in CI, each one adversarially reviewed by an external model with every review comment either addressed or answered, and the stack ready to merge. The pmndrs/uikit fork is documented here but is **not** part of this goal; only the package-side API it needs is.

Three `Proposed` decisions in [the register](decision-register.md) are in scope and must reach `Accepted` or be withdrawn with a reason:

- **D-262** — stable-indirect allocation is either reachable from the public API and covered by the D-261 oracle, or removed. The render plan carries `indirectBufferId` and `indirectOffset` on every draw, so an unreachable strategy is currently shipping as dead surface. The example renderer decodes both, which makes the question answerable rather than theoretical.
- **D-155** — a TypeGPU raster program owns an exact `createTarget()` factory. Item 24 cannot ship a coherent `/typegpu` without settling it.
- **D-152 through D-154** — portable raster identity construction without casts, and `select()` returning `undefined` for a glyph with no renderable record. These bear directly on the rule this audit codifies, since a cast is a caller keeping state consistent by hand.

D-015 and D-033 are `Deferred` by intent and are not in scope.

This section is the handoff. Keep it current as work lands, so anyone can resume from it.

D-279 supersedes the F2 recovery latch. Caller-authored invalid inputs now fail at their public call boundary; a renderer
preparation failure retains and retries the exact accepted publication without waiting for authored input to change.

| #             | Item                                                                                                                                                        |  State  | Where                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | :-----: | ------------------------------------------------ |
| --            | Un-publish the reconciler protocol, delete-list surgery                                                                                                     |   ✅    | [#104](https://github.com/pmndrs/glyph/pull/104) |
| --            | Keep `/core` and `/tsl` published; correct the false "no consumers" finding                                                                                 |   ✅    | #104                                             |
| --            | `packages/glyph-example-renderer`, a second engine consumer on `/core` alone with real TypeGPU/WebGPU resources, submission, and changing pixels          |   ✅    | [#120](https://github.com/pmndrs/glyph/pull/120) |
| --            | Adversarial review of #104 addressed                                                                                                                        |   ✅    | #104                                             |
| F1-F3, F6, F9 | Rejection diagnostics, call-time span validation, late registration, layout re-exports; F2 latch superseded by D-279                                        |   ✅    | [#106](https://github.com/pmndrs/glyph/pull/106) |
| --            | **Every caller-reachable path to a frame rejection closed** — overlap, feature ranges, unpaired surrogates all throw at `set()`                             |   ✅    | [#109](https://github.com/pmndrs/glyph/pull/109) |
| F4-F5, F7-F8  | Origin-lane partial application, parallel-array invariant, `glyphFlags` names, React inline props split                                                     |   ✅    | [#107](https://github.com/pmndrs/glyph/pull/107) |
| 1-3, 5        | Ascent/descent/line height, ink bounds beside advance extents, per-line metrics on the summary                                                              |   ✅    | #107                                             |
| --            | Animation API: snapshot to manipulate to restore over glyphs/words/lines                                                                                    |   ✅    | #107                                             |
| --            | Reshape: `commitState()`, cluster-first `caretAt`/`selectionRects`                                                                                          |   ✅    | #107                                             |
| 4, 6-10, 16   | Framework-neutral `Paragraph`, constraint/policy split, intrinsic widths, failure from the layout call, uikit fixture re-pointed, paragraph-scoped revision |   ✅    | #109                                             |
| 24            | `@pmndrs/glyph/typegpu` — Bitmap                                                                                                                            |   ✅    | [#108](https://github.com/pmndrs/glyph/pull/108) |
| 24            | `/typegpu` — MSDF and decoration                                                                                                                            |   🚧    | `feat/typegpu-msdf`                              |
| 24            | `/typegpu` — Slug (PR #46 is reference only, never merged)                                                                                                  |   🚧    | `feat/typegpu-slug`                              |
| 11            | Retention and ownership protocol for borrowed and retained render-plan publications                                                                         |   ✅    | [#110](https://github.com/pmndrs/glyph/pull/110) |
| 12            | Documented host font path through root `TextRuntime.loadFont()` plus the `/core` integration surface                                                        |   ✅    | #120                                             |
| 13            | Published package-size evidence and reviewed ceilings                                                                                                       |   ✅    | #120                                             |
| 14            | Parity gate against uikit's own text, selection, clipping, and lifecycle fixtures                                                                           |   ⬜    | downstream uikit work                            |
| 15            | Re-point `uikit-integration.md` at `Paragraph` and the retained render-plan contract                                                                         |   ⬜    | document still names superseded `stageBatch`     |
| 17-18         | Change notification and asynchronous font-readiness requirements                                                                                            | review | premise narrowed: `Paragraph` requires a loaded font |
| 19, 23        | Measurement ownership/purity and paragraph-scoped positioned-output revision                                                                                |   ✅    | #109                                             |
| 20-22         | Host-side constraint resolution, direction inheritance, and complete Yoga baseline convention                                                              |   ⬜    | package contract follow-up                       |
| F10           | Portable technique schema, policy-body factory, compiled resources, and engine-owned realization                                                            |   ✅    | #120                                             |
| F11           | Stop generated `source_digest` conflicts from dominating rebases                                                                                            |   ⬜    | tooling follow-up                                |
| F12           | Paragraph baseline invariant                                                                                                                                |   ✅    | current branch                                   |
| F13-F16       | Cluster-end caret/word ranges, cached-constraint revision transitions, mutable cached positioned arrays, contradictory `ParagraphOptions` authorities       |   ⬜    | current API review findings                      |
| --            | `anchorX`/`anchorY` (D-272)                                                                                                                                 |   ⬜    | --                                               |
| --            | Resolve overlapping spans per cluster instead of refusing them                                                                                              |   ⬜    | engine change, recorded intent                   |

24. Publish `@pmndrs/glyph/typegpu`, a sibling of `/tsl`: the same technique shaders realized as TypeGPU functions, reusable by any TypeGPU host without adopting our renderer. No scene integration and no engine driving, exactly as `/tsl` carries none. A TSL realization can be rendered to WGSL and GLSL in a browser probe and its final source extracted, rather than translated by inspection. An old pull request from TypeGPU's author carries a partial slug port; assume it needs reimplementation rather than resumption, but read it closely first, because it is authoritative on TypeGPU idiom. See [example renderer](example-renderer.md) for how this divides from the engine-consumer work.

    Bitmap shipped first, end to end: typed schemas and vertex/fragment stages under `src/typegpu/`, the `./typegpu` subpath export, `typegpu` as an optional peer, and build-time embedding of the shader metadata so the published functions resolve without consumer-side tooling. Parity is pinned against the TSL realization's actual generated WGSL — extracted device-free at test time, not translated by eye — which surfaced two facts the port reproduces exactly: coverage pages are read as clamped nearest texels through `textureLoad` (data textures never filter), and pixel snapping multiplies reciprocals in the emitter's own order. MSDF, Slug, and decoration remain.

Two findings that originally de-risked the list are now implemented. `Paragraph` and pre-frame `Text.layout()` both use the paragraph-scoped synchronous measurement call, while the session retention protocol gives an external renderer an owned publication when it must cross another engine call or an asynchronous device boundary. The render plan remains the integration surface: `clipId`, `depthKey`, `orderToken`, `materialId`, `transformId`, named buffers, named resources, geometry, patches, and retirements are data an engine maps to its renderer.

Corrections this document has already absorbed, recorded so they are not re-derived: `/core` has consumers and stays published; paragraph and line ascent/descent now ship beside first/last baselines; `Paragraph.layoutRevision` is paragraph-scoped while engine and plan revisions remain publication-scoped; `stageBatch` from D-118 was never implemented and was superseded by the retained render-plan contract; `FontLoadError` and `createFontStack` were wrongly listed for deletion; the uikit shadow-adapter stage is not downstream of this cleanup; `Paragraph` lives on `/core` because only an integrator constructs it; and "minimum-content width from a zero-width measurement" was wrong as an implementation recipe -- a literal zero-width flow is degenerate, so intrinsic widths are scanned from the cluster arena in the same measurement pass.

### Answered: the shared module behind the graph delta

Every runtime graph -- `three-runtime-js`, `bitmap-runtime-js`, `mtsdf-runtime-js`, `slug-runtime-js` -- grew by a near-identical step across this stack, and that shape pointed at one shared module rather than at the semantic record widening from 44 to 68 bytes. The module is **`unicode-segmenter`**, which enters through `packages/glyph/src/internal/graphemes.ts` at the edit-topology layer: caller-side span alignment must agree with the engine's cluster grid, and `Intl.Segmenter` follows the host ICU, so it can place a boundary this package's own Rust tables do not. One module, four importers, one near-identical step.

It is a deliberate correctness-over-size trade, not drift, and it is not foreign-host variance: both hosts measure `three-runtime-js` at an identical 399,189 raw against a 377,000 ceiling that main passes with 101 bytes of headroom. The bot reports it as Core JS +25.1 % and the Three adapter +6.9 % gzip. Ceilings are re-priced with that cause recorded in `apps/benchmarks/src/benchmark/package-size-budgets.ts`, so they are now reviewed in the normal sense.

What is still worth deciding before release is whether every entry point should pay it. A consumer who never authors spans still ships the tables.

### Final phase: benchmarks we can trust

The repository has many benchmarks and does not trust them. The complaint is subtle drift: numbers move between runs for reasons unrelated to the change under test, so nobody can say whether a change helped or hurt. A cleanup this size is worth little if its cost cannot be measured.

Performance benchmarking moves onto **pmndrs/labs**, which exists to benchmark in environments that are not fully stable. The scope is the core API rather than the renderer: shaping and line breaking through `Paragraph.layout`, positioned-column materialization through `Paragraph.glyphs`, the frame-wire compile, the render-plan read, the retention handoff, and font binding. Each path needs a stated unit of work and a stated regression threshold.

The plan is `docs/planning/benchmark-trust.md`. It must answer how a run establishes that a difference is real rather than noise, what the baseline is and how it updates without laundering a regression into the record, how it survives shared CI runners, which existing benchmarks are replaced or deleted, and what it cannot tell us.

## Measurement and positioning

The production report was accurate: positioning was hard because the package computed geometry it did not publish and made a Three caller traverse the scene before measurement existed. The data and timing gaps are now closed without making matrices part of local layout.

| Need | Current API | State |
| --- | --- | :---: |
| Paragraph and line baselines | `ParagraphMeasurement` and each `ParagraphLineMetrics` publish `ascent`, `descent`, and `lineHeight`, with `ascent + descent === lineHeight`. `firstBaseline` and `lastBaseline` remain box-relative. | ✅ |
| Advance versus visible extent | `contentWidth`/`contentHeight` are advance extents for layout hosts. `inkBounds` is the outline union for visual positioning. The names prevent silently substituting one for the other. | ✅ |
| Per-glyph geometry | `Paragraph.glyphs()` returns copied, internally consistent columns with shaped advances and glyph ink boxes. Three's `snapshotGlyphs()`, `caretAt()`, and `selectionRects()` use that same engine geometry. F13 still tracks cluster-end and caret-edge defects in the derived helpers. | partial |
| Detached measurement | `new Paragraph(...).layout(constraints)` is synchronous, renderer-free, scene-free, and leaves authored state unchanged. `glyphs(constraints)` is a separate positioned query so a sizing probe does not allocate per-glyph arrays. | ✅ |
| Attached pre-frame measurement | After `group.add(text)` or any other scene attachment, `text.layout()` measures current desired state immediately. It does not call `updateMatrixWorld()`, publish a render plan, realize materials/resources, or change `commitState()` from `pending`. | ✅ D-282 |
| Positive render state | `text.commitState()` returns `unbound`, `pending`, `committed`, or `failed`; callers no longer infer success from the absence of `error`. | ✅ |
| Common Three anchoring | `anchorX`/`anchorY` remains separate work. It belongs to Three placement, not renderer-neutral paragraph measurement. | ⬜ |

The intended orders are now explicit:

```ts
// Layout host: no scene or renderer.
const paragraph = new Paragraph({ font, text, style, policy });
const metrics = paragraph.layout({ width: { mode: 'at-most', size: availableWidth } });
const positioned = paragraph.glyphs({ width: { mode: 'exact', size: resolvedWidth } });

// Three: attach to establish retained batch/session ownership, then measure before frame one.
const text = new Text({ font, text: 'Measured before render', style, contentBox });
group.add(text);
const desiredMetrics = text.layout();
// renderer.render(scene, camera) later publishes and realizes the draw plan.
```

Late binding remains intentional. Construction and `set()` validate and record desired state without shaping. The call that needs an answer performs the work: `Paragraph.layout()` for a renderer-free host, attached `Text.layout()` for Three pre-frame metrics, or normal renderer traversal when no early measurement is requested. The speculative measurement transaction can be adopted by the next frame; measurement does not become a hidden render.

### Third-party layout hosts: uikit and Yoga

The same gap decides whether `pmndrs/glyph` can be the text solution for pmndrs/uikit. [uikit integration](uikit-integration.md) specifies the contract; this section records what is actually shipped against it.

The package-side measurement contract now exists. `ParagraphAxisConstraint` maps directly to Yoga's `Undefined`, `AtMost`, and `Exactly`; a `Paragraph` owns stable flow policy while `layout(constraints)` and `glyphs(constraints)` accept only the two axis probes. A host resolves CSS percentages, minimums, maximums, padding, and inheritance before this boundary, because those belong to its box tree rather than to one text paragraph.

```ts
import { Paragraph } from '@pmndrs/glyph/core';

const paragraph = new Paragraph({
  font, // already-loaded Font or FontStack
  text,
  style: { direction: inheritedDirection, fontSize: 16 },
  policy: { wrap: 'word', align: 'start', overflow: 'visible' },
});

const metrics = paragraph.layout({
  width: yogaWidthMode === Yoga.MeasureMode.Undefined
    ? { mode: 'unconstrained' }
    : { mode: yogaWidthMode === Yoga.MeasureMode.Exactly ? 'exact' : 'at-most', size: width },
  height: yogaHeightMode === Yoga.MeasureMode.Undefined
    ? { mode: 'unconstrained' }
    : { mode: yogaHeightMode === Yoga.MeasureMode.Exactly ? 'exact' : 'at-most', size: height },
});
```

The old hazards are gone at this boundary:

| Previous hazard | Current contract |
| --- | --- |
| Yoga measurement traversed a Three scene | `Paragraph.layout()` has no scene or renderer dependency. |
| A speculative probe mutated authored state | Constraints are call arguments; authored content and stable policy change only through `update()`. |
| Measurement allocated positioned glyph columns | `layout()` returns allocation-light metrics; `glyphs()` is the explicit positioned query. |
| Errors arrived later on `TextGroup.error` | Invalid constraints and impossible policy combinations throw from the call that supplied them. |
| Results borrowed mutable Wasm memory | Readers copy out of Wasm, so a later engine call cannot detach the result. F15 remains open because `glyphs()` caches and re-returns mutable typed arrays a caller can alter. |
| Every host had to derive intrinsic widths separately | `minContentWidth` and `maxContentWidth` ride the same measurement result. |

The remaining package decisions for a Yoga integration are narrower than the old report claimed: document the exact host-side min/max/percentage reduction, pin inherited direction and baseline conventions including empty paragraphs, and decide whether a notification is needed beyond the caller that invokes synchronous `Paragraph.update()`. Font readiness is not currently asynchronous on this surface: construction requires an already-loaded `Font` or `FontStack`, so there is no fallback-to-final metrics transition for `Paragraph` to report.

### Shipping the uikit pull request

The goal is a fork of pmndrs/uikit whose text subsystem is replaced by this package, submitted upstream. The package prerequisites have moved substantially; the upstream adapter and parity work have not happened in this repository.

| uikit migration step | Package status | Remaining work |
| --- | --- | --- |
| 1. Shadow adapter beside the existing layout | Reachable | Build and compare in the uikit fork. |
| 2. Replace measurement | `Paragraph`, metrics, intrinsic widths, and copied positioned output are shipped | Adapt Yoga constraints and run uikit parity fixtures. |
| 3. Replace positioned layout and rendering | `/core` publishes the renderer-neutral plan plus explicit borrow/retain/acknowledge semantics | Implement uikit's Three realization, batching, clipping, and submission from that public plan. |
| 4. Replace interaction queries | Three has cluster-aware caret and selection helpers; renderer-neutral positioned glyph data is available | Decide whether uikit consumes the columns directly or needs a renderer-neutral helper. |
| 5. Remove the legacy text subsystem | Package prerequisites are substantially present | Blocked on upstream steps 2 through 4 and their parity evidence. |

The obsolete `stageBatch` sketch is not the API. uikit reaches the engine like any custom renderer: through `/core`'s policy, session, retained publication, and render-plan readers. The plan names buffers, resources, geometry, draws, transforms, ordering, patches, and retirements; uikit owns the Three material/pipeline realization and integrates those draws with its existing batching and clipping. It does not adopt glyph's `Text` or `TextGroup` scene objects.

Required for a submittable pull request, beyond items 1 through 10:

11. A retention and ownership protocol on the existing render plan.

    **Landed.** The protocol lives on the session (`core/retention.ts` is its specification): borrows stay the default and expire at the session's next answered call; `isExpired`/`assertLive` detect a stale borrow in two integer compares and throw `TextEnginePublicationExpiredError` instead of reading freed bytes; `retain` makes one contiguous host-owned copy of the whole encoded result and brands it `RetainedTextEnginePublication`, so retaining APIs demand it in their types; `retain`/`acknowledge` feed `session.acknowledgedGeneration`, which the engine already verified monotonically at the wire — retirements carry `afterPublicationGeneration`, so acknowledgement is what releases retired GPU storage; decoded patch records surface dirty ranges per `(bufferId, bufferGeneration)`; paragraph ids are caller-chosen handles, glyph identity rides the policy's stable-id lane, and engine storage is keyed by `(id, generation)` with retirement as the only release signal. `packages/glyph-example-renderer` proves all of it against a real `TextEngineHost` and real Wasm frames.

12. A documented font path for a host that does not use Three's loader.

    **Landed.** `/core` is deliberately not a second font loader. An integration creates `TextRuntime` and loads or runtime-bakes the font through the root entry, obtains its synchronous shaper with `textRuntimeShaper(runtime)`, then uses `/core` for policy, binding, stack, session, and plan work. The TypeGPU example runs this exact route with runtime-baked Inter and real non-empty draws.

13. A published size number.

    **Landed.** The release-size workflow reports and gates the core JavaScript graph, Three adapter, text-shaper Wasm, each technique graph, and compressed sizes. A size-gate failure is a required review point, not a reason to reject correct work; an explained implementation cost updates the reviewed ceiling with evidence.
14. A parity gate against uikit's own fixtures: text, textarea, selection, clipping, and lifecycle. The paragraph-boundary fixture in this repository proves the seam, not the product.
15. Re-point `docs/planning/uikit-integration.md` at the shipped `Paragraph` and retained render-plan surfaces, and remove the superseded `stageBatch` reference. Its fixture-status table must distinguish what the package provides from what the benchmark adapter supplies. **Open.**

Change notification, from a community report. A community member who attempted the swap reported: "For your yoga integration are you using their `hasNewLayout` method? Uikit wasn't using it before and was thus computing layouts for every component a second time. Improved our cpu performance by around 50%." The method is real -- `hasNewLayout(): boolean` and `markLayoutSeen(): void` are on `Node` in yoga-layout 3.2.1 -- and the fix belongs to uikit, which owns the Yoga nodes. It matters here because it is precisely the gate on when a host calls `glyphs()`, the one call that materializes per-glyph arrays out of Wasm, and because composing that gate correctly needs something this package does not publish.

The two flags are not equivalent in either direction:

- Yoga reports a new layout, but our positioned output is unchanged. A box can change in an axis the text does not consume, or in the block axis while the inline axis and every line break stay identical. A host gating only on Yoga re-copies every array for nothing. This is the wasted work the report describes, seen from our side.
- Yoga reports no new layout, but our positioned output _has_ changed. Text and style edits can change the paragraph without moving the Yoga box. A host gating only on `hasNewLayout` renders stale glyphs. `Paragraph` itself has no asynchronous font-resolution transition because it requires an already-loaded font.

The landed `Paragraph.layoutRevision` is paragraph-scoped positioned-output state. It advances only from `glyphs()`, when a 96-bit digest over the box, metrics, line records, and per-glyph positioned values differs; stable renderer bookkeeping is excluded. A host can therefore compose its two independent dirtiness sources:

```ts
const needsReadback = node.hasNewLayout() || paragraph.layoutRevision !== lastSeenRevision;
```

16. Publish a monotonic layout revision on the paragraph that advances exactly when positioned output changes, so a host can gate readback without copying arrays to compare them. **Contract landed; F14 still tracks switching back to a previously cached constraint without advancing the revision.**
17. Decide whether `Paragraph` needs a separate change notification. The caller already performs synchronous `update()` and can dirty its Yoga node in the same operation; there is no internal asynchronous font transition. A notification is justified only if a package-owned event can change desired measurement after the call returns. **Open, with the original premise narrowed.**

Additional requirements, from adversarial review of this plan:

18. Define the font-readiness state machine. **Narrowed:** `Paragraph` construction requires a loaded font selection, so `layout()` has no pending or fallback-metrics result. If a future API admits unresolved fonts, it needs a new explicit state machine rather than changing this synchronous contract silently.
19. Specify layout purity precisely rather than asserting it. **Landed:** authored changes invalidate caches; constraints form the per-query key; equal cached queries return the identical host-owned object; different paragraphs own independent sessions; queries are synchronous, do not call back into the host, and copy result memory out of Wasm.
20. Complete the constraint model. **Open documentation:** percentages, min/max, padding, and definite-versus-indefinite box resolution belong to the host before it supplies `unconstrained`, `at-most`, or `exact`.
21. Specify direction inheritance. **Open documentation:** the host resolves its inherited direction into `ParagraphStyle.direction`; the package must state the `start`/`end` convention under RTL beside that boundary.
22. Specify the baseline contract, not just the metrics. **Partly landed:** box-relative baselines and line ascent/descent are explicit; empty-paragraph and host padding/border conventions still need a uikit-facing statement.
23. Pin down the revision primitive. **Specified:** revision identity belongs to the `Paragraph` object, starts at zero, advances only when positioned output differs by a 96-bit digest, and excludes stable renderer IDs that do not alter geometry. F14 is the remaining implementation mismatch with that contract.

Sequencing. The uikit fork is downstream of items 1 through 23 for anything that replaces uikit's renderer or its query path. It is _not_ downstream for the shadow-adapter stage, which this plan's own migration table already marks reachable today: a shadow adapter runs a paragraph beside uikit's existing layout, compares metrics, and changes nothing visible. That stage should start early, because several items above -- the baseline contract, font readiness and dirty propagation, constraint resolution, direction inheritance, and the retention protocol -- are specified more accurately with a real host exercising them than by reasoning alone. The fork is an acceptance consumer and a design feedback loop; only its later stages are strictly downstream.

## The animation API

### What was wrong with the previous surface

`snapshotGlyphOrigins` / `setGlyphOrigins` / `clearGlyphOriginOverrides` had one real consumer, and that consumer demonstrated every flaw below. D-273 through D-276 replaced this surface with `snapshotGlyphs()` → `applyGlyphs()` → `restoreGlyphs()`; the list remains as the rationale and regression checklist.

- **The identity we thread through is not the identity it needs.** It ignores `glyphStableIds` and builds its own `${fontHandle}:${glyphId}:${cluster}:${occurrence}` key, because the stable id does not survive the reflow it exists to animate across.
- **It re-asserts invariants the API should carry**, hand-checking six public arrays for equal length and re-checking that the snapshot's `layout` is identical to the one it holds.
- **It discovered a required call by trial.** `clearGlyphOriginOverrides()` is mandatory on settle or an override pinned at the target silently shadows the next committed origins.
- **It cannot tell how much of its write landed**, because both write and read skip missing records silently.
- **Two coordinate spaces arrive in one array** with no discriminant.

### Landed replacement contract

Animation targets what _looks_ like a unit on screen — a glyph, a word, a line — not a position in a string. The structure is ours to define and need not be derived from text offsets at all. The shape is an explicit cycle:

> **snapshot → manipulate a structure we define → restore**

Requirements the evidence sets:

1. **Units people animate.** Glyph, word, and line, addressable directly. A caller wanting a per-word stagger should not derive word membership from clusters.
2. **Extents, not just origins.** Per-glyph bounds are what makes caret placement, selection rectangles, hit testing, and scale-about-centre possible. Their absence is the single largest gap against every surveyed API, and it currently forces consumers to decode technique-specific packed records.
3. **One coordinate space, stated in the type.** No silent substitution of a different space for a missing record.
4. **An identity that survives reflow**, or an explicit statement that it does not, so a caller is not forced to invent its own key. The current stable id fails this and the only consumer proves it.
5. **Total application or an explicit report.** A write either applies to every entry or says how many it applied and which it did not.
6. **Restore as a first-class step**, not a call a caller learns to make by observing corruption.
7. **No parallel-array invariants for the caller to maintain.** Whatever is handed out is internally consistent by construction.

Keep the retained-GPU-buffer write path. That capability is genuinely ahead of every surveyed system and is the reason this API is worth having at all — the problem is its shape, not its existence.

## Sequencing

1. ✅ Un-publish the reconciler protocol. Same class as the two shipped defects and the worst remaining hole.
2. ✅ Apply the supported delete list while keeping `/core` and `/tsl` published. Landed as D-267, with the rejected rows retained as noted in the Delete table.
3. ✅ Close caller-reachable frame rejections at call time and replace the rejected recovery latch with D-279 prepare/commit semantics.
4. ✅ Replace the origin trio, publish shared glyph/line geometry, and land renderer-free plus pre-frame measurement.
5. ✅ Harden render-plan retention and portable technique implementation through a real TypeGPU/WebGPU consumer.
6. Close F13-F16, update `uikit-integration.md`, and run the uikit parity work without reopening the renderer-neutral ownership boundary.

Each step must keep the packed-lane differential oracle green, and no step may regress the incremental fast path.
