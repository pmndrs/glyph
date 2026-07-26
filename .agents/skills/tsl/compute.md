# TSL compute

Use this reference for storage-backed WebGPU compute. Confirm storage-node and renderer signatures against the installed Three.js version.

## Storage and dispatch

```ts
import * as THREE from 'three/webgpu'
import { Fn, instanceIndex, storage, vec4 } from 'three/tsl'

const elementCount = 1024
const values = new Float32Array(elementCount * 4)
const attribute = new THREE.StorageBufferAttribute(values, 4)
const buffer = storage(attribute, 'vec4', elementCount)

const doubleValues = Fn(() => {
  const index = instanceIndex
  buffer.element(index).assign(buffer.element(index).mul(2))
})().compute(elementCount)

await renderer.init()
renderer.compute(doubleValues)
const result = await renderer.getArrayBufferAsync(attribute)
```

After initialization, `compute()` submits work in renderer command order. `computeAsync()` does not by itself prove that the GPU finished the dispatch in the pinned implementation. For a CPU-visible correctness oracle, causally complete the work with `getArrayBufferAsync()` and validate the returned bytes. An ordered GPU consumer can rely on the renderer's command ordering without adding a readback stall.

## Compute-to-render ownership

For a buffer written by compute and read as instanced geometry, keep one attribute as the shared owner:

```ts
import { Fn, attribute, positionLocal, storage } from 'three/tsl'

const positions = new THREE.StorageInstancedBufferAttribute(new Float32Array(count * 4), 4)
const writablePositions = storage(positions, 'vec4', count)

geometry.setAttribute('instancePosition', positions)

material.positionNode = Fn(() => {
  const offset = attribute<'vec4'>('instancePosition', 'vec4')
  return positionLocal.add(offset.xyz)
})()
```

Do not create parallel CPU and GPU buffers without an explicit synchronization reason. When JavaScript mutates the backing array, set the attribute's update flag according to the installed API.

## Bounds and synchronization

- Size typed arrays and storage declarations from one checked element count.
- Ensure the dispatch range cannot index beyond the storage element count.
- Make write/read ordering explicit in the renderer command sequence.
- Avoid CPU readback in a hot path. If readback is required for layout or validation, batch it and measure the actual stall.
- Treat GPU buffer mapping and readback as asynchronous lifecycle operations.
- Dispose buffer owners when their product owner is disposed; do not dispose a shared attribute from a borrowed material or pass.

## Verification

Use small deterministic input vectors first. Prove exact output values or exact render consequences before scaling the dispatch. Capture uncaught shader compilation, device-loss, and WebGPU validation errors. Performance comparisons must include upload, dispatch, synchronization, and any readback cost—not only shader execution.

Do not time `computeAsync()` as GPU execution. When the initialized backend supports timestamp queries, resolve the renderer's compute timestamps and report them separately from initialization, compilation, upload, synchronization, and readback. Keep exact CPU readback outside a hot production path.
