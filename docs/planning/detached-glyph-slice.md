---
type: Planning Concept
title: Planner-assisted detached glyph slices
description: Defines the synchronous copy contract that turns committed paragraph records into independently owned renderer objects without retaining publication memory or reconstructing child text.
tags: [render-plan, glyphs, threejs, instancing, physics]
sources:
  - id: core-planner
    resource: ../../packages/glyph/src/core/render-planner.ts
    title: Renderer-neutral planner copy surface
  - id: rust-copy
    resource: ../../packages/glyph/rust/shaper/src/engine/state.rs
    title: Planner-assisted glyph and decoration compaction
  - id: three-glyphs
    resource: ../../packages/glyph/src/three/glyphs.ts
    title: Three.js detached Glyphs object
  - id: three-decorations
    resource: ../../packages/glyph/src/three/decorations.ts
    title: Three.js detached Decorations object
  - id: regression
    resource: ../../packages/glyph/tests/integration/three-v1.test.mjs
    title: Detached-plan integration regressions
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-30T00:00:00Z'
---

# Planner-assisted detached glyph slices

Status: accepted and implemented

## Contract

A detached glyph slice is a new renderer-owned object built from selected drawable records in one committed paragraph. It is a copy, not a claim, borrow of text ownership, presentation override, or second live paragraph.

The source paragraph remains bound to its planner and may continue shaping, publishing, or becoming visible. The detached object no longer follows those updates. Its owner decides when to add it to a scene, hide the source, animate its matrices, restore the source, and dispose the copy.

The operation is synchronous from request through renderer import:

1. The renderer identifies drawable records by committed stable glyph ID.
2. `RetainedText.copyGlyphs(ids, target)` asks the existing planner for one complete checkpoint containing only those records.
3. Rust re-runs the installed policy over the selected committed records, compacts semantic and physical buffers, and emits ordinary render-plan tables.
4. The supplied borrowed `PlanTarget` imports buffers, draws, materials, payload leases, and resource relationships before returning.
5. Borrowed Wasm publication memory expires immediately after `accept()` returns. The imported renderer state is then self-contained and independently disposable.

There is no Promise, worker handoff, deferred readiness state, acknowledgment, source A/B slot swap, source publication-generation advance, or source acceptance-frontier change in this path. A target that needs an asynchronous boundary must build a different explicit API; detached Three objects use the synchronous path.

## Why the planner performs the copy

The planner is the authority for relationships among semantic glyphs, physical records, buffers, resources, programs, materials, transforms, and draw ranges. Asking every renderer to reverse those relationships from its current GPU objects would duplicate the most error-prone part of plan compilation and would fail for whitespace, fallback techniques, multi-resource fonts, and supplied geometry.

The renderer still owns engine-specific state. It imports the checkpoint through its normal plan executor, creates or leases GPU resources, clones mutable materials, and adds any engine-specific transform storage. The core does not know about Three.js, physics bodies, collision shapes, or scene nodes.

## Glyph selection

`copyGlyphs()` accepts non-zero unique stable IDs from exactly one committed `RetainedText`. Missing, duplicate, foreign, stale, or empty selections fail at the call. Semantic-only records such as spaces are not requested as draws. Rust indexes drawable technique columns by physical glyph index while resolving semantic metadata through each record's semantic index; the two index spaces must never be conflated.

The emitted checkpoint is complete rather than a patch. Buffer capacities and record indices remain planner-defined, so a renderer allocates from physical plan capacity instead of assuming selected glyph count equals storage size.

## Decorations

Decorations are not glyph records and do not silently ride `RetainedText.copyGlyphs()`. `RetainedText.copyDecorations(target)` emits the committed paragraph's under/over decoration passes as a separate complete checkpoint. Three coordinates both planner requests in `Text.breakApart()` and returns the decoration import as an independently owned `Decorations` object when the committed paragraph actually has decoration draws. Glyph and decoration objects retain separate engine-domain, material, and disposal ownership.

This separation lets callers keep, replace, animate, or omit decoration rendering without coupling decoration lifetime to glyph physics.

