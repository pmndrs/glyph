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
  by: anthropic-claude/opus-5
  at: '2026-08-23T00:00:00Z'
---

# Public API surface audit and cleanup plan

## Why this exists

Two shipped defects had one shape: **an internal representation was published, and the caller was made responsible for keeping it valid.**

- A span boundary that split a grapheme cluster reached the engine and rejected the whole paragraph frame with a numeric status naming nothing. The caller had authored no offsets at all; the tree compilers derived one at a concatenation join, and concatenation fuses clusters.
- `insertText`/`deleteText`/`replaceText`/`setSpan`/`removeSpan` published the flattened offset array as a mutation API. They had zero callers outside their own tests, and `set()` already derived the identical incremental edit from a plain `text` assignment.

Both are fixed. This document records everything the follow-up audit found that is the *same shape*, and the animation API the evidence says we should build instead of the one we have.

The audit measured usage across `apps/*`, `packages/glyph-example-raster/*`, and `docs/*`, and compared every design decision against Skia (`skparagraph`), Flutter (`TextSpan`/`TextPainter`), React Native, troika-three-text, `@react-three/drei`, Unity TextMeshPro, Unreal Slate, the DOM/CSSOM, ProseMirror, and Lexical.

## The rule this codifies

> **A caller must never be handed a value they are responsible for keeping consistent with engine state, and must never be able to reach a state the engine will reject.**

Every finding below is an instance of violating it.

## What the industry comparison settled

Findings worth keeping, because they answer questions that would otherwise be re-litigated.

- **Flat sorted ranges are the right durable representation.** Skia stores `Block { TextRange fRange; TextStyle fStyle; }`; Flutter and React Native both flatten their trees to one immediately. `ParagraphSpan[]` is not the mistake. Publishing *mutation operations* on it was — no surveyed system does that. Skia's one incremental range API, `updateFontSize(from, to, size)`, is marked experimental and asserts the range covers the whole text.
- **Our cluster resolution matches the normative rule.** Rounding a style boundary outward to the containing cluster is CSSOM View's normative behaviour and Skia's painting behaviour. troika's `colorRanges` has no cluster logic at all; ProseMirror, Lexical, and React Native split blindly; Unreal snaps clusters for the caret but **not** at style boundaries. Our previous behaviour — rejecting the whole frame — was harsher than every system surveyed.
- **Our React tree is the strongest rich-text story in the three.js ecosystem.** drei's `Text` has no styled-run model; non-string children become scene children parked at the mesh origin. troika's `colorRanges` is colour-only in the published version.
- **Nobody hands out offsets the caller must maintain.** The DOM adjusts every live `Range` on mutation; ProseMirror gives a `Mapping` per transaction; Lexical never issues a document offset. Unity invalidates everything on each regeneration and signals through an event; Unreal re-offsets run ranges itself but leaves highlight ranges to the caller to rebuild.
- **Per-glyph write is where we are genuinely ahead.** `setGlyphOrigins` patches a retained GPU buffer with no CPU re-upload and no reshape. troika's route fights `sync()`, Skia's `RSXform` requires rebuilding the blob, Unreal has no per-glyph placement at all, Unity makes you mutate its arrays and re-snapshot manually. This capability is justified by GPU-resident retained batching and must be kept.
- **Per-glyph read is where we are behind everyone.** We expose no glyph extents, so no caret, no selection rectangle, and no hit test can be built on top. troika ships `getCaretAtPoint`/`getSelectionRects`, Skia `getClosestGlyphClusterAt`, Flutter `getClosestGlyphInfoForOffset`, the DOM `Range.getClientRects()`. The only route to extents in this repo is decoding technique-specific packed records, which is the internal-representation leak again.

## Delete

Published surface with no use case. Each row carries the evidence that justifies removal.

