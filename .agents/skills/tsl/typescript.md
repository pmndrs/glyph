# TSL with TypeScript

Use the installed Three.js and `@types/three` declarations as a paired contract. Type support changes between releases, so verify a reported gap before adding a workaround.

## Establish the compiler baseline

Measure three isolated fixtures with the repository compiler before committing to a graph-typing strategy:

1. imports only;
2. a typed constant node attached to the intended material or pass;
3. one representative TSL operation from the production graph.

In this repository's initial TypeScript 7.0.2 and `@types/three` 0.185.1 check, the first two fixtures completed in under one second, while a single `positionLocal.x.mul(4)` expression did not complete within 60 seconds. Treat that as a declaration-performance finding, not evidence that the runtime API is invalid. Reproduce it after dependency changes and choose a narrow declaration adapter, a verified upstream update, or another measured solution before building substantial graphs. Do not hide it with scattered casts or disable checking for the renderer.

## Imports

```ts
import * as THREE from 'three/webgpu'
import { Fn, float, uniform, vec3 } from 'three/tsl'

import type Node from 'three/src/nodes/core/Node.js'
import type UniformNode from 'three/src/nodes/core/UniformNode.js'
```

The pinned Three.js package exports `./src/*`, but the project still needs a bundler-aware module resolution mode. Do not add `customConditions` or a source-path import merely because an older workaround recommended it; first prove the installed package and compiler require it.

Use `import type` for type-only source paths. Prefer the public `three/tsl` and `three/webgpu` barrels for runtime values unless a required class is absent there.

## Preserve node types

```ts
type FloatInput = number | Node<'float'>

function asFloat(value: FloatInput): Node<'float'> {
  return typeof value === 'number' ? float(value) : value
}
```

Avoid bare `Node`, `any`, or double casts: they erase useful operator and swizzle information. When TypeScript reports an overly complex union, first name a smaller expression or add the narrow expected node type.

Uniform properties may name both the shader value type and JavaScript value type when inference cannot cross a class boundary:

```ts
readonly strength: UniformNode<'float', number> = uniform(1)
```

## Compatibility adapters

If installed runtime source exposes a valid operation that the paired declaration rejects:

1. capture the smallest compiler reproduction;
2. confirm the runtime export and implementation in the same installed version;
3. check whether the project's exact `@types/three` version already fixes it;
4. isolate one typed adapter or module augmentation at the boundary;
5. add a type fixture and runtime test;
6. link the workaround to its upstream issue and exact affected versions.

Do not scatter `@ts-expect-error` through graph code. If one is unavoidable, make its reason and expected compiler error local and let the compiler fail when the suppression becomes stale.

`TempNode` is a recurring example: some declaration releases model it as a constructable value plus intersection type, which can frustrate subclass declarations. Prefer shipped add-on nodes. Subclass only when the installed declarations compile the exact pattern or a narrow, tested augmentation is justified.

## Type verification

- Compile positive fixtures that exercise the real imports and graph attachment points.
- Bound and record compiler time for a representative graph; type correctness that makes ordinary editing impractical is not an acceptable integration.
- Add negative fixtures only for public generic constraints worth preserving.
- Run the repository's actual TypeScript version; do not validate with a global compiler.
- Pair type success with browser execution because declarations cannot prove shader generation or device behavior.
