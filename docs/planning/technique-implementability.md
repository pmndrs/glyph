---
type: API Specification
title: Making a technique reusable across engines
description: Gives a technique a reusable identity lookup, portable render contract, and policy-body factory so each engine composes it instead of re-authoring it.
documentation_type: explanation
tags: [planning, public-api, techniques, bakers, extensibility]
status: stable
generated:
  by: anthropic-claude/opus-5
  at: '2026-08-24T00:00:00Z'
---

# Making a technique reusable across engines

## Status and decision

The portable contract, external TypeGPU example, generic Three variant/material path, and first-party Bitmap, MSDF, and
Slug portable plans are implemented. Repeated resource cardinality and fixed-member resource groups close the former
first-party multiplicity gap without moving renderer logic into the technique contract.

The locked decision is:

> A raster technique publishes portable data plus shader implementations. A renderer owns one generic binding/material/primitive path and selects a compatible shader implementation. There is no Glyph-specific adapter required per technique.

Three may expose a renderer-local `createMaterial(context)` helper. That helper is an implementation of a selected shader variant, not a portable core contract and not a special registration escape hatch.

## What is already fixed

`TextEngineHost` accepts arbitrary binding and policy bytes (`packages/glyph/src/core/host.ts`), and core resolves every
registered portable technique program through one binding compiler (`packages/glyph/src/core/font-binding.ts`). This
fixes the old asymmetry where Paragraph called `loadedFontBindingBytes` without the lookup that Three performed and
removes the duplicate first-party binding compilers.

The current branch also provides:

- a portable schema and policy-body factory;
- host-specific policy assembly;
- a renderer-neutral compiled font result containing binding bytes and resources;
- core technique-id lookup and binding composition;
- Three resource/program retention;
- a non-Three example engine with a concrete TypeGPU/WGSL recording device, supplied-geometry realization, and non-empty
  draw acceptance.

Those boundaries remain. The work below must not move Three policy numbers, Three materials, or shader-language types into `/core`.

## Source audit: closed holes

### The primitive is not universally a quad

This branch closes the reusable path. The implementation carries explicit geometry declarations and a GLB-like indexed
geometry payload alongside the existing synthetic-quad path, and the generic Three executor retains both supplied and
generated geometry across compatible updates.

The Three executor creates a `unitQuad()` for a `synthetic-quad` draw. Per-glyph records are attached as
`StorageInstancedBufferAttribute`s and `instanceCount` selects the records; the geometry is shared by the instances in
that draw, not globally across meshes. The same generic executor handles supplied geometry, indexed ranges,
topology-aware conversion, and reuse keys.

The current Slug path is analytic: its curve, band, header, and reference data are evaluated by the shader. It still consumes the unit quad's `positionLocal`; it does not currently emit baked hull vertices. “Hull” may describe the analytic outline representation, but it is not the current draw primitive.

The portable contract must therefore declare a geometry kind rather than hard-code one universal shape. `synthetic-quad` is the implicit/generated unit-quad path; `quad` is an explicit quad geometry supplied by the technique. They must remain distinct because the former needs no geometry payload while the latter follows the supplied-buffer contract. A technique may also supply other geometry and describe it with a constrained GLB-like geometry contract: vertex attribute semantics, accessors and component layout, optional indices, topology, vertex count, and draw range. A `hull` kind is one possible supplied-geometry implementation and does not change the font binding or retention protocol. This vocabulary is separate from the wire primitive enum, whose `glyph` and `decoration` values describe engine command meaning.

### Three material helpers are valid

The current first-party target already composes shader outputs into renderer-owned materials through `packages/glyph/src/three/material.ts`, and the example's `/tsl` realization plus manual registration test proves that a technique-specific Three material helper can be useful.

The change is not to ban `createMaterial(context)`. The change is to place it correctly:

- `/core` publishes no material factory;
- a Three/TSL or Three/TypeGPU implementation may publish `createMaterial(context)`;
- the generic Three executor creates the context from named retained bindings, resources, instance addressing, primitive data, and transforms;
- the executor selects and invokes the helper without requiring the portable plan to know Three.

