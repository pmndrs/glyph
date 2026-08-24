---
type: API Specification
title: Making a technique reusable across engines
description: Gives a technique a reusable identity lookup, portable render contract, and policy-body factory so each engine composes it instead of re-authoring it.
documentation_type: explanation
tags: [planning, public-api, techniques, bakers, extensibility]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-08-24T00:00:00Z'
---

# Making a technique reusable across engines

## Status and decision

The first half of this plan is implemented on this branch. The remaining work is the renderer contract that makes the repository's example packages behave like an external third-party technique and engine.

The locked decision is:

> A raster technique publishes portable data plus shader implementations. A renderer owns one generic binding/material/primitive path and selects a compatible shader implementation. There is no Glyph-specific adapter required per technique.

Three may expose a renderer-local `createMaterial(context)` helper. That helper is an implementation of a selected shader variant, not a portable core contract and not a special registration escape hatch.

## What is already fixed

`TextEngineHost` accepts arbitrary binding and policy bytes (`packages/glyph/src/core/host.ts`), and the core now resolves portable technique programs before the built-in fallback (`packages/glyph/src/core/font-binding.ts`). This fixes the old asymmetry where Paragraph called `loadedFontBindingBytes` without the lookup that Three performed.

The current branch also provides:

- a portable schema and policy-body factory;
- host-specific policy assembly;
- a renderer-neutral compiled font result containing binding bytes and resources;
- core technique-id lookup and binding composition;
- Three resource/program retention;
- a non-Three example engine with a concrete recording device and non-empty draw acceptance.

Those boundaries remain. The work below must not move Three policy numbers, Three materials, or shader-language types into `/core`.

## Source audit: the remaining holes

### The primitive is not universally a quad

The current Three target creates a `unitQuad()` per draw at `packages/glyph/src/three/engine-plan-target.ts:567` and draws it with `InstancedBufferGeometry`. Per-glyph records are attached as `StorageInstancedBufferAttribute`s and `instanceCount` selects the records; the geometry is shared by the instances in that draw, not globally across meshes.

The current Slug path is analytic: its curve, band, header, and reference data are evaluated by the shader. It still consumes the unit quad's `positionLocal`; it does not currently emit baked hull vertices. “Hull” may describe the analytic outline representation, but it is not the current draw primitive.

The portable contract must therefore declare a geometry kind rather than hard-code one universal shape. `synthetic-quad` is the implicit/generated unit-quad path; `quad` is an explicit quad geometry supplied by the technique. They must remain distinct because the former needs no geometry payload while the latter follows the supplied-buffer contract. A technique may also supply other geometry and describe it with a constrained GLB-like geometry contract: attribute semantics, accessors and component layout, optional indices, topology, vertex count, and instance rate. A `hull` kind is one possible supplied-geometry implementation and does not change the font binding or retention protocol. This vocabulary is separate from the wire primitive enum, whose `glyph` and `decoration` values describe engine command meaning.

### Three material helpers are valid

The current first-party target already composes shader outputs into renderer-owned materials through `packages/glyph/src/three/material.ts`, and the example's `src/three.ts` proves that a technique-specific Three material helper can be useful.

The change is not to ban `createMaterial(context)`. The change is to place it correctly:

- `/core` publishes no material factory;
- a Three/TSL or Three/TypeGPU implementation may publish `createMaterial(context)`;
- the generic Three executor creates the context from named retained bindings, resources, instance addressing, primitive data, and transforms;
- the executor selects and invokes the helper without requiring the portable plan to know Three.

The context must consume logical names, not require a technique helper to hard-code host policy numbers.

The current built-in path explains why importing `/three` does not register Bitmap, MSDF, or Slug today. `ThreeTextEngineCoordinator` snapshots only the custom plan-program registry (`packages/glyph/src/three/engine-runtime.ts:81-95`); absent a custom entry, `#registerResources` handles the three first-party data shapes directly (`:220-238`) and `engine-plan-target.ts:773-787` dispatches to the built-in material functions by technique id. This is the existing raster path, not an unused or unsupported path. The generic migration should preserve it until each built-in is registered through the new contract, after which the `/three` convenience entrypoint may register all Glyph-owned variants while individual/manual registration remains available for extensions.

