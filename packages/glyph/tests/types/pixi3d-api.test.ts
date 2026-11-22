import type { Container3D } from '@pixi/3d';
import { glyph, slug } from '@pmndrs/glyph';
import {
  createGlyphSlugBits,
  definePixi3DConfig,
  Pixi3DConfig,
  Pixi3DTextMaterial,
  type GlyphSlugBits,
  type Pixi3DHandle,
  type Pixi3DText,
} from '@pmndrs/glyph/pixi3d';

const handle: Pixi3DHandle = glyph.handle('pixi3d:typed', Pixi3DConfig);
void glyph.handle('pixi3d:defined', definePixi3DConfig());
const font = glyph.fontFace('/inter.font.glb', { format: slug });
const text = handle.createText({ font, text: 'Hello', style: { fontSize: 0.5, color: '#ffffff' } });

// A text is a PixiJS 3D scene node.
const node: Container3D = text;
const typed: Pixi3DText = text;
void node;
void typed;

const bits: GlyphSlugBits = createGlyphSlugBits({ headerSize: [8, 4], bandCurveSize: [3072, 1] });
void new Pixi3DTextMaterial({ extraBits: [bits.setup, bits.coverage] });
