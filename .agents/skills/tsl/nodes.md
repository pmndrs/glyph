# TSL node graphs

Use this reference for material nodes and reusable shader functions. Confirm names and signatures in the installed `three/tsl` export before use.

The operator examples below describe graph structure. Before adopting one, pass the compiler-latency gate in [typescript.md](typescript.md); the repository's initial pinned compiler/declaration pair expands even a simple operator pathologically.

## Values and operations

```ts
import {
  Fn,
  If,
  Loop,
  attribute,
  float,
  mix,
  normalWorld,
  positionLocal,
  select,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
```

Construct typed values with `float`, `vec2`, `vec3`, `vec4`, `int`, `uint`, and `bool`. Node operations preserve the graph:

```ts
const light = normalWorld.dot(vec3(0, 1, 0)).max(0);
const shaded = mix(vec3(0.05), vec3(0.8), light);
const inside = uv().x.greaterThan(0.25).and(uv().x.lessThan(0.75));
const masked = select(inside, shaded, vec3(0));
```

Use swizzles such as `.x`, `.xy`, `.rgb`, and `.rgba` only on nodes whose type supports them.

## Mutable graph variables

Node expressions are values. Create an explicit variable before assigning:

```ts
const result = vec3(0).toVar('result');

If(condition, () => {
  result.assign(vec3(1, 0, 0));
}).Else(() => {
  result.assign(vec3(0, 0, 1));
});
```

Available compound forms include `.addAssign()`, `.subAssign()`, `.mulAssign()`, and `.divAssign()`.

## Functions

Keep reusable node construction inside `Fn` and invoke it where a node is needed:

```ts
const tint = Fn(([input, amount]) => mix(input, vec3(1), amount));
material.colorNode = tint(texture(map, uv()).rgb, uniform(0.2));
```

An ordinary JavaScript branch inside `Fn` selects graph structure at build time. A TSL `If` emits runtime shader control flow. Prefer `select`, `mix`, `step`, or `smoothstep` when they express the behavior clearly without control-flow divergence; measure before claiming a performance benefit.

Use a JavaScript loop only for a fixed graph expansion. Use `Loop` when the shader must loop at runtime:

```ts
const sum = float(0).toVar();
Loop(sampleCount, ({ i }) => {
  sum.addAssign(samples.element(i));
});
```

## Uniforms, attributes, and textures

```ts
const gain = uniform(1);
gain.value = 0.75;

const instanceColor = attribute<'vec3'>('instanceColor', 'vec3');
const sampled = texture(colorMap, uv()).rgb;
```

Let inference work before adding explicit generics. Preserve a concrete `Node<'vec3'>`-style type when an annotation is necessary; a bare `Node` can erase operator and swizzle information.

Use `.sample(coordinates)` when resampling an existing texture node at explicit coordinates. Check whether the source is a texture node, a pass output, or a raw `Texture` before choosing `texture(...)` versus `.sample(...)`.

## Material attachment points

Start from the material model the product already needs:

- `MeshBasicNodeMaterial` for unlit output;
- `MeshStandardNodeMaterial` or `MeshPhysicalNodeMaterial` for PBR;
- `SpriteNodeMaterial`, `PointsNodeMaterial`, or line node materials for their matching primitive.

Common attachment points include `colorNode`, `opacityNode`, `positionNode`, `normalNode`, `emissiveNode`, `roughnessNode`, `metalnessNode`, and `outputNode`. Verify the property on the installed material declaration instead of assuming every node material exposes every attachment.

## Coordinate inputs

Choose the coordinate space deliberately. Common installed exports include local, view, world, geometry, normal, camera, screen, time, and instance nodes. Name local variables with the space when more than one appears in a graph:

```ts
const worldNormal = normalWorld.normalize();
const localPosition = positionLocal;
```

Do not transplant a formula between WebGL GLSL and WebGPU TSL without checking clip-space depth and screen-coordinate conventions. Use Three.js helpers where available.
