import { registerRasterPlanProgram } from '@pmndrs/glyph/config/raster';

import { glyphExamplePlanProgramDefinition } from './portable.js';

/** Renderer-neutral registration performed by the portable package root. */
export const glyphExamplePlanProgram: typeof glyphExamplePlanProgramDefinition = registerRasterPlanProgram(
  glyphExamplePlanProgramDefinition,
);
