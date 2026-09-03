import { msdfShader } from '../tsl/msdf-shader.js';
import {
  MSDF_EM_SIZE,
  MSDF_EXTENSION,
  MSDF_FORMAT_VERSION,
  MSDF_GENERATOR_VERSION,
  MSDF_GLYPH_RECORD_STRIDE,
  MSDF_KIND,
  MSDF_MAX_EM_SIZE,
  MSDF_MAX_OUTLINE_ATLAS_PIXELS,
  MSDF_MAX_PIXEL_RANGE,
  MSDF_PIXEL_RANGE,
  MSDF_PLANE_UNITS_PER_EM,
  msdf,
  msdfDescriptor,
  msdfDescriptorRasterKey,
  msdfPlanProgram,
  msdfRasterKey,
  msdfSchema,
  type MsdfBinding,
  type MsdfConfiguration,
  type MsdfData,
  type MsdfDescriptor,
  type MsdfOptions,
  type MsdfPageData,
} from '../raster/msdf.js';
import { registerThreeMsdfShader } from './internal/builtin-shaders.js';

registerThreeMsdfShader(msdfShader);

export {
  MSDF_EM_SIZE,
  MSDF_EXTENSION,
  MSDF_FORMAT_VERSION,
  MSDF_GENERATOR_VERSION,
  MSDF_GLYPH_RECORD_STRIDE,
  MSDF_KIND,
  MSDF_MAX_EM_SIZE,
  MSDF_MAX_OUTLINE_ATLAS_PIXELS,
  MSDF_MAX_PIXEL_RANGE,
  MSDF_PIXEL_RANGE,
  MSDF_PLANE_UNITS_PER_EM,
  msdf,
  msdfDescriptor,
  msdfDescriptorRasterKey,
  msdfPlanProgram,
  msdfRasterKey,
  msdfSchema,
};
export type { MsdfBinding, MsdfConfiguration, MsdfData, MsdfDescriptor, MsdfOptions, MsdfPageData };
