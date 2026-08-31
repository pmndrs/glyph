/**
 * Stub for `three/addons/inspector/Inspector.js`.
 *
 * R3F v10's WebGPU entry statically imports the three Inspector, and the
 * Inspector imports `REVISION` back out of `three/webgpu` — a genuine import
 * cycle. A bundler that resolves the cycle mid-evaluation hands back a
 * half-initialised module, and the failure surfaces far from its cause: here it
 * arrived as the frame scheduler reading `elapsedTime` off an undefined
 * `loopState`.
 *
 * The Inspector is opt-in devtooling — R3F leaves `state.inspector` null unless
 * it is asked for — so a no-op breaks the cycle and costs nothing. Aliased in
 * `vite.config.ts`. pmndrs/paris-site carries the same stub for the same
 * upstream bug.
 *
 * Remove once the alpha makes that import lazy.
 */
export class Inspector {
  dispose() {}
  init() {}
}

export default Inspector;
