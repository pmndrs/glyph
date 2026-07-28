# TSL with TypeScript

Use the installed Three.js and `@types/three` declarations as a paired contract. Type support changes between releases, so verify a reported gap before adding a workaround.

## Establish the compiler baseline

Measure three isolated fixtures with the repository compiler before committing to a graph-typing strategy:

1. imports only;
2. a typed constant node attached to the intended material or pass;
3. one representative TSL operation from the production graph.

In this repository's TypeScript 7.0.2 and `@types/three` 0.185.1 check, a single `positionLocal.x.mul(4)` method-chain expression did not complete within 60 seconds. Assigning the overloaded `mul` value to a narrower local function type also forces an expensive structural comparison of the augmented `Node` surface. The public free-function form `mul(positionLocal.x, 4)` preserves exact node types and completes a clean package-plus-graph check in 0.18 seconds (about 167 MB); the benchmark application completes in 0.17 seconds (about 196 MB). Prefer that form for this pinned pair and keep `tests/types/tsl-scalar-operations.test.ts` as the upgrade regression. This is a declaration-performance finding, not evidence that the runtime API is invalid or that an upstream patch is currently required.

Do not invoke `tsc`, `tsgo`, a package-manager typecheck script, or the `node_modules/.bin/tsc` shim directly. TypeScript 7 delegates to a native executable; a wrapper that supervises only the shim can exit while the compiler survives as an orphan. Run the repository guard's synthetic test once per worktree, then pass only compiler arguments after `--`:

```sh
node .agents/skills/tsl/scripts/run-tsc-bounded.mjs --self-test
node .agents/skills/tsl/scripts/run-tsc-bounded.mjs --cwd packages/text -- -p tsconfig.json --noEmit
```

The guard resolves and executes the installed native compiler directly, caps aggregate tracked RSS at 2 GiB by default, hard-kills on the limit or timeout, and does not report completion until tracked processes are gone. Exit 86 identifies the memory ceiling, 124 the timeout, and 125 a probe or containment failure.

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

Do not assign `add` or `mul` to a custom function type. That assignment asks TypeScript to compare every inherited overload and the complete augmented `Node` interface even though the eventual call is scalar.

Treat all operator-like method chains on augmented nodes—including arithmetic, comparison, bitwise, and shift methods—as the same risk class. Copying a graph from another repository does not waive this constraint: preserve its runtime structure while adapting those calls to the installed public free functions before a whole-project check.

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
- Bound and record compiler time for a representative graph; type correctness that makes ordinary editing impractical is not an acceptable integration.
- Add negative fixtures only for public generic constraints worth preserving.
- Run the repository's actual TypeScript version; do not validate with a global compiler.
- Pair type success with browser execution because declarations cannot prove shader generation or device behavior.