## Three.js surface

`Text.breakApart()` is available only after the source renderer state is committed. It synchronously returns the frozen tuple `[Glyphs, Decorations | undefined]`. Both groups use the ordinary Three render-plan executor; the operation does not create one `Text`, mesh, or material per glyph. If decoration import fails, Three disposes the already-created glyph branch before rethrowing, so the call is atomic from the caller's perspective.

```ts
const [glyphs, decorations] = text.breakApart();
text.parent!.add(glyphs); // add as a sibling to preserve the source transform exactly
if (decorations !== undefined) text.parent!.add(decorations);
text.visible = false;

const world = new THREE.Matrix4();
glyphs.getWorldMatrixAt(0, world);
world.compose(position, quaternion, scale);
glyphs.setWorldMatrixAt(0, world);

glyphs.materials[0].opacity = 0.75; // does not mutate the source Text material

glyphs.dispose();
decorations?.dispose();
text.visible = true;
```

The public manipulation surface follows `InstancedMesh` conventions:

- `count` is the number of drawable detached glyphs;
- `glyphAt(index)` returns immutable source identity and grouping metadata;
- `getMatrixAt()` and `setMatrixAt()` read and write full affine matrices in `Glyphs`-local space;
- `getWorldMatrixAt()` and `setWorldMatrixAt()` bridge world-space physics to local instance storage;
- `measurements` retains the original local/world transforms, ink and advance AABBs, anchor lookup, and the retained metric or supplied geometry source;
- `materials` exposes only material instances owned by that detached branch;
- immutable atlas/page GPU resources are coordinator-shared by authenticated resource identity, while mutable materials and per-glyph transform storage are never shared;
- each returned object retains the engine domain it needs, so source `Text`, `Font`, and `FontLoader` owners may be disposed first;
- `dispose()` releases the imported plan, transform storage, materials, shared-resource leases, and engine-domain lease and removes the group from its parent.

The `Glyphs` root starts with the same local transform as the source `Text`. Adding it to the source parent overlays the committed glyphs exactly. Its per-record transform starts at each glyph's committed drawn origin. Parent translation, rotation, and scale therefore remain on the root while physics may operate in world space through the world-matrix methods.

The source-to-copy handoff must be atomic at draw time. Direct matrix assignment re-dirties the root after plan realization, every transform write marks both Three storage and the WebGL2 PBO mirror, and the renderer uploads those buffers before drawing. First-frame and same-render writes are pixel-compared on WebGPU and WebGL2.

## Explicit non-goals

- No mutable snapshot applied back onto a live `Text`.
- No claim/release protocol or physics-body vocabulary in core.
- No cloned planner session for every detached object.
- No child-`Text` reconstruction.
- No automatic source visibility swap, scene attachment, physics-body creation, hull approximation, reset animation, or disposal policy.
- No decoration records hidden inside the glyph checkpoint; Three requests and returns the optional decoration checkpoint explicitly as tuple slot two.

Physics adapters consume `ThreeGlyphMeasurement` and choose their own Box, sphere, polygon, convex hull, or mesh representation. The renderer provides authoritative transforms, bounds, and available draw geometry; it does not label any geometry as a collision shape.

## Required evidence

- A source edit after `breakApart()` cannot replace or mutate detached draw records.
- A detached material edit cannot mutate the live source material.
- A paragraph containing semantic-only whitespace copies the correct later drawable records.
- Nested translated, rotated, and scaled parents preserve exact first-frame world alignment.
- Local/world matrix round trips preserve all 16 lanes within floating-point tolerance.
- Storage allocation uses physical plan capacity, matrix writes coalesce upload ranges, and WebGL2 PBO mirrors become dirty.
- The frozen tuple uses `undefined` when no decoration draws exist; present decorations copy independently and survive source edits.
- Detached objects survive source-first disposal and release the final engine/resource leases when they are disposed.
- WebGPU and WebGL2 produce pixel-identical source, first-detached-frame, and same-render-write output.