| Surface | Evidence |
| --- | --- |
| `Text.coreProperties`, `needsApply`, `semanticChanges`, `textMutations`, `markApplied`, `bind`, `unbindFrom`, `runtime`; `TextGroup.bindText` | The reconciler protocol, published. Zero external callers, zero doc mentions. Two take or return types the emitted `.d.ts` declares but does not export, so a caller can invoke them but cannot name them. `markApplied()` clears the mutation queue, so one call publishes a paragraph whose text buffer no longer matches the engine's. `textMutations()` hands out the exact `{start, deleteCount, insert}` records the deleted mutation API was removed for publishing. |
| `SpanNestingError`, `SpanRange`, `IdentifiedSpanRange` | Exported straight out of `internal/span-cascade.ts`. `assertSpanNesting` and `resolveSpanCascade` have zero callers package-wide, so the error is never thrown. Its premise is also stale: `cascadeOrder` is assigned from array index and the engine resolves by `(root, cascade_order)`, so partial overlap is well defined as last-wins. The type asserts a constraint the engine does not impose. |
| `Text.retry()`, `TextGroup.retry()` | Zero uses. `synchronize()` already self-retries. Nothing a caller can do that the next frame does not. |
| ~~`capacity.policy: 'fixed'`~~ | **Rejected on re-measurement.** The rationale was false: the guard runs from `#ensureCapacity` *before* `session.update()` and compares a text-length upper bound, so a caller can size content against the cap rather than discover it after shaping. Removing it deleted a working capability as an unannounced breaking change. Kept. |
| `FontLeaseError` | Exported, never thrown; used only to build a warning string behind a `DEV` guard, so the lease-leak warning does not exist in production. |
| `normalizeRasterCoverage`, `RasterCoverageError`, `MAX_RASTER_COVERAGE_*` | Zero uses outside `internal/`, where the module stays. |
| ~~`createFontStack`~~, ~~`FontLoadError`~~ | **Rejected on re-measurement (D-267).** The "zero uses anywhere, including tests" claim was wrong for both. `FontLoadError` is thrown from roughly forty sites in `loader.ts` and `text-runtime.ts` — surviving public API — and `loader.test.mjs` and `loader-fuzz-smoke.test.mjs` classify failures by its `code`; withdrawing it leaves a consumer unable to tell a load failure from any other `Error`, which is what Fix 1 below argues against. `createFontStack` is the only validating constructor of the exported `FontStack` interface (same-runtime membership, no duplicates) and builds the D-223 heterogeneous stack in `three-v1.test.mjs`; deleting the factory while keeping the interface leaves callers hand-rolling `{ fonts }` and reaching exactly the state the engine rejects. Both kept. |
| `./text-shaper-abi`, `./font-baker-abi`, `./bitmap-baker-abi`, `./mtsdf-baker-abi`, `./slug-baker-abi` | Zero external uses. They exist to publish struct offsets for pointer arithmetic. `textShaperAbi` already reaches its one legitimate consumer through `/core`. The package's own tests and scripts import them and now do so by relative path; only the entry points are withdrawn. |
| `./bakers/{bitmap,msdf,slug}/validate` | Zero uses outside the package; the package's own tests and scripts reach them by relative path. |

## Keep published, and harden

An earlier revision of this audit demoted `/core` (96 symbols) and `/tsl` (22 symbols) on the claim that they have **no consumers**. That claim is false. `@pmndrs/glyph/three` imports `/core` directly ([`three/text.ts:15`](../../packages/glyph/src/three/text.ts) and `:42`, [`three/engine-plan-target.ts:4`](../../packages/glyph/src/three/engine-plan-target.ts)), exactly as `core.ts`'s own docstring says: "`@pmndrs/glyph/three` is implemented on exactly this surface." The accurate statement is that `/core` has no consumers *outside this package* yet, which is a different fact and does not support withdrawal.

Both subpaths stay published. `/core` is the engine-integration surface, and it is the answer to "how do I integrate this with something that is not our `Text`":

| A host wants | It uses |
| --- | --- |
| Scene objects, our batching, our ordering | `/three` -- `Text` and `TextGroup` |
| The render plan, its own instancing, clipping, and ordering | `/core` -- `TextEngineHost`, `compileRenderPolicy`, `TextEngineRenderPlanView`, plus `/tsl` if it is three.js |
| A different renderer entirely (TypeGPU, another engine) | the same `/core` path |

pmndrs/uikit is the second row, not a special case. It is a three.js library, so it needs no bespoke surface; it wants the plan rather than our `Object3D`s because it owns instancing, clipping, and render ordering across every element type. That is precisely what `/core` is for, and `/three` is simply its first consumer.

What survives from the original objection is a hardening requirement rather than a demotion. `/core`'s contract is currently the Wasm ABI: caller-chosen raw `u32` handles where the repository already has branded `FontHandle` and `RasterHandle` available, caller-supplied opaque byte blobs, a publication whose bytes are valid only until the next Wasm call, and a manual acquire and release refcount pair. The README teaches `plan.u8(patch + patchLayout.opcode)` as the supported idiom. Those are real sharp edges on a surface third parties are now expected to build on, and they are addressed as items 11 and 19 below rather than by withdrawing the entry point.

One stale decision to reconcile: D-118 accepted a renderer-neutral `stageBatch(previous, layout, resource, fontSlot, paint, rasterPixelRatio)` transaction and a `RasterDrawBatch` contract. Neither symbol exists in `packages/glyph/src`. Milestone 10 shipped the render policy and plan view instead, and the three executor consumes those. D-118 describes an architecture that was superseded and should be marked as such, not treated as an outstanding deliverable.

## Fix

These are lettered `F1`-`F9` because the requirement lists elsewhere in this document number from 1 independently. A reference to "item 6" means the numbered requirement; "F6" means the fix below.

