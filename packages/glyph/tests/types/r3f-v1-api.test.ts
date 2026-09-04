import { createElement, type ReactElement } from 'react';

import { glyph, type Font, type FontStack } from '@pmndrs/glyph';
import * as ReactApi from '@pmndrs/glyph/react';
import { GlyphProvider, Text, TextGroup, useFont } from '@pmndrs/glyph/react';
import type { R3fTextChild, R3fTextProps } from '@pmndrs/glyph/react';
import { useBitmap } from '@pmndrs/glyph/react/bitmap';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';
import { ThreeConfig, type Text as ThreeText, type ThreeHandle, type ThreeTextMaterial } from '@pmndrs/glyph/three';

declare const bitmapFont: Font<typeof bitmap>;
declare const mtsdfFont: Font<typeof msdf>;
declare const slugFont: Font<typeof slug>;
declare const selectedStack: FontStack<typeof bitmap> | FontStack<typeof msdf> | FontStack<typeof slug>;
declare const material: ThreeTextMaterial;
const three: ThreeHandle = glyph.handle('three:r3f-type-fixture', ThreeConfig);
const msdfFace = glyph.fontFace('/fonts/Inter.font.glb', { format: msdf });

const inline = createElement(Text, { style: { color: '#ff00ff' } }, 'span');
const label = createElement(Text<typeof bitmap>, { font: bitmapFont, material, pixelSnapping: true }, 'Typed ', inline);
const labels = createElement(TextGroup, { material, pixelSnapping: true }, label);
const selected = createElement(Text, { font: selectedStack }, 'Selected at runtime');
const selectedFace = createElement(
  Text,
  { font: msdfFace.msdf },
  createElement(Text, { font: msdfFace.msdf }, 'Nested selection from the same FontFace'),
);
Text({
  font: msdfFace.msdf,
  ref: (value) => {
    value satisfies ThreeText<typeof msdf> | null;
  },
  children: 'Direct generic component inference',
});
const provided = createElement(GlyphProvider, { handle: three }, labels);
const aliased = createElement(
  GlyphProvider,
  { handle: three, fontFaces: { Inter: msdfFace } },
  createElement(Text, { font: 'Inter' }, 'Existing declaration alias'),
);
const namedRootProvided = createElement(GlyphProvider, { handle: three('hud') }, labels);
const defaultNamedRootProvided = createElement(GlyphProvider, { handle: 'surface' }, labels);
void defaultNamedRootProvided;
const declared = createElement(
  GlyphProvider,
  {
    fontFaces: {
      Inter: '/fonts/Inter.font.glb',
      Title: { src: '/fonts/Title.font.glb', format: 'slug' },
    },
  },
  createElement(Text, { font: 'Inter' }, createElement(Text, { font: 'Title' }, 'Named provider fonts')),
);

// @ts-expect-error Handle selection is internal to Text and comes from GlyphProvider or the built-in default.
createElement(Text, { font: bitmapFont, handle: three }, 'no per-object handle');
// @ts-expect-error TextGroup uses the same provider-or-default selection boundary.
createElement(TextGroup, { handle: three }, label);

function FontConsumer(): null {
  const loaded: Font<typeof bitmap> = useFont('/fonts/Inter.font.glb', {
    format: bitmap({ strikes: [16] }),
  });
  useBitmap('/fonts/Inter.font.glb', { strikes: [16] }) satisfies Font<typeof bitmap>;
  useMsdf('/fonts/Inter.font.glb') satisfies Font<typeof msdf>;
  useMsdf('/fonts/Inter.font.glb', { emSize: 64, pixelRange: 8 }) satisfies Font<typeof msdf>;
  useSlug('/fonts/Inter.font.glb') satisfies Font<typeof slug>;
  void loaded;
  useFont('/fonts/Inter.font.glb', { format: bitmap({ strikes: [16] }) }) satisfies Font<typeof bitmap>;
  // @ts-expect-error Bitmap's exact request helper requires bake options.
  bitmap();
  // @ts-expect-error Slug has no request options.
  slug({});
  // @ts-expect-error FontFace hooks use the canonical source directly, not the legacy loader request object.
  useFont({ baked: '/fonts/Inter.font.glb' });
  return null;
}

const consumer = createElement(FontConsumer);
const preloaded: Promise<void> = useFont.preload('/fonts/Inter.font.glb', {
  format: bitmap({ strikes: [16] }),
});
useFont.clear('/fonts/Inter.font.glb', { format: bitmap({ strikes: [16] }) });
useFont.preload('/fonts/Inter.font.glb', {
  format: bitmap({ strikes: [16] }),
}) satisfies Promise<void>;
useFont.clear('/fonts/Inter.font.glb', { format: bitmap({ strikes: [16] }) });
useBitmap.preload('/fonts/Inter.font.glb', { strikes: [16] }) satisfies Promise<void>;
useBitmap.clear('/fonts/Inter.font.glb', { strikes: [16] });
useMsdf.preload('/fonts/Inter.font.glb') satisfies Promise<void>;
useMsdf.clear('/fonts/Inter.font.glb');
useSlug.preload('/fonts/Inter.font.glb') satisfies Promise<void>;
useSlug.clear('/fonts/Inter.font.glb');

// @ts-expect-error Raster-format requests come from the format helper, not a structural object.
glyph.fontFace('/fonts/Inter.font.glb', { format: { raster: bitmap, options: { strikes: [16] } } });

// @ts-expect-error React's hooks share stable Suspense resources; no hook factory is public.
void ReactApi.createUseFont;
GlyphProvider satisfies typeof ReactApi.GlyphProvider;
// @ts-expect-error Nested Text is the public inline-run syntax.
void ReactApi.TextSpan;

// @ts-expect-error The selected font technique must match the Text technique.
createElement(Text<typeof bitmap>, { font: mtsdfFont }, 'wrong technique');
// @ts-expect-error A typed FontFace selection carries the same technique association as a loaded Font.
const wrongFaceTechnique: R3fTextProps<typeof bitmap> = { font: msdfFace.msdf };

// @ts-expect-error An outer Text font must be a loaded font selection.
createElement(Text, { font: 42 }, 'invalid font');

// The same Text component is a paragraph at the root and an inline run when nested.
// JSX erases element identity, so box-only nested props are rejected by the runtime flattener.
declare const paragraphElement: ReactElement<R3fTextProps<typeof bitmap>>;
paragraphElement satisfies R3fTextChild<typeof bitmap>;

void labels;
void selected;
void selectedFace;
void wrongFaceTechnique;
void provided;
void aliased;
void namedRootProvided;
void declared;
void slugFont;
void FontConsumer;
void consumer;
void preloaded;
