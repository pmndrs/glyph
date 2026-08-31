import { uniform } from 'three/tsl';
import { Vector2 } from 'three/webgpu';

/**
 * The lens, shared by the scene that moves the light and the pipeline that
 * fringes the frame.
 *
 * Aberration held at a constant strength and a fixed centre reads as a broken
 * shader. A real lens fringes worst off-axis and around a bright highlight, so
 * both follow the key: the centre tracks where the glint lands on screen and the
 * strength swells as the highlight rakes across the mark. One clock drives the
 * light and the lens together, which is what keeps the frame feeling photographed
 * rather than post-processed.
 */
export const aberrationCentre = uniform(new Vector2(0.5, 0.5));
export const aberrationStrength = uniform(0.16);

export function trackKey(
  x: number,
  y: number,
  viewWidth: number,
  viewHeight: number,
  peak: number,
  falloff: number,
): void {
  const screenX = 0.5 + x / Math.max(viewWidth, 1e-3);
  const screenY = 0.5 - y / Math.max(viewHeight, 1e-3);
  aberrationCentre.value.set(clamp(screenX), clamp(screenY));

  const offAxis = Math.hypot(screenX - 0.5, screenY - 0.5);
  aberrationStrength.value = peak * Math.exp(-offAxis * falloff);
}

function clamp(value: number): number {
  return Math.min(1.4, Math.max(-0.4, value));
}
