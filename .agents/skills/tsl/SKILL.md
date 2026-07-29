---
name: tsl
description: Implement, migrate, review, debug, or verify Three.js Shading Language (TSL) materials, node graphs, WebGPU compute work, and post-processing. Use for `three/tsl`, `three/webgpu`, NodeMaterial, WebGPURenderer, storage buffers, shader-node typing, or GLSL-to-TSL work; verify every API against the repository's installed Three.js version.
license: MIT
---

# Three.js Shading Language

Build version-matched TSL code and prove it through the repository's real renderer. Treat remembered APIs and this skill's examples as hypotheses until the installed Three.js package confirms them.

## Ground the task

1. Read the nearest `package.json`, renderer setup, material or pass being changed, TypeScript configuration, and relevant tests.
2. Record the installed `three` and `@types/three` versions. Inspect their exports, declarations, and shipped examples before inventing an import, cast, or workaround.
3. Preserve the existing renderer and public boundaries unless the request explicitly includes a migration. TSL is the right tool for a TSL/WebGPU task; it is not a reason to rewrite unrelated working GLSL or WebGL code.
4. Identify the execution surface before coding:

| Surface | Start with |
| --- | --- |
| Material property or vertex deformation | [nodes.md](nodes.md) |
| Storage buffer or compute dispatch | [compute.md](compute.md) |
| Fullscreen pass, MRT, depth, or neighboring samples | [postprocessing.md](postprocessing.md) |
| Existing GLSL or `ShaderMaterial` migration | [migration.md](migration.md) |
| Type errors or source-path imports | [typescript.md](typescript.md) |
| Browser/GPU evidence | [verification.md](verification.md) |

Read only the references needed for the selected surface.

## Keep the two execution times explicit

TSL JavaScript builds a node graph; the generated shader runs later on the GPU.

```ts
if (material.transparent) return transparentGraph // graph-build decision

If(value.greaterThan(0.5), () => {
  result.assign(1)
}) // GPU decision
```

Use ordinary JavaScript only for graph structure known while building. Use TSL nodes for per-vertex, per-fragment, or per-invocation behavior.

## Core patterns

```ts
import * as THREE from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { vec3 } from 'three/tsl'

const material = new THREE.MeshStandardNodeMaterial()
const colorNode: Node<'vec3'> = vec3(0.2, 0.5, 1)

material.colorNode = colorNode

await renderer.init()
```

Keep these invariants visible in local code:

- Build typed node graphs with `three/tsl`; use `three/webgpu` for WebGPU renderer and classes.
- Invoke an `Fn` when a node value is required: `Fn(() => expression)()`.
- Use TSL operations rather than JavaScript operators. Typed free functions such as `add(left, right)` and `mul(left, right)` often make overload selection and review clearer; the repository's patched `NodeExtras` lookup also keeps equivalent method-chain typing tractable.
- Call `.toVar()` before mutation, then use `.assign()` or compound assignment methods.
- Update runtime uniforms through `.value`; changing graph structure requires rebuilding the graph.
- Use `If`, `Loop`, and other TSL control nodes for runtime GPU control flow.
- Await `renderer.init()` before the first WebGPU render or compute dispatch.

## Implementation workflow

1. Start compiler-sensitive TSL work with the focused type regression, then expand to the relevant package or application project using the repository-pinned TypeScript compiler.
2. An import-only fixture, a typed constant attachment, and one representative node operation can help localize a future declaration regression before a complete graph obscures it.
3. Express the smallest graph that preserves the existing behavior.
4. Prefer shipped TSL helpers and add-on nodes over custom render passes.
5. Keep node types intact. Do not cast to a broad `Node` or `unknown` merely to silence the compiler.
6. If declarations disagree with runtime source, isolate the narrowest compatibility adapter and link it to the exact installed-version evidence.
7. Dispose render targets, textures, buffers, passes, and materials according to their owner. Restore renderer state around custom passes.
8. When behavior or cost depends on compiler lowering, emit the final WGSL and fallback GLSL as strings and review their structure. Use [verification.md](verification.md) to distinguish the graph you authored from the program the GPU received.
9. Validate correctness before collecting timings. Use fixed inputs and semantic or visual output evidence, not frame delays.

## Completion gate

Do not call TSL work complete until:

- project typechecking and linting pass without unexplained suppressions;
- a real browser initializes the actual renderer and executes the changed graph;
- the test asserts the selected backend instead of treating a fallback as WebGPU or WebGL2 evidence;
- shader compilation, browser console, and WebGPU validation errors fail the test;
- claims about branches, loops, duplicated work, or specialization are checked against the emitted shader program rather than inferred only from TSL source;
- deterministic values or captured pixels prove the intended result;
- compute and render ordering is causal rather than coordinated by sleeps or arbitrary frame counts;
- a hardware-GPU claim comes from the repository's explicit local GPU lane, not merely a headless browser.

## Maintenance provenance

Adapted from `thejustinwalsh/three-flatland` `skills/tsl` at commit `2935a89fcd9999e8a8b3d3b733f7f7302285cd60`. The repository's pinned Three.js source and declarations remain the operational authority.
