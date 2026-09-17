import { defineTextMaterial } from '@pmndrs/glyph/three';
import { uniform } from 'three/tsl';

export type FadingTextMaterial = Readonly<{
  material: ReturnType<typeof defineTextMaterial>;
  setOpacity(opacity: number): void;
}>;

/** Apply one renderer-local opacity uniform to an MSDF text batch without reshaping it. */
export function createFadingTextMaterial(
  initialOpacity = 1,
  options: Readonly<{ depthTest?: boolean }> = {},
): FadingTextMaterial {
  const opacity = uniform(initialOpacity);
  const material = defineTextMaterial((context) => {
    const next = context.createDefaultMaterial();
    next.depthTest = options.depthTest ?? false;
    next.depthWrite = false;
    // The context is a discriminated union: `kind` separates glyph draws from
    // decoration draws, and `format` names the raster the glyph arm carries.
    if (context.kind === 'glyph' && context.format === 'pmndrs.msdf') {
      next.opacityNode = context.shader.opacity.mul(opacity);
    }
    return next;
  });
  return Object.freeze({
    material,
    setOpacity(nextOpacity) {
      opacity.value = nextOpacity;
    },
  });
}
