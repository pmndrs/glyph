import { defineGlyphConfig } from '@pmndrs/glyph/config/glyph';
import { defineRasterFormat } from '@pmndrs/glyph/config/raster-format';
import { defineTechniqueSchema } from '@pmndrs/glyph/config/schema';
// @ts-expect-error React font loading is part of glyph.fontFace(), not a raster-specific hook leaf.
import '@pmndrs/glyph/react/bitmap';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { defineTextMaterial } from '@pmndrs/glyph/three/material';
import { unpackSrgbRgba } from '@pmndrs/glyph/tsl/packed-color';
import { slugRender } from '@pmndrs/glyph/tsl/slug-shaders/slug-render';
import { referenceBitmapAtlasUv } from '@pmndrs/glyph/typegpu/bitmap-reference';

void defineGlyphConfig;
void defineRasterFormat;
void defineTechniqueSchema;
void bitmap;
void defineTextMaterial;
void unpackSrgbRgba;
void slugRender;
void referenceBitmapAtlasUv;