F1. **Distinguish frame-rejection causes.** `EngineError::InvalidRequest` collapses more than twenty distinct failures — style splits a cluster, missing style index, missing run, missing font metrics, every arithmetic overflow — into `status 6`. It names no span, paragraph, or offset. Give the engine distinct variants for at least the caller-actionable cases, carry the offending paragraph and style id in the result header, and re-raise as a typed error from `/three` so a consumer never sees a bare integer. `textShaperAbi.status` is exported from `/core` but not `/three`, so a `/three` consumer cannot even map the number to a name without a second import.
F2. **Stop the per-frame rejection loop.** A permanently invalid frame is recompiled and rejected every frame forever, with the last good publication left on screen and no visual signal. `markApplied()` is only reached after a successful update, so `needsApply()` stays true. Latch after repeated identical rejections: stop recompiling, keep `.error`, report once. Reachable today with a type-legal inverted span.
**Shaping and layout do not fail once they have their data.** Every input a caller controls is refused at `set()`, where the offending object is named and the caller is still on the stack. What remains is one class -- an invariant this package broke -- and there is nothing a caller could do about that, so there is no recovery protocol and no `retry()`. The batch reports it once and stops compiling, rather than recompiling an invalid frame at frame rate behind the last good picture; transforms keep running so one broken paragraph does not freeze the scene around it. The machinery that used to decide *when to try again* -- a per-paragraph revision record and the frame-comparison that read it -- is gone, because there is nothing to try again for.

`capacity.policy: 'fixed'` is deliberately not in that class. A caller declaring a hard glyph budget is a real thing to want in a memory-constrained scene, so exceeding it is the policy doing its job, not a failure. The defined behaviour is that the update does not apply, the last complete revision stays visible, development builds warn once with both numbers, and `capacityExceeded` carries it for reporting. It self-heals: the comparison is recomputed each frame rather than latched, so shortening the text or raising the capacity clears it. It used to throw a `RangeError` from inside `updateMatrixWorld`, taking out the whole scene traversal for something the caller had asked for.

F3. **Validate `spans` at `set()`, not at `synchronize()`.** The array carries four invariants enforced at three different times by three different policies: cluster alignment is silently repaired at `set()`, inverted ranges are forwarded and rejected every frame, collapsed ranges are silently dropped at `synchronize()`, and disjoint-or-nested is not enforced at all. Inverted and out-of-range spans are caller arithmetic errors and should throw from `set()` where the stack points at the caller, as `normalizedColumns` and `normalizeCapacity` already do. Cluster resolution stays silent — it is correct and matches CSSOM View.
F4. **Report partial application in the origin lane.** `setGlyphOriginOverrides` and `snapshotGlyphOrigins` both `continue` past a stable id with no record, so an animation frame writing two hundred origins may apply forty with no error and no count. `snapshotGlyphOrigins` additionally seeds `displayed` from the caller's shaped-space fallback, returning one `Float32Array` holding two coordinate spaces with nothing marking the boundary.
F5. **Guarantee the parallel-array invariant.** The one real consumer hand-wrote `assertParallelGlyphIdentity` over six public arrays. Construct `ParagraphLayoutInspection` behind a factory that cannot produce a ragged one, or make `glyphCount` the single authority and document every array as sliced to it.
F6. **Make late `registerThreeRasterPlanProgram` an error.** The registry is module-global and each `TextRuntime` snapshots it once at first coordinator creation, so a later registration is a legal call that silently does nothing and surfaces later as a missing technique. A doc comment is not enforcement.
F7. **Export the `glyphFlags` bit names or drop the field.** Sixteen bits whose meaning lives only in a planning document, which a consumer would have to find and then hardcode indices from.
F8. **Split the React inline props type.** `R3fTextChild` is typed as the full outer props, but `flattenText` honours only `font`, `style`, `paint`, `material`, and `children`. `contentBox`, `capacity`, `pixelSnapping`, `rasterPixelRatio`, `onError`, `ref`, and every `Object3D` prop are silently discarded, and a `ref` on a nested `Text` never fires. Flutter's split of `RichText` (box-level) from `TextSpan` (inline-level) is the precedent.
F9. **Re-export `ParagraphLayoutSummary` and `ParagraphLayoutInspection` from `/three`.** `Text.measureLayout()` and `inspectLayout()` return types a `/three` importer cannot name.

## Reshape

| Surface | To | Precedent |
| --- | --- | --- |
| `measureLayout()`, `inspectLayout()`, `snapshotGlyphOrigins()` returning `undefined` for "not bound to the scene graph" | Distinguish unbound (throw, as `setGlyphOrigins` already does) from "no layout yet", and add a readiness signal so callers stop writing `updateMatrixWorld(true); if (group.error) throw group.error` | troika `sync(cb)` with `syncstart`/`synccomplete`; Flutter `TextPainter.layout()` then `.size` |
| `Text.error` / `onError` as the only signal | Add the positive signal. Today the only way to know a layout committed is that `.error` is still `undefined` | troika `onSync`, which is drei's sole seam onto it |
| No anchoring | `anchorX`/`anchorY` on `ParagraphContentBox`. `contentBox.align` aligns lines within the box; nothing anchors the box, so `r3f-hello-world` hand-computes `position={[-width / 2, height / 2, 0]}` | troika and drei both ship it; drei defaults to `center`/`middle` |
| No glyph extents | Per-glyph advance or bounds, then `caretAt(x, y)` and `selectionRects(start, end)` on top | troika, Skia, Flutter, and the DOM all ship a hit-test surface; we are the only surveyed API with none |

