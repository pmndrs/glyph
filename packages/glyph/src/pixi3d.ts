/** PixiJS 3D integration: Glyph text as `Container3D` nodes drawn through `@pixi/3d` on WebGPU and WebGL2. */
export { glyphBitmapBit } from './pixi3d/bitmap-bit.js';
export { glyphMsdfBit } from './pixi3d/msdf-bit.js';
export { createGlyphSlugBit, createGlyphSlugBits, type GlyphSlugBits } from './pixi3d/slug-bit.js';
export {
  Pixi3DTextMaterial,
  type Pixi3DTextMaterialContext,
  type Pixi3DTextMaterialData,
  type Pixi3DTextMaterialFactory,
  type Pixi3DTextMaterialFormat,
  type Pixi3DTextMaterialOptions,
  type Pixi3DTextMaterialValue,
} from './pixi3d/material.js';
export {
  definePixi3DConfig,
  Pixi3DConfig,
  type Pixi3DConfigOptions,
  type Pixi3DFontFormats,
  type Pixi3DGlyphConfig,
  type Pixi3DHandle,
  type Pixi3DRoot,
} from './pixi3d/config.js';
export {
  Pixi3DText,
  type Pixi3DFontSelection,
  type Pixi3DGlyphMeasurement,
  type Pixi3DTextOptions,
  type Pixi3DTextUpdate,
} from './pixi3d/text.js';
export {
  bitmapGlsl,
  bitmapWgsl,
  msdfFragmentGlsl,
  msdfGlsl,
  msdfWgsl,
  slugFragmentGlsl,
  slugGlsl,
  slugWgsl,
} from './pixi3d/generated/shaders.js';
export { Pixi3DTextSnapshot } from './pixi3d/detached.js';
export { TextOffsetError } from './text-editing.js';
// `Pixi3DText`'s editing methods take and return these; the rest of the vocabulary is on the package root.
export type { TextCaret, TextDirection, TextMovement, TextPosition, TextRange, TextUnit } from './text-editing.js';