### Portable resources are too opaque for a generic renderer

`CompiledRasterFont` currently carries a generic `Resource` parameter and the Three path uses a renderer-owned `realizeResource` callback. That is sufficient for reuse, but not for a renderer that knows only the declared contract.

The portable resource payload must become self-describing enough for generic realization: buffer or texture class, element/sample format, dimensions or record layout, usage, and immutable bytes or geometry data. This is a small vocabulary derived from the resources the shipped techniques actually use; it is not a universal GPU object model.

The existing `enginePrimitive` wire record has no geometry-resource field (`packages/glyph/src/generated/text-shaper-abi.ts:373-394`). Do not add an ad hoc renderer reference to that record. A supplied geometry declaration names a geometry resource in the technique contract; the compiled resource table carries its immutable bytes, accessors, attributes, indices, topology, and instance-rate metadata. The renderer combines that declaration with the primitive's existing record span. Indexed geometry uses its index count and draw range; instanced geometry uses the retained record count as its instance count. `synthetic-quad` remains the no-resource path.

Resource realization and geometry views must therefore distinguish the shared geometry payload from per-record policy buffers. A geometry resource may be shared by many records, while a supplied per-instance attribute still binds through the named policy/resource view. The contract must reject mismatched index/component layouts before a device is touched.

### Decoration remains a renderer-owned built-in

`pmndrs.decoration` is currently a Three-policy-reserved, resource-free branch rather than a portable raster program (`packages/glyph/src/three/render-policy.ts:40-62,235-266`). The generic executor must preserve that branch while raster programs move to the variant path; the built-in migration layer must explicitly test decoration before deleting or simplifying the old executor branches (`packages/glyph/src/three/engine-plan-target.ts:484-490,501-525,731-771`). It is not silently converted into a raster package in this change.

## Target ownership model

```text
portable technique package
  identity, baker, decoder, schema, policy body, binding compiler
  logical render contract and portable resources

shader variant package
  TypeGPU, TSL, WGSL, GLSL, or another implementation
  optional renderer-local material/pipeline helper

renderer package
  policy assembly with host-owned ids
  generic resource realization and named binding
  primitive realization, material creation, transforms, submission
```

The portable plan does not carry shader source. A shader variant consumes the same logical contract regardless of whether it was authored in TypeGPU or TSL.

## Package reorganization

The repository must show the external package topology instead of hiding the Three path inside the portable example:

```text
packages/glyph-example-raster/
  portable technique, artifact contract, decoder, baker, plan/schema
  no Three, TSL, TypeGPU, or renderer dependency in the package dependency graph

packages/glyph-example-raster-three/
  Three implementation of the example technique
  TSL shader/material helper and Three peer dependency

packages/glyph-example-renderer/
  external non-Three engine proof
  imports only the portable raster package and public Glyph core APIs
```

The exact published names may use subpath exports where optional peer dependencies remain genuinely optional, but the invariant is fixed: importing the portable package must not install or execute Three code. Remove the hard `three` dependency from `glyph-example-raster` and mark the main Glyph package's existing `three` peer optional, as its core entrypoints are already Three-free. The sibling package keeps the Three peer on the explicit renderer implementation path.

`glyph-example-raster-three` is not a required Glyph adapter. It is the example technique author's optional Three implementation package. A different engine can consume the portable package and choose the TypeGPU, TSL, WGSL, GLSL, or its own implementation.

