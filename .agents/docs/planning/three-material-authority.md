---
type: Research Concept
title: Three material authority for text draws
description: Defines user-owned material factories carried from text and span properties through numeric Rust render-plan material identities.
documentation_type: reference
status: deprecated
tags: [planning, threejs, tsl, materials, render-plan]
sources:
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: engine-contract
    resource: engine-integration-contract.md
    title: Engine integration contract
  - id: raster-technique
    resource: raster-technique-api.md
    title: Raster technique and engine resource API
  - id: ordered-plan
    resource: ../../../packages/glyph/rust/shaper/src/engine/ordered_plan.rs
    title: Rust retained ordered-plan compiler
  - id: render-plan
    resource: ../../../packages/glyph/rust/shaper/src/engine/render_plan.rs
    title: Rust render-plan records
  - id: plan-executor
    resource: ../../../packages/glyph/src/three/engine-plan-target.ts
    title: Three command-buffer executor and material realization
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-04T00:13:53Z'
---

# Three material authority for text draws

> **Historical design record — superseded.** The current public material discriminator is `kind: 'glyph' |
> 'decoration'`; glyph branches carry `format`, while the internal Codec technique identity is not a raster format.
> Use the [current Three.js text API](three-api.md).

Applications may supply a material factory at batch, text, or span scope. `material` is one cascaded rendering property;
the nearest authored value wins. It replaces the former generic `renderVariant` name and the unimplemented `TextEffect`
proposal. The Rust engine carries only a numeric `material_id`, while the Three integration owns the corresponding
factory, `NodeMaterial`, bindings, cache, and disposal.

This boundary keeps layout and shaping renderer-neutral. Rust never stores a JavaScript object, invokes a host callback,
or interprets a Three material. It uses `material_id` only as policy-directed draw compatibility data and writes it into
the fixed render-plan draw record as `materialId`.

## Public construction shape

```ts
type ThreeTextMaterialContext =
  | {
      readonly technique: 'pmndrs.bitmap';
      readonly shader: ThreeBitmapShaderOutput;
      readonly position: Node<'vec3'>;
      createDefaultMaterial(): THREE.NodeMaterial;
    }
  | {
      readonly technique: 'pmndrs.msdf';
      readonly shader: ThreeMsdfShaderOutput;
      readonly position: Node<'vec3'>;
      createDefaultMaterial(): THREE.NodeMaterial;
    }
  | {
      readonly technique: 'pmndrs.slug';
      readonly shader: ThreeSlugShaderOutput;
      readonly position: Node<'vec3'>;
      createDefaultMaterial(): THREE.NodeMaterial;
    }
  | {
      readonly technique: AnyRasterTechnique;
      readonly outputs: ReadonlyMap<string, Node>;
      readonly position: Node<'vec3'>;
      createDefaultMaterial(): THREE.NodeMaterial;
    };

interface ThreeTextMaterial {
  create(context: ThreeTextMaterialContext): THREE.NodeMaterial;
}

interface ThreeRasterMaterialContext {
  readonly raster: AnyRasterFormat;
  readonly schema: TechniqueSchema;
  readonly variantId: string;
  readonly language: string;
  readonly namedBuffers: ReadonlyMap<string, ThreeRasterProgramBuffer>;
  readonly namedResources: ReadonlyMap<string, PortableResource>;
  readonly outputTypes: Readonly<Record<string, string>>;
  readonly resourceName: string;
  readonly instance: Node<'uint'>;
  readonly materialId: number;
  readonly material: ThreeTextMaterial | undefined;
  transformPosition(position: Node<'vec3'>): Node<'vec3'>;
}

interface ThreeRasterVariant {
  readonly id: string;
  readonly language: string;
  readonly geometry: TechniqueGeometryDeclaration;
  createMaterial(context: ThreeRasterMaterialContext): THREE.NodeMaterial;
}

interface ThreeRasterProgram {
  readonly raster: AnyRasterFormat;
  readonly variant: ThreeRasterVariant;
}

declare function defineTextMaterial(
  create: (context: ThreeTextMaterialContext) => THREE.NodeMaterial,
): ThreeTextMaterial;

interface TextGroupOptions {
  readonly material?: ThreeTextMaterial<ThreeRasterShaderOfFont>;
}

interface TextProperties {
  readonly material?: ThreeTextMaterial<ThreeRasterShaderOfFont>;
}

interface TextSpan {
  readonly material?: ThreeTextMaterial<ThreeRasterShaderOfFont>;
}
```

`position` is the exact renderer-local position after policy-selected transform indirection. This is distinct from the
canonical shader's paragraph-local position and prevents a custom material from accidentally bypassing indexed
transforms. The discriminant narrows the exact Bitmap, MSDF, or Slug shader output without a universal union record in
Rust or Wasm. Third-party techniques use the generic plan-program context above: buffers and retained resources are
addressed by the names declared in the portable schema, while Three owns material caching, geometry realization, and
resource lifetime.

