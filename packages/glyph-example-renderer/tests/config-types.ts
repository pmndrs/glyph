import { glyph, type Font } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph/raster/msdf';

import { glyphExample } from '@pmndrs/glyph-example-raster';
import { defineExampleConfig, type ExampleText } from '../src/index.js';

const handle = glyph.handle('example:type-proof', defineExampleConfig());
const face = glyph.fontFace('/fonts/Inter.font.glb', {
  format: glyphExample({ paletteSeed: 17 }),
});

const text = handle.createText({ font: face, text: 'inferred' });
text satisfies ExampleText<typeof face>;

const unsupported = glyph.fontFace('/fonts/Inter.font.glb', { format: msdf });
// @ts-expect-error the example config exposes only its declared glyphExample RasterFormat
handle.createText({ font: unsupported, text: 'unsupported' });

declare const rawFont: Font<typeof glyphExample>;
// @ts-expect-error the new example path accepts a FontFace selection and owns its immutable Font lease internally
handle.createText({ font: rawFont, text: 'parallel low-level path' });
