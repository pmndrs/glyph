import { slugShader } from '../tsl/slug-shader.js';
import {
  SLUG_DEFAULT_BAND_COUNT,
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_GENERATOR_VERSION,
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_KIND,
  SLUG_PLANE_UNITS_PER_EM,
  slug,
  slugDescriptor,
  slugDescriptorRasterKey,
  slugPlanProgram,
  slugSchema,
  type SlugData,
  type SlugDescriptor,
  type SlugPageData,
} from '../raster/slug.js';
import { registerThreeSlugShader } from './internal/builtin-shaders.js';

registerThreeSlugShader(slugShader);

export {
  SLUG_DEFAULT_BAND_COUNT,
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_GENERATOR_VERSION,
  SLUG_GLYPH_RECORD_STRIDE,
  SLUG_KIND,
  SLUG_PLANE_UNITS_PER_EM,
  slug,
  slugDescriptor,
  slugDescriptorRasterKey,
  slugPlanProgram,
  slugSchema,
};
export type { SlugData, SlugDescriptor, SlugPageData };