## Goal and current state

**Goal.** Every item in this document implemented, **and every open decision entry it depends on resolved**, landed as a GitHub Stack of pull requests, each one green in CI, each one adversarially reviewed by an external model with every review comment either addressed or answered, and the stack ready to merge. The pmndrs/uikit fork is documented here but is **not** part of this goal; only the package-side API it needs is.

Three `Proposed` decisions in [the register](decision-register.md) are in scope and must reach `Accepted` or be withdrawn with a reason:

- **D-262** — stable-indirect allocation is either reachable from the public API and covered by the D-261 oracle, or removed. The render plan carries `indirectBufferId` and `indirectOffset` on every draw, so an unreachable strategy is currently shipping as dead surface. The example renderer decodes both, which makes the question answerable rather than theoretical.
- **D-155** — a TypeGPU raster program owns an exact `createTarget()` factory. Item 24 cannot ship a coherent `/typegpu` without settling it.
- **D-152 through D-154** — portable raster identity construction without casts, and `select()` returning `undefined` for a glyph with no renderable record. These bear directly on the rule this audit codifies, since a cast is a caller keeping state consistent by hand.

D-015 and D-033 are `Deferred` by intent and are not in scope.

This section is the handoff. Keep it current as work lands, so anyone can resume from it.

| # | Item | State | Where |
| --- | --- | :--: | --- |
| -- | Un-publish the reconciler protocol, delete-list surgery | ✅ | [#104](https://github.com/pmndrs/glyph/pull/104) |
| -- | Keep `/core` and `/tsl` published; correct the false "no consumers" finding | ✅ | #104 |
| -- | `packages/glyph-example-renderer`, a second engine consumer on `/core` alone | ✅ stub | #104 |
| -- | Adversarial review of #104 addressed | ✅ | #104 |
| F1-F3, F6, F9 | Rejection diagnostics, latch, span validation at `set()`, late registration, layout re-exports | ✅ | [#106](https://github.com/pmndrs/glyph/pull/106) |
| -- | **Every caller-reachable path to a frame rejection closed** — overlap, feature ranges, unpaired surrogates all throw at `set()` | ✅ | [#109](https://github.com/pmndrs/glyph/pull/109) |
| F4-F5, F7-F8 | Origin-lane partial application, parallel-array invariant, `glyphFlags` names, React inline props split | ✅ | [#107](https://github.com/pmndrs/glyph/pull/107) |
| 1-3, 5 | Ascent/descent/line height, ink bounds beside advance extents, per-line metrics on the summary | ✅ | #107 |
| -- | Animation API: snapshot to manipulate to restore over glyphs/words/lines | ✅ | #107 |
| -- | Reshape: `commitState()`, cluster-first `caretAt`/`selectionRects` | ✅ | #107 |
| 4, 6-10, 16 | Framework-neutral `Paragraph`, constraint/policy split, intrinsic widths, failure from the measure call, uikit fixture re-pointed, paragraph-scoped revision | ✅ | #109 |
| 24 | `@pmndrs/glyph/typegpu` — Bitmap | ✅ | [#108](https://github.com/pmndrs/glyph/pull/108) |
| 24 | `/typegpu` — MSDF and decoration | 🚧 | `feat/typegpu-msdf` |
| 24 | `/typegpu` — Slug (PR #46 is reference only, never merged) | 🚧 | `feat/typegpu-slug` |
| 11 | Retention and ownership protocol for the render plan | ⬜ | -- |
| 12-15 | Host font path, published size delta, uikit parity gate, correct `uikit-integration.md` | ⬜ | unblocked by #109 |
| 17-23 | Change notification, font readiness, measurement purity, constraint model, direction, baseline contract, revision primitive | ⬜ | unblocked by #109 |
| -- | `anchorX`/`anchorY` (D-272) | ⬜ | -- |
| -- | Resolve overlapping spans per cluster instead of refusing them | ⬜ | engine change, recorded intent |



24. Publish `@pmndrs/glyph/typegpu`, a sibling of `/tsl`: the same technique shaders realized as TypeGPU functions, reusable by any TypeGPU host without adopting our renderer. No scene integration and no engine driving, exactly as `/tsl` carries none. A TSL realization can be rendered to WGSL and GLSL in a browser probe and its final source extracted, rather than translated by inspection. An old pull request from TypeGPU's author carries a partial slug port; assume it needs reimplementation rather than resumption, but read it closely first, because it is authoritative on TypeGPU idiom. See [example renderer](example-renderer.md) for how this divides from the engine-consumer work.

    Bitmap shipped first, end to end: typed schemas and vertex/fragment stages under `src/typegpu/`, the `./typegpu` subpath export, `typegpu` as an optional peer, and build-time embedding of the shader metadata so the published functions resolve without consumer-side tooling. Parity is pinned against the TSL realization's actual generated WGSL — extracted device-free at test time, not translated by eye — which surfaced two facts the port reproduces exactly: coverage pages are read as clamped nearest texels through `textureLoad` (data textures never filter), and pixel snapping multiplies reciprocals in the emitter's own order. MSDF, Slug, and decoration remain.

Two findings that de-risk the list. `TextEngineSession.measureParagraph(request, paragraphId)` already exists, so item 6 is largely a JavaScript-side wrapper rather than a Rust change. And the render plan already models `clipId`, `depthKey`, `orderToken`, `materialId`, and `transformId` across seven tables, so item 11 is a contract over an existing surface rather than a new one.

Corrections this document has already absorbed, recorded so they are not re-derived: `/core` has consumers and stays published; ascent and descent exist per font on `FontMetrics` and are missing only from paragraph measurement; the revisions are published on `/core` and are missing only as paragraph-scoped state; `stageBatch` from D-118 was never implemented and was superseded; `FontLoadError` and `createFontStack` were wrongly listed for deletion; the uikit shadow-adapter stage is not downstream of this cleanup; `Paragraph` lives on `/core` (not the root entry) because its engine session pulls the first-party font-binding compilers, which keeps the root entry's raster-free bundle boundary intact; and "minimum-content width from a zero-width measurement" was wrong as an implementation recipe -- a literal zero-width flow is degenerate, so intrinsic widths are now scanned from the cluster arena in the same measurement pass.

### Open question: an unexplained thirty-kilobyte graph delta

Every runtime graph -- `three-runtime-js`, `bitmap-runtime-js`, `mtsdf-runtime-js`, `slug-runtime-js` -- grew by a near-identical ~30 KB raw across this stack. The semantic record widening from 44 to 68 bytes explains the shaper Wasm and the `/core` subpath, but it does not explain four independent graphs moving by the same amount; that shape points at a single shared module entering each graph.

Reviewed ceilings were raised to the measured values so CI is not blocked on an unanswered question, and the raise is annotated as such in `apps/benchmarks/src/benchmark/package-size-budgets.ts`. Before release, find what entered the graph and either justify it or remove it. Do not treat the current ceilings as reviewed in the normal sense until that is answered.

## Measurement and positioning

Reported from production use: an agent integrating this package "has a hell of a time getting text positioned correctly." The measure surface is the cause, and it is the same gap as the missing glyph extents — both are per-glyph and per-line geometry we compute and do not publish.

`ParagraphLayoutSummary` is what `measureLayout()` returns and its own docstring says it "is suitable for positioning UI, telemetry, and missing-glyph admission checks." It carries `width`, `height`, `contentWidth`, `contentHeight`, `firstBaseline`, `lastBaseline`, `overflowed`, `glyphCount`, `lineCount`, `missingGlyphCount`. Measured against what positioning actually needs:

| Needed | We publish | Elsewhere |
| --- | --- | --- |
| Ascent and descent | **Nothing on any paragraph measurement type.** `FontMetrics` publishes `ascender`, `descender`, and `lineGap` per font, but no measurement or layout type carries them per line or per paragraph. Without them a caller cannot align to a baseline, cap height, or x height | Skia `getLineMetrics()`, Flutter `computeLineMetrics()`, DOM `TextMetrics.fontBoundingBox*` |
| Ink bounds | **Nothing.** `contentWidth`/`contentHeight` are advance-based, so a glyph overhanging its advance — italics, accents, swashes — centres visually wrong | troika publishes `blockBounds` AND `visibleBounds` explicitly; DOM publishes `actualBoundingBoxLeft/Right/Ascent/Descent` beside `width` |
| Per-line metrics | `lineBaselines` and `lineAdvances` exist, but only on the heavy `ParagraphLayout`, never on the summary, and neither carries per-line height, ascent, or descent | Skia and Flutter both return full line metrics from the measure call |
| An anchor | **Nothing.** `contentBox.align` aligns lines within the box; nothing anchors the box itself | troika and drei both ship `anchorX`/`anchorY`; drei defaults to `center`/`middle` |

`width` and `height` additionally echo the authored box under `width: { mode: 'exact' }` — the common case — so the only load-bearing number is `contentWidth`, and it is the advance extent rather than the visual one.

Compounding it, the order of operations is circular and undocumented: positioning needs measurements, measurements need a committed layout, the layout commits inside `updateMatrixWorld`, and `measureLayout()` returns `undefined` until then. There is no readiness signal, so a caller must force a commit by hand and check `error` to find out whether the answer is trustworthy. React has no clean hook point for that at all. This is the same defect as the missing readiness signal in the Reshape table, seen from the caller's side.

Required:

1. Publish ascent, descent, and line height on the measurement summary, per line and for the paragraph.
2. Publish ink bounds beside the advance extents, named so the difference is unmissable. A caller centring text visually must not have to know which one they hold.
3. Add `anchorX`/`anchorY` so the common case needs no arithmetic, and so the anchor is applied where the layout already knows the extents.
4. Make the measure-then-position order non-circular: either a synchronous measure that does not require a committed frame, or a readiness signal that tells a caller when the answer is valid. Flutter's `TextPainter.layout()` followed by a synchronous `.size` is the precedent.
5. Whatever the animation API exposes as per-glyph extents must be the same geometry, from the same source, in the same coordinate space as these paragraph and line metrics.

### Third-party layout hosts: uikit and Yoga

The same gap decides whether `pmndrs/glyph` can be the text solution for pmndrs/uikit. [uikit integration](uikit-integration.md) specifies the contract; this section records what is actually shipped against it.

What is already sound. `ParagraphAxisConstraint` is `unconstrained | at-most | exact`, a one-to-one map onto Yoga's `Undefined | AtMost | Exactly`. `firstBaseline` is measured from the box top edge, which is Yoga's baseline-function convention. Milestone 11.17 made repeated measurement cheap by routing a geometry-only change to a paragraph-scoped synchronous query. The constraint vocabulary and the measurement cost are not the problem.

What is missing. The `Paragraph` interface that [uikit integration](uikit-integration.md) calls the "Minimum core API" -- `measure(constraints)`, `layout(constraints)`, `update(input)`, `dispose()` -- does not exist in the package. There is no `Paragraph` type and no `ParagraphConstraints` type; `measureLayout()` takes no arguments. The paragraph-boundary fixture validates the contract through a hand-written adapter in the benchmarks application, which mutates the retained object and forces a scene-graph commit for every distinct constraint:

```ts
text.contentBox = value;
group.updateMatrixWorld(true);
if (group.error !== undefined) throw group.error;
const measured = text.measureLayout();
```

That is what an integrator must write to answer one Yoga measure callback, and it is unsound in four ways that a retained layout engine makes worse rather than better:

| Hazard | Why a Yoga host makes it worse |
| --- | --- |
| The commit runs inside the callback | Yoga invokes measure during its own layout pass. `updateMatrixWorld(true)` commits the whole `TextGroup`, including every other `Text` in it. A layout engine driving a scene-graph commit is a layering inversion and is re-entrant. |
| A speculative probe mutates authored state | Yoga probes several candidate constraints before resolving one. The last probe is left behind on the object. The fixture needs a `JSON.stringify` memo key to survive it. |
| Yoga may measure a node it never lays out | A frame was committed for it regardless. |
| Errors arrive out of band | Failure surfaces on `group.error` rather than as a result of the measurement, and `undefined` still conflates unbound, uncommitted, and failed. |

`ParagraphContentBox` additionally conflates per-call constraints (`width`, `height`) with stable policy (`wrap`, `align`, `maxLines`, `overflow`, `justify`, columns, indents). Yoga varies two fields per probe, so a host must re-send the entire policy object every call; that conflation is also why the fixture's memo key must stringify the whole object.

One core, one shared gap, two consumer-specific edges. A framework-neutral `Paragraph` -- pure, synchronous, constraint-parameterized, requiring no scene, renderer, or committed frame -- serves both hosts. The three.js `Text` becomes a thin retained wrapper over it, which is also what removes the measure-then-position circularity above. The remaining differences are small and must not be allowed to cross:

- Shared, and missing for both: ascent, descent, and line height per line and per paragraph; and a cluster-aware hit-test, caret, and selection surface. uikit's migration explicitly blocks on the latter because its current query path indexes one layout entry per JavaScript character.
- Needed by a layout host only: minimum-content and maximum-content widths as first-class outputs. Today a host derives `minWidth` from a second full measurement at `{ mode: 'at-most', size: 0 }`, so every `CustomLayouting` recompute pays two measurements. Skia returns `getMinIntrinsicWidth` and `getMaxIntrinsicWidth`, and Flutter returns `minIntrinsicWidth` and `maxIntrinsicWidth`, from a single pass.
- Needed by a positioning caller only: `anchorX`/`anchorY` and ink bounds. Neither may reach paragraph measurement. An anchor applied there would corrupt a host's box arithmetic, and CSS and flex layout are advance-based, so `contentWidth` is the correct extent for Yoga and the wrong one for visual centring. Both extents ship, named so they cannot be confused.

Required, in addition to the five items above:

6. Extract a framework-neutral `Paragraph` with `measure(constraints)` and `layout(constraints)` that need no scene, renderer, or committed frame, and that leave authored state untouched. Re-express the three.js `Text` as a retained wrapper over it.
7. Separate per-call constraints from stable policy so a host varies only the axis constraints per probe.
8. Publish minimum-content and maximum-content widths from a single measurement.
9. Return failure from the measurement itself rather than through an out-of-band group error.
10. Re-point the paragraph-boundary fixture at the real `Paragraph`. While it runs through an adapter that the package does not ship, the fixture proves the adapter, not the contract.

### Shipping the uikit pull request

The goal is a fork of pmndrs/uikit whose text subsystem is replaced by this package, submitted upstream. [uikit integration](uikit-integration.md) already sequences that migration in five steps, but it is written as guidance for uikit's maintainers and assumes surfaces this package does not ship. Three of its five steps are currently blocked, and one is blocked on an API that was never built.

| uikit migration step | Blocked on | Status |
| --- | --- | --- |
| 1. Shadow adapter beside the existing layout | Nothing | Reachable today through the benchmark adapter |
| 2. Replace measurement | `Paragraph` (items 6-10), line and font metrics (item 1), intrinsic widths (item 8) | Blocked |
| 3. Replace positioned layout and rendering | A framework-neutral draw-batch surface | Blocked, and the surface does not exist |
| 4. Replace interaction queries | Cluster-aware hit-test, caret, selection | Blocked |
| 5. Remove the legacy text subsystem | Steps 2 through 4 | Blocked |

Step 3 is the one the existing document overstates. It describes uikit consuming a "selected raster `stageBatch` transaction", but there is no `stageBatch`, `RasterBatch`, or `DrawBatch` anywhere in `packages/glyph/src`. Everything a renderer can consume today arrives as the `Text` and `TextGroup` `Object3D` pair from `@pmndrs/glyph/three`. uikit cannot adopt those: it owns instancing, clipping, transforms, render ordering, and batching, and its whole value is that those stay uniform across every element. Being a three.js library is not the obstacle -- uikit is three.js, so `/three` and `/tsl` coupling is fine -- the obstacle is that our only renderer entry point is a scene object rather than a batch a host can place itself.

There is no `/core` contradiction once the demotion is withdrawn, and no bespoke uikit surface is required. uikit reaches the engine the same way any custom renderer does, through `/core`'s render policy and `TextEngineRenderPlanView`. The gap is not a missing surface but a missing contract on the existing one: a `TextEnginePublication` is borrowed only until the next Wasm call ([`core/host.ts:14`](../../packages/glyph/src/core/host.ts)), and a retained host such as uikit cannot hold that across frames. Item 11 below is therefore a retention and ownership protocol, not a new API.

Required for a submittable pull request, beyond items 1 through 10:

11. A retention and ownership protocol on the existing render plan. Specify whether a host receives borrowed or copied buffers, when it may retain them and when they expire, how it acknowledges a publication, whether it receives dirty ranges or complete arrays, how paragraph and glyph identity survive an update, how multiple techniques and draw partitions are addressed, and the generation semantics for atlas and texture resources. Today the publication is valid only until the next Wasm call, which no retained host can honour.
12. A documented font path for a host that does not use our loader. uikit resolves fonts from URLs through its own signals; `./runtime-bake` exists and must be shown working from a host-owned fetch, with the baked-asset workflow documented for uikit's own font assets.
13. A published size number. uikit is a general UI toolkit, and a Wasm shaper is a real adoption cost that upstream review will raise first. `release:size:check` already enforces reviewed ceilings; the pull request must state the delta a uikit consumer actually pays, split into shaper, raster module, and baked font assets, so the trade is explicit rather than discovered.
14. A parity gate against uikit's own fixtures: text, textarea, selection, clipping, and lifecycle. The paragraph-boundary fixture in this repository proves the seam, not the product.
15. Re-point `docs/planning/uikit-integration.md` at the shipped `Paragraph` and draw-batch surfaces, and correct the `stageBatch` reference. Its fixture-status table must distinguish what the package provides from what the benchmark adapter supplies.

Change notification, from a community report. A community member who attempted the swap reported: "For your yoga integration are you using their `hasNewLayout` method? Uikit wasn't using it before and was thus computing layouts for every component a second time. Improved our cpu performance by around 50%." The method is real -- `hasNewLayout(): boolean` and `markLayoutSeen(): void` are on `Node` in yoga-layout 3.2.1 -- and the fix belongs to uikit, which owns the Yoga nodes. It matters here because it is precisely the gate on when a host calls `layout()`, the one call that materializes per-glyph arrays out of Wasm, and because composing that gate correctly needs something this package does not publish.

The two flags are not equivalent in either direction:

- Yoga reports a new layout, but our positioned output is unchanged. A box can change in an axis the text does not consume, or in the block axis while the inline axis and every line break stay identical. A host gating only on Yoga re-copies every array for nothing. This is the wasted work the report describes, seen from our side.
- Yoga reports no new layout, but our positioned output *has* changed. Text edits, style changes, and asynchronous font resolution all change us without moving the Yoga box. A host gating only on `hasNewLayout` renders stale glyphs. This is a correctness defect, not a performance one, and directing a host to use `hasNewLayout` without giving it a second gate would ship that defect into their fork.

The engine already tracks `planRevision`, `geometryRevision`, `contentRevision`, and `engineRevision`, and `/core` does publish them -- `engineRevision` and `planRevision` on `TextEnginePublication`, the other two on the frame-wire types. What none of them is, is *paragraph-scoped positioned-layout* state: `planRevision` and `engineRevision` are global publication counters, so on a shared engine one paragraph's edit advances the number every other paragraph reads. No revision is published on `ParagraphLayout`, on `Text`, or on any paragraph object. A host must be able to write the composed gate:

```ts
const needsReadback = node.hasNewLayout() || paragraph.layoutRevision !== lastSeenRevision;
```

16. Publish a monotonic layout revision on the paragraph that advances exactly when positioned output changes, so a host can gate readback without copying arrays to compare them.
17. Publish a change notification so a host can mark its own layout node dirty when our content changes beneath it. Yoga's inverse channel is `setDirtiedFunc`; ours does not exist, so a host would have to poll. Asynchronous font resolution makes this mandatory rather than optional: a font that resolves after the first layout pass must be able to dirty the node.

Additional requirements, from adversarial review of this plan:

18. Define the font-readiness state machine. Font loading is Promise-based while `Text` requires an already-loaded font at construction, and a layout host measures synchronously whenever it wants. Specify what `measure()` returns before fonts resolve (pending, fallback metrics, or an error), whether a host may synchronously measure an unresolved paragraph, whether fallback metrics may differ from final metrics in intrinsic width, which revision advances when fallback becomes final, and how the host is dirtied at that moment. Item 17 provides the channel; this item provides its semantics.
19. Specify measurement purity precisely rather than asserting it. Define the complete cache key -- constraints, policy, direction, font-stack identity, font readiness, raster availability, scale, and content revision -- whether equal inputs must return equal results or the identical cached object, whether `measure()` may be re-entered or called while another paragraph is measuring, how long a returned result stays valid once another paragraph is measured, and whether measurement may call back into the host. The engine already rejects one class of re-entry during render-plan application, and its Wasm views are transient, so "pure" alone is not a contract.
20. Complete the constraint model. `ParagraphAxisConstraint` covers unconstrained, at-most, and exact only. Document where percentage, min-width/max-width, and definite-versus-indefinite block sizing are resolved -- in the host before the callback, or in the paragraph -- and what happens when exact conflicts with min or max. Left unstated, two hosts will feed the same paragraph different interpretations.
21. Specify direction inheritance. The engine has a `direction` style property, but a host owns property inheritance. Define how a host-supplied inherited direction reaches the paragraph and how `start` and `end` alignment resolve under RTL.
22. Specify the baseline contract, not just the metrics. `firstBaseline` and `lastBaseline` already exist. What is undefined is the host-facing contract a Yoga baseline function needs: baseline relative to the content box or the outer box, how padding and border participate, what an empty paragraph returns, and which line a multi-line paragraph reports. Publishing ascent and descent does not by itself define `align-items: baseline`.
23. Pin down the revision primitive. A monotonic counter needs identity and overflow rules to be usable: revisions are u32-bounded and the wire rejects overflow rather than defining wraparound; paragraph ids are recycled after removal, so an id alone is not a durable host identity; and "advances exactly when positioned output changes" needs an explicit definition of output equality across glyph ids, stable ids, line baselines, draw partitions, and positions. False positives must be bounded, or a host gains nothing over unconditional readback.

Sequencing. The uikit fork is downstream of items 1 through 23 for anything that replaces uikit's renderer or its query path. It is *not* downstream for the shadow-adapter stage, which this plan's own migration table already marks reachable today: a shadow adapter runs a paragraph beside uikit's existing layout, compares metrics, and changes nothing visible. That stage should start early, because several items above -- the baseline contract, font readiness and dirty propagation, constraint resolution, direction inheritance, and the retention protocol -- are specified more accurately with a real host exercising them than by reasoning alone. The fork is an acceptance consumer and a design feedback loop; only its later stages are strictly downstream.

## The animation API

### What is wrong with the one we have

`snapshotGlyphOrigins` / `setGlyphOrigins` / `clearGlyphOriginOverrides` has one real consumer, `apps/benchmarks/src/techniques/shared/glyph-origin-transition.ts`, and that consumer demonstrates every flaw:

- **The identity we thread through is not the identity it needs.** It ignores `glyphStableIds` and builds its own `${fontHandle}:${glyphId}:${cluster}:${occurrence}` key, because the stable id does not survive the reflow it exists to animate across.
- **It re-asserts invariants the API should carry**, hand-checking six public arrays for equal length and re-checking that the snapshot's `layout` is identical to the one it holds.
- **It discovered a required call by trial.** `clearGlyphOriginOverrides()` is mandatory on settle or an override pinned at the target silently shadows the next committed origins.
- **It cannot tell how much of its write landed**, because both write and read skip missing records silently.
- **Two coordinate spaces arrive in one array** with no discriminant.

### What to build instead

Animation targets what *looks* like a unit on screen — a glyph, a word, a line — not a position in a string. The structure is ours to define and need not be derived from text offsets at all. The shape is an explicit cycle:

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
2. ✅ The delete list, then the demotion of `/core` and `/tsl`. Landed as D-267, with two rows rejected on re-measurement
   as noted in the Delete table.
3. Fixes 1 through 3 — the frame-rejection identity, the rejection loop, and the `spans` validation timing — since those are what a caller actually hits.
4. The animation API, replacing the origin trio, and the measurement and positioning surface with it -- they are the same geometry.
5. The remaining fixes and reshapes.

Each step must keep the packed-lane differential oracle green, and no step may regress the incremental fast path.
