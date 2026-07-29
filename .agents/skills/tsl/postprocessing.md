# TSL post-processing

Use this reference for scene passes, multiple render targets, depth/normal sampling, neighboring texels, and custom fullscreen effects. Prefer installed Three.js add-on nodes over new pass infrastructure.

## Begin with a scene pass

```ts
import * as THREE from 'three/webgpu';
import { mrt, normalView, output, pass, vec4 } from 'three/tsl';

const scenePass = pass(scene, camera);
scenePass.setMRT(
  mrt({
    output,
    normal: normalView,
  }),
);

const colorNode = scenePass.getTextureNode('output');
const normalNode = scenePass.getTextureNode('normal');
const depthNode = scenePass.getTextureNode('depth');

const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputNode = vec4(colorNode.rgb, 1);
pipeline.render();
```

Verify MRT names and pass methods against the pinned version. Do not assume a pass output is a raw `Texture`; keep the texture-node abstraction when the graph must sample it.

## Depth and neighboring samples

Use a texture node when sampling arbitrary coordinates:

```ts
const centerDepth = depthNode.sample(screenUV).r;
const neighborDepth = depthNode.sample(screenUV.add(texelOffset)).r;
```

Current-fragment depth helpers and arbitrary-UV texture sampling are different operations. Choose from the installed pass API according to the effect's actual need. Do not reach through a texture node's `.value` to guess at a render-time attachment.

Prefer installed helpers such as view-position reconstruction, screen-position projection, normal reconstruction, and texture size. They encode renderer conventions more reliably than a copied GLSL formula.

## Prefer shipped effects

Inspect `three/addons/tsl/display/*` and its paired declarations before implementing a custom pass. Shipped effects demonstrate the current renderer lifecycle and are easier to keep aligned with Three.js.

```ts
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';

const ambientOcclusion = ao(depthNode, normalNode, camera);
const filtered = denoise(ambientOcclusion.getTextureNode(), depthNode, normalNode, camera);
```

Read the installed implementation for channel format, uniforms, resolution scaling, disposal, and composition. Do not copy tuning values or assume a result channel from an older release.

## Custom pass threshold

Use `convertToTexture()` for a simple intermediate texture when its lifecycle and resolution behavior are sufficient. Consider a custom pass node only when the effect needs explicit render-target ownership, multiple internal stages, special resizing, or renderer-state control unavailable from shipped helpers.

A custom pass must own and test:

- render-target allocation, format, sample count, resize, and disposal;
- fullscreen material and quad lifecycle;
- renderer target/state save and restore;
- dependency ordering between input and output attachments;
- ping-pong targets when an iteration cannot read from the attachment it writes;
- device loss and partial-construction cleanup.

Follow the installed add-on nodes rather than a stale copied `TempNode` skeleton. Their internal conventions can change with Three.js.

## Coordinate and sampling checks

- Derive texel size from the actual render target or installed `screenSize`/`textureSize` helper.
- Keep UV origin, projection, depth range, view Z, and normal space explicit.
- Verify near/far, background depth, viewport resize, pixel ratio, and odd dimensions.
- Treat MSAA compatibility as a render-target configuration question, not a universal prohibition. Match sample counts or resolve attachments according to the installed renderer behavior.
- For iterative effects, prove each pass reads the previous completed output and never aliases its write target.

## Composition and evidence

Compose the effect with the scene through typed nodes and explicit color/alpha semantics. Test disabled, zero-strength, and extreme inputs. Capture deterministic pixels or intermediate values, attach browser console and WebGPU validation errors to failures, and run on the hardware-GPU lane before making quality or performance claims.