Importing the portable technique registers its renderer-neutral plan program; this is safe for every engine and does not realize GPU resources. Mark the concrete portable registration module in the portable package's `sideEffects` list so a technique import cannot be tree-shaken away. The separate `glyph-example-raster-three` package exports its Three variant descriptor and an explicit idempotent registration function, but does not silently register a Three variant merely because it was imported. The renderer/engine implementor chooses and registers the variants it supports; an application may call the same function to install a custom Three technique. Glyph's own `/three` convenience entrypoint may register Glyph-owned built-ins because Glyph owns that renderer integration. The two registries remain independent: non-Three engines import only the portable technique, while Three consumers import the technique plus the selected renderer implementation and register it before the first engine snapshot. Registration occurs before the first engine snapshot, and duplicate registration is allowed only when the descriptor is identical. Unused techniques still avoid GPU/resource realization; consumers that need minimum bundle bytes can import only the individual implementation packages or entrypoints.

This intentionally supersedes D-158's “one technique-scoped import registers both halves” rule: `/raster/*` remains renderer-neutral and registers only the portable plan; the engine or application owns the separate renderer-variant registration. The decision-register update must record this split and retain the bundle-size rationale for not registering unused renderer variants.

## Required implementation changes

### 1. Define the minimal render contract in portable terms

Evolve the existing `TechniqueSchema` rather than creating a parallel metadata system. Add only the fields needed to describe:

- logical buffer bindings and lane types;
- logical resource bindings and portable resource layouts;
- geometry kind (`synthetic-quad`, `quad`, or supplied geometry) and its coordinate convention;
- supplied geometry attributes, accessors, indices, topology, and instance rate when the primitive is `quad` or another supplied geometry kind;
- the geometry resource binding, index count/range, and whether record count supplies the instance count;
- instance addressing and transform inputs;
- shader-visible outputs and required capabilities.

Technique-local buffer ids may remain in the wire schema, but shader and renderer-facing metadata refer to declared names. Host system ids remain outside the technique contract.

Add validation for missing names, scalar/vector mismatches, unsupported geometry/resource combinations, absent shader variants, indexed/non-indexed draw-range mismatches, and invalid instance rates. Keep geometry kind disjoint from the wire primitive enum (`glyph`, `decoration`, and future engine command kinds); the wire primitive remains a record-span command, and geometry metadata is resolved from the portable technique/resource contract rather than added to the fixed wire record.

### 2. Make compiled resource data portable

Replace unconstrained renderer payload assumptions with a constrained portable resource description. Preserve `CompiledRasterFont` as a core result of binding bytes plus retained portable resources. Geometry resources follow the same model as GLB geometry buffers: immutable bytes plus typed accessors and semantic attributes, never Three geometry objects. Define the resource union and its lifetime/identity rules before changing the Three context: buffers/textures are immutable payloads, geometry references a buffer view plus accessors/attributes/indices/topology, and resource ids remain stable across retention. Add an explicit declared-resource-name to retained-resource-id mapping (or an equivalent `retain(declaredName, key, payload)` compiler operation); reject a compiler result that retains a resource under a name absent from the schema. This is the link between schema metadata and `CompiledRasterFont.resources`, not a renderer-specific lookup.

Do not add GPU objects, `NodeMaterial`, TypeGPU schemas, TSL nodes, or backend handles to this result.

Make the Three material context technique-neutral. The current `ThreeTextMaterialContext` union names only first-party technique ids, so a third-party implementation cannot legally receive a user material. Add a generic declared-output arm and keep first-party convenience arms as renderer-local API details; update `docs/planning/three-material-authority.md` with the stable contract. The generic material helper must be able to consume the resolved material without reintroducing a per-technique adapter.

### 3. Replace the Three program escape hatch with a generic variant path

Refactor `packages/glyph/src/three/plan-program-registry.ts`, `engine-runtime.ts`, and `engine-plan-target.ts` so the renderer:

- resolves a portable plan;
- selects a compatible shader implementation;
- creates named binding views and generic resource views;
- realizes the declared primitive;
- invokes a renderer-local material helper when the selected implementation supplies one;
- retains and disposes the result through the existing material/resource lifecycle.