The context must consume logical names, not require a technique helper to hard-code host policy numbers.

Bitmap, MSDF, and Slug now register their renderer-neutral plans from their raster modules and use the same compiled-font
and named portable-resource path as extensions. Three still dispatches to its built-in material functions by technique
identity, which is renderer-owned shader/material selection rather than a second policy or binding implementation.

### Portable resources are too opaque for a generic renderer

This branch closes the constrained core representation and generic Three consumption. It validates resource identity,
payload ownership, cardinality, group shape, and geometry accessors before a device is touched. First-party techniques use
the same path.

`registerRasterPlanProgram` infers the compiler's authored resource input at the real `retain()` call site. Compilation
normalizes reserved payload kinds into owned portable data before exposing `CompiledRasterFont`; no renderer-owned
`realizeResource` callback crosses the portable or Three program contracts.

The portable resource payload is self-describing enough for generic realization: buffer or texture class, element/sample
format, dimensions or record layout, array-texture layer count where applicable, usage, immutable bytes or geometry data,
and a fixed-member group of those leaf payloads. This is a small vocabulary derived from the shipped techniques, not a
universal GPU object model.

Resource declarations carry `cardinality: 'one' | 'many'`. Bitmap retains one atlas payload per strike under its repeated
render role. MSDF retains one group containing its atlas and pixel-range buffer. Slug retains repeated page groups whose
fixed members are curves, headers, and references. Nested groups and repeated geometry are rejected, and every declared
role must retain the cardinality its schema promises.

The existing `enginePrimitive` wire record has no geometry-resource field (`packages/glyph/src/generated/text-shaper-abi.ts:373-394`). Do not add an ad hoc renderer reference to that record. A supplied geometry declaration names a geometry resource in the technique contract; the compiled resource table carries its immutable bytes, vertex accessors, attributes, indices, topology, and draw range. The renderer combines that declaration with the primitive's existing record span. Geometry never declares an instance count or an instance-rate accessor: the primitive's retained `recordCount` is the sole draw-instance authority, and named policy buffers carry per-record data. Indexed geometry uses its index count and draw range. `synthetic-quad` remains the no-resource path.

Resource realization and geometry views must therefore distinguish the shared geometry payload from per-record policy buffers. A geometry resource may be shared by many records, while every per-record shader input binds through a named policy buffer. The contract must reject mismatched index/component layouts and renderer-owned instance metadata before a device is touched.

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

The portable plan does not carry shader source. The technique package publishes shader realizations as optional subpath modules; each realization consumes the same logical contract regardless of whether it was authored in TypeGPU, TSL, WGSL, or GLSL.

## Package reorganization

The repository must show the external package topology instead of hiding the Three path inside the portable example:

```text
packages/glyph-example-raster/
  portable technique, artifact contract, decoder, baker, plan/schema
  /typegpu shader realization and its typed binding/geometry descriptor
  optional /tsl shader realization; neither subpath owns engine registration

packages/glyph-example-renderer/
  external TypeGPU-backed host proof; a hardware backend may replace its device
  imports the portable raster package, its /typegpu realization, and public Glyph core APIs

packages/glyph/src/three/
  reference Three executor and Glyph-owned built-in registrations
  public registration surface for an application-supplied TSL realization
```

The exact published names may use subpath exports where optional peer dependencies remain genuinely optional, but the invariant is fixed: importing the root portable entrypoint must not install or execute renderer code. The `/typegpu` and `/tsl` shader subpaths are explicit opt-ins; they contain shader functions and compatibility metadata, not Three engine registration or material/resource lifecycle. The root package remains usable without either shader language. A TSL subpath may depend on the Three TSL peer because TSL is its implementation language, but that dependency must not leak into the portable root or the renderer-neutral plan/data modules.

