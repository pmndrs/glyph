# TSL with TypeScript

Use the installed Three.js and `@types/three` declarations as a paired contract. Type support changes between releases, so verify a reported gap before adding a workaround.

## Establish the compiler baseline

Measure three isolated fixtures with the repository compiler before committing to a graph-typing strategy:

1. imports only;
2. a typed constant node attached to the intended material or pass;
3. one representative TSL operation from the production graph.

Unpatched `@types/three` 0.185.1 modeled `Node<TNodeType>` as a deeply nested conditional/intersection chain. With TypeScript 7.0.2, ordinary TSL expressions could trigger combinatorial type ordering and variance work. The repository's pnpm patch carries the upstream `NodeExtras` lookup-map rewrite from DefinitelyTyped PR 75246, preserving the public type surface while removing that checker shape.

The permanent TSL regression compiles the formerly pathological method chain, uint shift/bitwise operations, integer `div`/`mod`, vector `fwidth`, and object-form `Loop`. After the lookup-map patch, that focused graph completes in about 215 milliseconds at 4 MiB peak RSS; the text, font-baker, benchmark, and benchmark-script projects complete normally with the pinned compiler. Keep this regression broad enough to fail if a dependency update restores the conditional type tree.

Run the pinned compiler through the package script or pnpm:

```sh
pnpm --filter @pmndrs/text typecheck:slug-tsl
pnpm --filter @pmndrs/text typecheck
```

## Imports

```ts
import * as THREE from 'three/webgpu'
import type { Node, UniformNode } from 'three/webgpu'
import { Fn, float, uniform, vec3 } from 'three/tsl'
```

Three 0.185.1 publicly re-exports `Node` and `UniformNode` from `three/webgpu`. Keep project code on the public `three/webgpu` and `three/tsl` barrels; do not add `customConditions` or a source-path import merely because an older workaround recommended it.

Use `import type` for type-only imports. A source-path import requires exact-version evidence that no public barrel exports the required type and a compile-only regression that makes its removal explicit.

## Preserve node types

```ts
type FloatInput = number | Node<'float'>

function asFloat(value: FloatInput): Node<'float'> {
  return typeof value === 'number' ? float(value) : value
}
```

Avoid bare `Node`, `any`, or double casts: they erase useful operator and swizzle information. When TypeScript reports an overly complex union, first name a smaller expression or add the narrow expected node type.

For arithmetic on the current pinned pair, import the public operator and call it directly:

```ts
import { add, mul } from 'three/tsl'

const x: Node<'float'> = add(origin.x, mul(positionLocal.x, size.x))
```

Avoid assigning `add` or `mul` to a narrower custom function type when an ordinary direct call communicates the same intent. If a future pinned declaration rejects a runtime-supported operation, a private compatibility module can isolate the smallest exact signature while a type fixture owns the discrepancy.

Method chains and free functions both compile tractably with the current lookup-map patch. Prefer the form that keeps the copied graph and expected node type easiest to review, and let the focused regression detect future declaration expansion.

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
- Compile the narrowest TSL fixture before a package or repository project. A whole-project check is not a diagnostic probe for one new graph.
- Record compiler time for a representative graph when changing the declaration boundary; type correctness that makes ordinary editing impractical is not an acceptable integration.
- Add negative fixtures only for public generic constraints worth preserving.
- Run the repository's actual TypeScript version; do not validate with a global compiler.
- Pair type success with browser execution because declarations cannot prove shader generation or device behavior.
