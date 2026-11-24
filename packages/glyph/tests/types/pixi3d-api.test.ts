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
  type TextCaret,
  TextOffsetError,
  type TextPosition,
} from '@pmndrs/glyph/pixi3d';
import { TextOffsetError as ThreeTextOffsetError } from '@pmndrs/glyph/three';

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

// The minimal edit: UTF-16 offsets of the source text, refused with the error Three throws.
text.replace(0, 5, 'Howdy') satisfies void;
// @ts-expect-error glyph.shape() throws a failure once, quoting the text; there is no failure to read.
void text.error;
// @ts-expect-error glyph.shape() throws a rejected publication; there is no error callback.
void text.onError;
// @ts-expect-error The inserted text is a string.
text.replace(0, 1, 7);
const caret: TextCaret = text.caret({ offset: 0, affinity: 'downstream' } satisfies TextPosition);
void caret;
const threeError: typeof ThreeTextOffsetError = TextOffsetError;
void threeError;