The example renderer is intentionally a concrete TypeGPU-backed host, not a second opaque recorder that merely proves bytes exist. It exercises the headless portion of the generic host responsibilities an external TypeGPU engine would own: select the technique's `/typegpu` realization, resolve it to WGSL, map named plan buffers and retained resources, realize the synthetic-quad draw description, and submit the draw list. Creating a hardware pipeline is a backend concern and is not needed for this acceptance; a different engine can consume the portable package and choose the TypeGPU, TSL, WGSL, GLSL, or its own implementation.

Importing the portable technique registers its renderer-neutral plan program; this is safe for every engine and does not realize GPU resources. Mark the concrete portable registration module and the root facade that imports it in the portable package's `sideEffects` list so a production bundler cannot discard the registration before traversing the root. Keep the portable definition and shader subpaths outside that list. Shader subpaths do not silently register a renderer implementation. The engine or application selects the shader realization it supports: the TypeGPU example consumes `/typegpu` directly, while a Three application supplies the `/tsl` realization to the public `@pmndrs/glyph/three` registration surface. Glyph's own `/three` convenience entrypoint may register Glyph-owned built-ins because Glyph owns that renderer integration. Registration occurs before the first engine snapshot; re-registering the same descriptor object is a no-op, while another object for the same technique id is rejected even if structurally equal. Unused techniques still avoid GPU/resource realization; consumers that need minimum bundle bytes can import only the individual shader subpaths.

This intentionally supersedes D-158's “one technique-scoped import registers both halves” rule: the portable root registers only the plan; a shader subpath supplies only the implementation artifact; the engine or application owns renderer-specific registration and resource realization. The decision-register update must record this split and retain the bundle-size rationale for not registering unused shader variants.

## Required implementation changes

### 1. Define the minimal render contract in portable terms

Evolve the existing `TechniqueSchema` rather than creating a parallel metadata system. Add only the fields needed to describe:

- logical buffer bindings and lane types;
- logical resource bindings and portable resource layouts;
- geometry kind (`synthetic-quad`, `quad`, or supplied geometry) and its coordinate convention;
- the logical geometry resource binding and the renderer-neutral geometry payload's vertex attributes, accessors, indices, topology, and draw range;
- record-span addressing and transform inputs.

Technique-local buffer ids may remain in the wire schema, but shader and renderer-facing metadata refer to declared names. Host system ids remain outside the technique contract.

Add validation for missing names, scalar/vector mismatches, unsupported geometry/resource combinations, absent shader variants, indexed/non-indexed draw-range mismatches, geometry-owned instance metadata, malformed array-texture layer counts, invalid array-texture byte/layer divisibility, and byte payloads that are not already `Uint8Array` values. Validate before copying so coercion cannot turn invalid input into apparently valid bytes. Keep geometry kind disjoint from the wire primitive enum (`glyph`, `decoration`, and future engine command kinds); the wire primitive remains a record-span command, and geometry metadata is resolved from the portable technique/resource contract rather than added to the fixed wire record. Renderer-facing shader-visible outputs and required capabilities belong to the selected renderer variant descriptor in layer 2, not to the portable resource payload.

### 2. Make compiled resource data portable

Replace unconstrained renderer payload assumptions with a constrained portable resource description. Preserve `CompiledRasterFont` as a core result of binding bytes plus retained portable resources. Geometry resources follow the same model as GLB geometry buffers: immutable bytes plus typed vertex accessors and semantic attributes, never Three geometry objects. The schema names the logical geometry/resource binding; the per-font retained payload carries its buffer views, typed accessors, attributes, indices, topology, and draw range. The plan primitive separately carries the record span that drives instancing. Define the resource union and its lifetime/identity rules before changing the Three context: buffers, 2-D textures, and array textures are immutable payloads with owned `Uint8Array` bytes, geometry references buffer views plus accessors/attributes/indices/topology, and resource ids remain stable across retention. Add an explicit declared-resource-name to retained-resource-id mapping (or an equivalent `retain(declaredName, key, payload)` compiler operation); reject a compiler result that retains a resource under a name absent from the schema or omits the geometry resource named by the render contract. This is the link between schema metadata and `CompiledRasterFont.resources`, not a renderer-specific lookup.

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

