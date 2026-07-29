# GLSL-to-TSL migration

Migrate behavior, not syntax. Preserve the current renderer and shader path unless the requested outcome includes moving to WebGPU/TSL.

## Establish the contract

Before changing code, record:

- material inputs, defines, attributes, varyings, uniforms, textures, and render state;
- vertex and fragment outputs;
- coordinate spaces and depth conventions;
- transparency, blending, culling, derivatives, extensions, and precision assumptions;
- representative visual fixtures and numeric edge cases.

This contract is the oracle for the migration.

## Use the installed transpiler as a draft

When the pinned Three.js version ships the GLSL decoder and TSL encoder, use those exact modules to generate a starting graph:

```ts
import GLSLDecoder from 'three/examples/jsm/transpiler/GLSLDecoder.js';
import TSLEncoder from 'three/examples/jsm/transpiler/TSLEncoder.js';

const decoder = new GLSLDecoder();
const encoder = new TSLEncoder();
encoder.iife = false;

const ast = decoder.parse(shaderWithMain);
const draft = encoder.emit(ast);
```

Inspect the installed modules before depending on this API; examples/transpiler code can change independently of the stable application surface. A generated draft is not verification.

## Translate by responsibility

| GLSL responsibility        | TSL direction                                                                   |
| -------------------------- | ------------------------------------------------------------------------------- |
| uniform declaration        | `uniform(initialValue)` and `.value` updates                                    |
| attribute                  | typed `attribute(...)` node                                                     |
| varying                    | built-in coordinate node or explicit `varying(...)`                             |
| vertex position            | material `positionNode` or `vertexNode`                                         |
| material color/PBR channel | matching NodeMaterial attachment point                                          |
| fragment replacement       | `fragmentNode` or `outputNode` only when full replacement is intended           |
| operators                  | node methods such as `.add()`, `.mul()`, and comparisons                        |
| shader branch/loop         | `If`, `select`, `Loop`, and related TSL nodes                                   |
| texture sampling           | `texture(...)`, texture-node sampling, or load helper appropriate to the source |

Do not mechanically replace every `ShaderMaterial` with one material class. Select the NodeMaterial whose lighting and render-state behavior matches the original.

## Coordinate and render-state review

WebGPU and WebGL do not share every clip-space and screen convention. Prefer installed Three.js projection, depth-reconstruction, screen-position, and normal helpers. If manual projection remains necessary, write down the input/output spaces and verify pixels at near, far, edge, and flipped-axis cases.

Carry over non-shader state deliberately: depth test/write, side, blending, alpha test/hash, transparency, polygon offset, stencil, and tone mapping can change output even when the graph math is correct.

## Prove parity

Run the old and new paths over the same camera, geometry, inputs, device settings, and deterministic frame state. Compare stable pixels or semantic buffers with a reviewed tolerance. Include negative controls that make the comparison fail. Remove the old path only after parity and lifecycle tests pass.
