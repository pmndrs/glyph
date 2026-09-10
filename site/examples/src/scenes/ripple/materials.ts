import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, float, instanceIndex, mix, sin, time, vec3 } from 'three/tsl';

import { ACCENT } from '../../theme';
import { WAVE } from './config';

/**
 * A material that moves the type without reshaping it.
 *
 * The paragraph underneath is live — it is restated every time the typist adds a character — and
 * none of that reaches this graph. Shaping decides where a glyph sits on the line; this decides
 * where that line's vertices end up, every frame, on the GPU. The two are independent, which is
 * the point of the example: text can be edited and deformed at once because the deformation never
 * asks what the text says.
 *
 * Two positions matter here and they are not interchangeable:
 *
 * - `context.position` is the composed one — the glyph quad already carried through the glyph and
 *   paragraph transforms. It is what the displacement is added to, so the wave moves the line
 *   from wherever the paragraph put it.
 * - `context.shader.position` is the raw vertex, before those transforms, with x running along the
 *   line from its start. That is what the phase is read from, so the wave travels along the
 *   reading direction rather than along the world.
 *
 * Swapping them still compiles: build the displacement on `shader.position` and the paragraph's
 * placement is dropped, stacking every line at the draw root instead.
 *
 * MSDF only. Slug's position and its coverage are two halves of one graph — the vertex half writes
 * the varying the fragment half integrates over — so replacing its `positionNode` leaves the
 * coverage reading a coordinate nothing wrote, and the glyphs come out blank.
 */
export const rippleInk = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.msdf') return material;

  const along = context.shader.position.x.mul(WAVE.length);
  const stagger = float(instanceIndex).mul(WAVE.stagger);
  const swell = sin(time.mul(WAVE.speed).add(stagger).add(along));

  material.positionNode = context.position.add(vec3(0, swell.mul(WAVE.rise), swell.mul(WAVE.depth)));
  // The crest carries the accent and the trough keeps the paragraph's own colour, so the wave is
  // legible in the colour as well as the silhouette — a still frame of this still reads as a wave.
  material.colorNode = mix(context.shader.color, color(ACCENT), swell.mul(0.5).add(0.5).mul(0.6));
  material.opacityNode = context.shader.opacity;
  return material;
});