Define variant lifecycle explicitly. A renderer or application selects one implementation by registering it before the first host/runtime snapshot; a snapshot freezes that `(technique, variant, renderer)` descriptor for the runtime, a second variant for the same technique fails at registration, and disposing the runtime releases the snapshot without disposing package-owned descriptors. Every selected variant reports the geometry/resource capabilities it consumes. Shader-language variants never change the wire `programVariant`: all alternatives share one policy program and compiled binding, and choosing another language means registering that renderer-side realization instead. These rules preserve the registry's freeze and release behavior without inventing a second runtime preference API.

The generic path must support `createMaterial(context)`. Resolve the portable plan independently of the Three variant: a portable program without a compatible Three implementation must fail with an explicit unsupported-variant diagnostic, not fall through to the first-party resource resolver. What disappears is the requirement that a portable technique register a Three-specific program containing policy interpretation, resource ownership, and an opaque callback contract.

First-party Bitmap, MSDF, and Slug use the portable plan/compiler path. Their TSL shader and material logic remains in
Three, where renderer realization belongs; no first-party binding/resource fallback remains.

### 4. Reorganize and implement `glyph-example-raster`

Keep the portable files and baker in the root package. Add the example's `/typegpu` and `/tsl` shader subpaths, each retaining only shader functions plus a descriptor that names the logical inputs it consumes. The TSL subpath may expose a renderer-local `createMaterial(context)` helper, but it does not register itself or own the Three resource cache. Add a supplied-geometry fixture so the package proves that a technique may bring its own GLB-like vertex/index data. Include geometry identity and draw-range/index-count in the Three draw-reuse key; reapply indexed draw range on reuse rather than assuming every realized mesh is an `InstancedBufferGeometry` with only `instanceCount` to update. Resolve third-party `glyphOrigin` from the registered portable schema rather than a first-party literal schema map.

Add a real `/typegpu` realization for the example and make the example renderer execute it through its concrete recording-device/submission path. **Implemented on this branch**, including named resource mapping, WGSL resolution, supplied indexed geometry, and non-empty submission coverage. The recording host proves engine integration and command production, not hardware shader compilation; the separate Three browser proof owns GPU pixels. Keep a `/tsl` realization where the reference Three visible-pixel proof needs it, but keep it as shader code plus the same descriptor—not as a second raster package or a hidden Three adapter. Add a variant descriptor/compatibility fixture showing that TypeGPU, TSL, WGSL, and GLSL implementations consume the same contract. Adding another realization must require only a new shader subpath and renderer selection, never a plan/policy/resource-format rewrite.

The package-boundary test must prove that the root portable entrypoint and `/typegpu` can be imported without Three, while `/tsl` is an explicit opt-in and never auto-registers with Glyph. Enumerate the full source tree, including the portable registration module, rather than maintaining a hand-written file list. Add a production-bundle smoke test for the portable side-effect registration and the explicit Three registration call; source regexes alone do not prove that package `sideEffects` metadata is truthful.

### 5. Rework `glyph-example-renderer` as the external engine example

Make this package the external TypeGPU engine example. **Implemented on this branch.** It must not import Three or TSL, and it must not call a technique-specific material adapter. It imports the public `/core` contract and the example technique's `/typegpu` shader subpath, resolves the shader to WGSL, and drives a concrete headless recording-device/submission path. This proves resource, binding, geometry, and draw-command integration; a hardware TypeGPU/WebGPU device may replace the recording implementation without changing the portable contract.

Update its policy and TypeGPU device to consume the same portable render contract:

- resolve named buffers and resources rather than relying on example-only numeric knowledge;
- validate the declared geometry kind while preserving the wire primitive kind;
- map the selected TypeGPU shader's named inputs to the plan buffers and retained resources;
- realize resource payloads and primitive geometry, then record and submit non-empty draws;
- preserve its own policy system ids and capability set;
- reject an unavailable variant or unsupported geometry explicitly.

The recording device must expose both paths in tests: the implicit generated `synthetic-quad` and an explicit indexed `quad` using a supplied immutable geometry payload. It must record index/draw range and instance count separately so an indexed quad cannot accidentally be treated as four policy records.

