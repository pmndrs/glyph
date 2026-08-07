---
type: API Specification
title: Three.js text effect composition
description: Optional TSL convenience for composing parameterized effects after canonical raster technique shaders while core carries only opaque render variants.
documentation_type: reference
tags: [rendering, effects, tsl, threejs, webgpu, variants]
status: stable
sources:
  - id: raster-contract
    resource: ../../packages/text/src/raster.ts
    title: Raster module contract
  - id: mtsdf-runtime
    resource: ../../packages/text/src/raster/msdf.ts
    title: MTSDF runtime material and paint implementation
  - id: text-runtime
    resource: ../../packages/text/src/text.ts
    title: Framework-neutral Text lifecycle
  - id: tsl-skill
    resource: ../../.agents/skills/tsl/SKILL.md
    title: Repository TSL implementation guidance
  - id: core-api
    resource: core-api.md
    title: Core render variants and glyph runs
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: typegpu-api
    resource: typegpu-api.md
    title: TypeGPU raster programs and text engine
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-07T03:25:58Z'
---

# Three.js text effect composition

`TextEffect` is optional Three/TSL program authoring sugar. It is not a core concept. Core carries an integration-defined
`renderVariant` from batch, paragraph, and span state into ordered glyph runs; the selected Three program interprets it.

```ts
const chromatic = defineTextEffect(slugShader, {
  parameters: { phase: 'f32' },
  compose(base, parameters, context) {
    return {
      ...base,
      color: chromaticColor(base.color, context.paintIndex, parameters.phase),
    };
  },
});

const text = new Text({
  font,
  text: 'Spectrum',
  renderVariant: {
    effects: [chromatic.bind({ phase: phaseUniform })],
  },
});
```

## Complete helper surface

```ts
type ThreeEffectParameterSchema = Readonly<Record<string, 'f32' | 'vec2f' | 'vec3f' | 'vec4f'>>;
type ThreeNodeFor<Type extends ThreeEffectParameterSchema[string]> = Type extends 'f32'
  ? ReturnType<typeof TSL.float>
  : Type extends 'vec2f'
    ? ReturnType<typeof TSL.vec2>
    : Type extends 'vec3f'
      ? ReturnType<typeof TSL.vec3>
      : ReturnType<typeof TSL.vec4>;
type ThreeEffectParametersOf<Schema extends ThreeEffectParameterSchema> = {
  readonly [Key in keyof Schema]: ThreeNodeFor<Schema[Key]>;
};

interface ThreeTextEffectDefinition<Shader extends AnyThreeRasterShader, Schema extends ThreeEffectParameterSchema> {
  readonly shader: Shader;
  readonly parameters: Schema;
  compose(
    base: ThreeRasterFragmentOutputOf<Shader>,
    parameters: ThreeEffectParametersOf<Schema>,
    context: ThreeRasterFragmentContextOf<Shader>,
  ): ThreeRasterFragmentOutputOf<Shader>;
  bind(parameters: ThreeEffectParametersOf<Schema>): ThreeTextEffectBinding<Shader, Schema>;
}

interface ThreeTextEffectBinding<Shader extends AnyThreeRasterShader, Schema extends ThreeEffectParameterSchema> {
  readonly effect: ThreeTextEffectDefinition<Shader, Schema>;
  readonly parameters: ThreeEffectParametersOf<Schema>;
}

declare function defineTextEffect<Shader extends AnyThreeRasterShader, const Schema extends ThreeEffectParameterSchema>(
  shader: Shader,
  definition: Omit<ThreeTextEffectDefinition<Shader, Schema>, 'shader' | 'bind'>,
): ThreeTextEffectDefinition<Shader, Schema>;

interface ThreeRenderVariant {
  readonly effects?: readonly ThreeTextEffectBinding[];
}
```

The shader argument is what makes the callback contextual: `base`, `context`, and the return type come from that exact
shader, while the literal schema maps every parameter key to its TSL node type. No type parameter is expected to infer only
from a callback parameter position. The heterogeneous binding list is erased only after construction; the standard program
narrows it by retained effect-definition identity before composing or writing parameters.

## Composition boundary

Every effect composes after the program's canonical technique shader:

```ts
let output = slugShader.fragment(context); // canonical curve traversal and coverage
for (const binding of variant.effects ?? []) {
  output = composeKnownEffect(output, binding, context);
}
return output;
```

Bitmap, MTSDF, and Slug retain atlas/curve sampling, coverage reconstruction, clipping, outline constraints, and
technique-specific validation. An effect changes resolved output; it does not replace the hard raster algorithm. A custom
`ThreeRasterProgram` may bypass this helper and define its own variant contract while still calling the same exported
technique shader.

## Batching contract

Effect-definition identity and declaration order determine graph compatibility. Parameter values do not. The standard
program may therefore place bindings for many texts and spans into indexed sidecar storage and draw them together through
one material. A different ordered definition list requires another material/pipeline variant and may split the draw plan.

Core only preserves variant boundaries and text order. It neither assigns TSL material keys nor forces one draw per effect.
Changing a paragraph/span binding rebuilds core glyph runs without reshaping. Updating a stable uniform or sidecar binding
may require no core call and no instance-buffer rewrite.

## Required invariants

- effects compose in declaration order over the previous resolved output;
- graph identity is definition identity plus ordered composition, never current parameter values;
- parameters remain text/span-local even when materials and pipelines are shared;
- semantic context is explicit and small: resolved output, paint/span index, glyph index, and normalized local coordinates;
- unsupported semantic inputs fail while staging and do not replace the live target revision;
- effect bindings and material variants have deterministic leases and disposal;
- TypeGPU-authored pure WebGPU math may adapt only within capabilities proven for the pinned `toTSL()` bridge, while native
  TSL effects remain Three-specific; and
- proof measures graph construction, first pipeline creation, parameter updates, upload changes, CPU submit, GPU time, and
  untouched-text bundle/pipeline cost.

The API is complete only after two chained effects, shared graph/independent parameters, Bitmap and Slug composition,
disposal, pinned WebGPURenderer output, and single-draw multi-variant batching have causal tests. This is an integration
feature layered on the accepted core variant contract; failure of the convenience helper cannot remove core customization.
