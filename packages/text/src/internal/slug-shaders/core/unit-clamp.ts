import { d, std } from 'typegpu';

/**
 * Clamp to the unit interval.
 *
 * `std.saturate` resolves to WGSL's `saturate`, which GLSL has no equivalent for, so
 * a core function using it compiles on WebGPU and fails to link on WebGL2. The
 * clamp form is the same operation in both languages.
 */
export function unitClamp(value: number): number {
  'use gpu';

  return std.clamp(value, d.f32(0), d.f32(1));
}