Layer 2 must test undeclared resource-name retention and stable resource identity across compiler calls. Layer 3 must test generic user-material delivery, schema-driven glyph-origin augmentation, indexed geometry reuse, decoration preservation, and the diagnostic for a portable plan with no compatible Three variant. Layer 4 must fail variant-only registration at registration time rather than at first runtime construction. The Three acceptance also includes `apps/benchmarks` and its `benchmark:external-raster` visible-pixel proof.

The acceptance test continues to use the real baker and font loader only to obtain a loaded font. The engine itself must still be written against public core/portable surfaces plus the technique's public `/typegpu` shader subpath.

### 6. Make the repository examples external-consumer proofs

The Three example must import the portable package's `/tsl` shader subpath and manually register it through the public `@pmndrs/glyph/three` API. The example renderer must import the portable package's `/typegpu` shader subpath plus `/core`. Neither may reach into `packages/glyph/src` or use a test-only registration shortcut.

The same acceptance vocabulary must cover both:

| Consumer                | Required evidence                                                         |
| ----------------------- | ------------------------------------------------------------------------- |
| Three reference engine  | selected variant, named bindings, material, non-empty visible draw        |
| Example external engine | selected portable contract, resource realization, non-empty recorded draw |

## Sequencing and atomic commits

This feature is one pull request: `feat/render-technique-hardening` on top of `feat/plan-retention`. The implementation may use temporary `feat/...` worktree branches for parallel agent work, but those branches are reviewed, collapsed, and integrated back into this one PR. They are not additional stacked PRs.

Keep the integrated history atomic and green in dependency order:

1. portable contract and constrained resource payloads, including geometry accessor/index semantics and negative tests;
2. generic Three variant selection, named binding/material context, primitive realization, draw reuse, and decoration preservation;
3. portable/Three example package split, registration entrypoints, and shader-variant compatibility fixture;
4. renderer-neutral example device plus the real font/bake/non-empty-draw acceptance path;
5. Bitmap/MSDF/Slug portable resource migration, docs/README/report/decision-register updates, benchmark proof, and generated digests.

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
- installing the portable root or TypeGPU example does not require a Three peer; the TSL peer is scoped to the explicit `/tsl` path;
- Three consumes the example through its public `/three` registration API and the example's explicit `/tsl` shader subpath;
- Three may use a `createMaterial(context)` helper, but the portable plan does not depend on it;
- the example renderer consumes the portable contract through the example's `/typegpu` realization, without Three or TSL imports;
- Bitmap, MSDF, Slug, decoration, and the example preserve explicit wire primitive handling plus declared geometry kinds;
- Bitmap repeated strikes and Slug repeated grouped pages compile through the portable resource contract;
- `synthetic-quad` rendering uses one generated geometry per draw, shared by its instanced records;
- `quad` rendering can use technique-supplied GLB-like geometry buffers;
- supplied geometry can arrive as portable GLB-like buffers with vertex attributes, typed accessors, optional indices, topology, and draw range, while the plan record span remains the sole instance-count authority;
- the contract has a language-neutral compatibility fixture proving that TypeGPU/TSL/WGSL/GLSL implementations do not change plan, policy, binding, resource, or retention formats;
- `glyph-example-renderer` loads a font, resolves and maps the example `/typegpu` shader through a concrete recording-device/submission path, and records/submits non-empty draws;
- the reference Three path produces non-empty visible draws;
- `apps/benchmarks` runs the external raster proof through the public package exports, including the bundled visible-pixel path;
- `apps/benchmarks` runs the named cold/retained Three lab and enforces non-empty draw and reuse invariants;
- focused package checks, each affected package check, `docs:check`, and the repository check pass.

## Cost

The reusable plan work is complete as a medium-to-large renderer refactor across core metadata, generic Three realization,
first-party portable plans, two example packages, tests, benchmarks, and docs. This work did not rewrite shaping, baking,
layout, or the Wasm engines.
