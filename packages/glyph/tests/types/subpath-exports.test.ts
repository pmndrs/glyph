import { defineGlyphConfig } from '@pmndrs/glyph/config/glyph';
import { defineRasterFormat } from '@pmndrs/glyph/config/raster-format';
import { defineTechniqueSchema } from '@pmndrs/glyph/config/schema';
import { useBitmap } from '@pmndrs/glyph/react/bitmap';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { defineTextMaterial } from '@pmndrs/glyph/three/material';
import { unpackSrgbRgba } from '@pmndrs/glyph/shaders/tsl/packed-color';
import { slugRender } from '@pmndrs/glyph/shaders/typegpu/slug-shaders/slug-render';
import { referenceBitmapAtlasUv } from '@pmndrs/glyph/shaders/typegpu/bitmap-reference';

void defineGlyphConfig;
void defineRasterFormat;
void defineTechniqueSchema;
void useBitmap;
void bitmap;
void defineTextMaterial;
void unpackSrgbRgba;
void slugRender;
void referenceBitmapAtlasUv;

import {
  ThreeConfig as experimentalThreeConfig,
  defineThreeConfig as defineExperimentalThreeConfig,
  Text as ExperimentalText,
} from '@pmndrs/glyph/three/typegpu';
void experimentalThreeConfig;
void defineExperimentalThreeConfig({ defaultFontFormat: 'slug' });
void ExperimentalText;
