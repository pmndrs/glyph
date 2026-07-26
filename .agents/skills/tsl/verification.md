# TSL verification

Use the narrowest deterministic proof first, then the real product surface.

## Static gate

1. Build the workspace dependencies that provide Three.js-facing exports.
2. Run the repository-pinned TypeScript compiler, lint, and format checks.
3. Measure a representative TSL graph's compiler latency against the import-only baseline. Stop and isolate pathological declaration expansion before adding graph complexity.
4. Reject unexplained `any`, broad casts, stale suppressions, missing disposals, and imports not present in the installed package.
5. If a reference example is part of the change, compile that exact example as a fixture.

Static checks prove host-language structure, not shader validity.

## Browser integration gate

Initialize the real `WebGPURenderer`, construct the product graph, render or dispatch, and fail on:

- page errors and error-level console messages;
- shader compilation or pipeline creation errors;
- WebGPU validation messages and device loss;
- rejected render/compute promises;
- missing causal completion.

Wait on application or GPU completion signals. Do not use sleeps, arbitrary frame counts, or retry-until-green loops as readiness.

Assert the renderer's actual backend after initialization. A requested backend that silently falls back does not prove the requested path. Always fail on browser page and console errors. Inspect the installed renderer source and declarations before wiring renderer error or device-loss callbacks: in the pinned version, the `onError` declaration and runtime payload shape disagree, so any callback bridge needs one narrow tested adapter rather than an untyped handler.

## Correctness evidence

Choose evidence appropriate to the graph:

| Graph | Preferred evidence |
| --- | --- |
| pure node math | exact or tolerance-reviewed numeric oracle |
| compute buffer | deterministic buffer values after explicit completion/readback |
| material | stable pixel samples plus a reviewed reference image |
| post-processing | stable intermediate/final pixels and negative controls |
| migration | old/new parity over the same deterministic scene |

A screenshot alone is useful for review but weak as an automated oracle. Pair it with deterministic assertions. Make a negative control fail to prove the test observes the changed behavior.

For backend pixel comparisons, fix device-pixel ratio, viewport and target size, tone mapping, output and texture color spaces, texture filtering, `flipY`, clear color, alpha semantics, and readback orientation. Record any reviewed tolerance and why exact equality is unavailable.

Keep capability and product claims separate. A synthetic texture/material scene can close a renderer/shader baseline, but only the validated font artifact, glyph records, paragraph geometry, and product lifecycle count as the first font-rendering proof.

## Local GPU and performance

The repository's Vitexec/live browser lane owns hardware-GPU evidence. Confirm the adapter/device and execute the actual workload before calling it GPU-tested. Headless CI remains valuable for deterministic browser behavior but does not substitute for the explicit local GPU gate.

Collect timings only after correctness passes. Separate initialization, compilation, upload, dispatch/draw, synchronization, readback, and steady-state work. Warmups and sample counts must be explicit; retain raw samples and environment identity.

## Lifecycle stress

Exercise creation, resize, repeated execution, disposal, cancellation or navigation teardown, and re-creation. For shared resources, verify exactly one owner disposes them. Bound queues and retained pipelines/buffers when adversarial inputs can create unbounded variants.