Define variant lifecycle explicitly. A renderer registers implementations before its first host/runtime snapshot; a snapshot freezes the compatible `(technique, variant, renderer)` descriptors for that runtime; later registration fails; disposing the runtime releases the snapshot but does not dispose package-owned descriptors. Selection is deterministic (preferred declared variant, then an explicitly requested fallback, otherwise a clear unsupported error), and every selected variant reports the geometry/resource capabilities it can consume. Shader-language variants never change the wire `programVariant`: all such variants share one policy program and compiled binding; the variant selects only the renderer-side shader realization. These rules preserve the current registry's freeze and release behavior while removing its per-technique resource/material callback shape.

The generic path must support `createMaterial(context)`. Resolve the portable plan independently of the Three variant: a portable program without a compatible Three implementation must fail with an explicit unsupported-variant diagnostic, not fall through to the first-party resource resolver. What disappears is the requirement that a portable technique register a Three-specific program containing policy interpretation, resource ownership, and an opaque callback contract.

First-party Bitmap, MSDF, and Slug paths should be migrated onto this path after the example proves it. Their existing TSL shader logic remains authoritative during the migration.

### 4. Reorganize and implement `glyph-example-raster`

Move the portable files and baker into the dependency-neutral package. Move the current Three material logic into the Three implementation package, retaining it as a `createMaterial(context)` helper over named bindings and the default synthetic-quad geometry. Add a supplied-geometry fixture so the package proves that a technique may bring its own GLB-like vertex/index data. Include geometry identity and draw-range/index-count in the Three draw-reuse key; reapply indexed draw range on reuse rather than assuming every realized mesh is an `InstancedBufferGeometry` with only `instanceCount` to update. Resolve third-party `glyphOrigin` from the registered portable schema rather than a first-party literal schema map.

Keep the current TSL implementation in the Three package while the contract remains language-neutral. Add a variant descriptor/compatibility fixture showing that TypeGPU, WGSL, and GLSL implementations would consume the same contract; do not promise a new TypeGPU example package until a real TypeGPU implementation exists. Adding a later TypeGPU or WGSL/GLSL implementation must require only a new shader package and renderer registration, never a plan/policy/resource-format rewrite.

The package-boundary test must prove that the portable package can be imported without Three and has no Three-specific subpath, while the separate Three implementation package is an explicit opt-in. Enumerate the full source tree, including the portable registration module, rather than maintaining a hand-written file list. Add a production-bundle smoke test for the portable side-effect registration and the explicit Three registration call; source regexes alone do not prove that package `sideEffects` metadata is truthful.

### 5. Rework `glyph-example-renderer` as the external engine example

Keep this package renderer-neutral. It must not import Three, TSL, or TypeGPU merely to prove the core contract.

Update its policy and recording device to consume the same portable render contract:

- resolve named buffers and resources rather than relying on example-only numeric knowledge;
- validate the declared geometry kind while preserving the wire primitive kind;
- record resource realization, binding maps, primitive creation, and non-empty submission;
- preserve its own policy system ids and capability set;
- reject an unavailable variant or unsupported geometry explicitly.

The recording device must expose both paths in tests: the implicit generated `synthetic-quad` and an explicit indexed `quad` using a supplied immutable geometry payload. It must record index/draw range and instance count separately so an indexed quad cannot accidentally be treated as four policy records.

Layer 2 must test undeclared resource-name retention and stable resource identity across compiler calls. Layer 3 must test generic user-material delivery, schema-driven glyph-origin augmentation, indexed geometry reuse, decoration preservation, and the diagnostic for a portable plan with no compatible Three variant. Layer 4 must fail variant-only registration at registration time rather than at first runtime construction. The Three acceptance also includes `apps/benchmarks` and its `benchmark:external-raster` visible-pixel proof.

The acceptance test continues to use the real baker and font loader only to obtain a loaded font. The engine itself must still be written against public core/portable surfaces.

### 6. Make the repository examples external-consumer proofs

The Three example must import the portable package plus its explicit Three shader package through public exports. The example renderer must import the portable package plus `/core`. Neither may reach into `packages/glyph/src` or use a test-only registration shortcut.

The same acceptance vocabulary must cover both:

| Consumer | Required evidence |
| --- | --- |
| Three reference engine | selected variant, named bindings, material, non-empty visible draw |
| Example external engine | selected portable contract, resource realization, non-empty recorded draw |

## Sequencing and atomic commits

This feature is one pull request: `feat/render-technique-hardening` on top of `feat/plan-retention`. The implementation may use temporary `feat/...` worktree branches for parallel agent work, but those branches are reviewed, collapsed, and integrated back into this one PR. They are not additional stacked PRs.

Keep the integrated history atomic and green in dependency order:

1. portable contract and constrained resource payloads, including geometry accessor/index semantics and negative tests;
2. generic Three variant selection, named binding/material context, primitive realization, draw reuse, and decoration preservation;
3. portable/Three example package split, registration entrypoints, and shader-variant compatibility fixture;
4. renderer-neutral example device plus the real font/bake/non-empty-draw acceptance path;
5. Bitmap/MSDF/Slug migration, docs/README/report/decision-register updates, benchmark proof, and generated digests.

Each commit must pass its focused checks before the next commit is integrated; the final branch must pass every affected package check, `docs:check`, and the repository check. Use `gh stack` for the single PR branch and never merge to `main`. If the base moves, rebase with `git rebase --onto <new-base> <old-base> <branch>`; never use `--skip`. Resolve generated `source_digest` conflicts only with `mise exec -- pnpm scripts run docs:update`.

## Review gates before implementation

Before creating implementation branches:

1. Audit PR #46 read-only against this exact head and record only conflicts with the contract; do not absorb unrelated scope.
2. Send this plan and the relevant source paths to `opencode/x-preview-f-free` (0x Alpha) and Claude Opus for independent adversarial reviews.
3. Update this plan from verified findings; if an external reviewer is unavailable, record the environment limitation rather than treating it as a clean pass.
4. Perform a second local review covering package boundaries, geometry kinds versus wire primitive kinds, resource-name realization, material-helper ownership, registration/tree-shaking, draw reuse, and example acceptance.
5. Only when the available external reviews and the local review find no unresolved contract hole, fan out the six implementation layers to agents in dependency order. Parallel work is allowed only for disjoint layers after their lower-layer contract is green.

## Acceptance

Done means all of the following are true:

- the portable example package imports without a renderer dependency;
- installing the portable example does not require a Three peer; the Three peer is scoped to the explicit renderer implementation path;
- Three consumes the example through an explicit renderer implementation package and public Glyph APIs;
- Three may use a `createMaterial(context)` helper, but the portable plan does not depend on it;
- the example renderer consumes the portable contract without Three, TSL, or TypeGPU imports;
- Bitmap, MSDF, Slug, decoration, and the example preserve explicit wire primitive handling plus declared geometry kinds;
- `synthetic-quad` rendering uses one generated geometry per draw, shared by its instanced records;
- `quad` rendering can use technique-supplied GLB-like geometry buffers;
- supplied geometry can arrive as portable GLB-like buffers with semantic attributes, typed accessors, optional indices, topology, and instance-rate metadata;
- the contract has a language-neutral compatibility fixture proving that a future TypeGPU/WGSL/GLSL implementation does not change plan, policy, binding, resource, or retention formats; the shipped example keeps its TSL implementation until a real TypeGPU implementation is admitted;
- `glyph-example-renderer` loads a font, realizes resources through a concrete device/submission path, and records non-empty draws;
- the reference Three path produces non-empty visible draws;
- `apps/benchmarks` runs the external raster proof through the public package exports, including the bundled visible-pixel path;
- focused package checks, each affected package check, `docs:check`, and the repository check pass.

## Cost

The reusable plan work is complete. This follow-on is a medium-to-large renderer refactor across core metadata, Three realization, two example packages, first-party shader paths, tests, and docs. The hard parts are the constrained portable resource vocabulary and migrating the existing Three executor without weakening its retained material/resource lifecycle. It is not a rewrite of shaping, baking, layout, or retention.
