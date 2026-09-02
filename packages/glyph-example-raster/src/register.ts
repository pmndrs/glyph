import { registerRasterPlanProgram } from '@pmndrs/glyph';

import { glyphExamplePlanProgramDefinition } from './portable.js';

/** Renderer-neutral registration performed by the portable package root. */
export const glyphExamplePlanProgram: typeof glyphExamplePlanProgramDefinition = registerRasterPlanProgram(
  glyphExamplePlanProgramDefinition,
);