```ts
const etched = defineTextMaterial(({ technique, shader, position }) => {
  if (technique !== 'pmndrs.slug') return createFallbackMaterial({ shader, position });
  const material = new THREE.MeshStandardNodeMaterial({ transparent: true });
  material.positionNode = position;
  material.colorNode = mix(shader.color, sheen, shader.coverage);
  material.opacityNode = shader.opacity;
  return material;
});

const text = new Text({ font, text: 'Etched', material: etched });
text.spans = [{ start: 0, end: 3, material: warning }];
```

`createDefaultMaterial()` is the DRY path for changing ordinary material state while retaining the package's canonical
placement, coverage, color, and opacity nodes. Creating another `NodeMaterial` is the low-level path for lighting,
shadows, depth writes/tests, and other standard Three behavior. Neither path may replace or duplicate the technique's
glyph coverage algorithm unless the application registers a complete custom ThreeRasterProgram.

The construction function, runtime-scoped identity registry, command-buffer executor, and public `TextGroup`/`Text`/span
`material` properties are implemented through the atomic Rust-session path.

## Identity and render-plan route

The Three integration interns each live `ThreeTextMaterial` by object identity and assigns a nonzero `u32 material_id`;
zero means the built-in default material. The frame request carries the resolved ID on Rust-owned material segments.
Rust resolves the ordinary batch → text → span cascade, maps clusters to one material ID, and preserves that ID through
glyph primitives into draw packets. Transform ownership is separately policy-selectable. A program may include
transform in its draw key and receive a nonzero draw-level `transformId`, or omit that key and request the first-party
`u32 transformIndex` stream. The latter indexes a renderer-owned region matrix table and permits one compatible draw
across distinct `TextRegion`/`Text` transforms. Transform never enters first-party physical-storage identity.

The registered policy has independent storage and draw key masks. Every first-party policy includes material in its draw
key. A capability-specific policy may omit it from the storage key, producing different material draws over ranges in
the same physical glyph buffers, or include it when per-material schemas or backend addressing make distinct buffers
preferable. A third-party policy may omit material from the draw key only when it packs per-instance material selection
and its renderer can draw those materials together; the draw-level `materialId` is then zero and the policy-owned
physical record is authoritative.

Material assignment changes run/draw planning and any policy-requested material sidecar; it never reshapes text or
recomputes line layout. Stable material-owned uniforms may change outside the core update. Replacing the factory object
changes material identity and schedules render-plan recompilation.

## Construction, caching, and lifetime

Factories run only when the Three integration needs a compatible material/resource realization: first use, a new material
ID, an incompatible resource binding, or a retired realization. They never run in Rust, per glyph, or merely because a
frame was requested. The integration retains a bounded cache keyed by technique, material ID, program, and resource-binding
compatibility.

The integration owns and disposes every material returned by a factory. A factory must return a fresh unowned material for
each invocation; returning a material already owned by another scene object is rejected. Removing a material ID from the
live plan retires it only after the renderer-safe publication/fence boundary. Disposing a material definition still
referenced by a live batch, text, or span is an integration lifecycle error.

## Paint and batching rules

Fill, opacity, outline, and shadow remain Rust-resolved per-glyph paint. The canonical shader consumes those values before
the application material composes its output. A custom material may intentionally ignore canonical color, but it cannot
silently disable required glyph placement, clipping, or coverage. Bitmap still rejects outline/shadow; MTSDF retains its
bounded distance-based implementation; Slug remains fill-only until a separately measured shared-traversal design lands.

Material identity is always independent from shaping/layout and is policy-selectable at the two rendering boundaries.
Adjacent glyph spans with the same draw key form one draw span. Different material IDs may reference the same physical
buffers at different record ranges, or a storage key containing material may partition those records. Rust ordered-plan
tests prove both outcomes rather than leaving the integration to reinterpret the published plan.

## Rejected effects layer

There is no `TextEffect`, effect list, graph-composition registry, or effect parameter schema. Those types duplicated the
material system, introduced a second shader vocabulary, and still could not express ordinary Three lighting/depth/shadow
behavior without material authority. Reusable functions may help applications build `NodeMaterial` graphs, but they are
ordinary Three/TSL code outside the text core contract.

## Required implementation evidence

- batch, text, and nested-span material cascade reaches exact `materialId` draw records without shaping/layout work;
- two materials over one resource share physical glyph buffers and produce ordered draw spans;
- Bitmap, MTSDF, and Slug factories consume the exact canonical shaders used by the command-buffer executor;
- WebGPURenderer and its WebGL2 fallback preserve placement and coverage for default and custom materials;
- replacement, failure, cache eviction, renderer retirement, and disposal preserve the previous complete frame;
- a lit/depth-writing material proves standard Three lighting, depth, and shadow participation where Three supports it;
- untouched text pays no material-factory call, allocation, pipeline rebuild, or extra package import; and
- package raw/minified/gzip/Brotli and first-pipeline costs are reported before the API is marked implemented.

The numeric `material_id` route, material-directed draw compatibility, shared physical glyph storage, rejection of a
second effects vocabulary, and the exact Three factory types above are implemented inputs to the Rust plan. The remaining
evidence bullets are release gates for broadening material behavior, not authority for a parallel renderer target.
