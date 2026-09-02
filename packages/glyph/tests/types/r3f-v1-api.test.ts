import { createElement, type ReactElement } from 'react';

import { glyph, type Font, type FontStack } from '../../src/index.js';
import * as ReactApi from '../../src/react.js';
import { GlyphProvider, Text, TextGroup, useFont } from '../../src/react.js';
import { useBitmap } from '../../src/react/bitmap.js';
import { useMsdf } from '../../src/react/msdf.js';
import { useSlug } from '../../src/react/slug.js';
import type { R3fTextChild, R3fTextProps } from '../../src/react.js';
import { ThreeConfig, type ThreeHandle, type ThreeTextMaterial } from '../../src/three.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { msdf } from '../../src/raster/msdf.js';
import { slug } from '../../src/raster/slug-technique.js';

declare const bitmapFont: Font<typeof bitmap>;
declare const mtsdfFont: Font<typeof msdf>;
declare const slugFont: Font<typeof slug>;
declare const selectedStack: FontStack<typeof bitmap> | FontStack<typeof msdf> | FontStack<typeof slug>;
declare const material: ThreeTextMaterial;
const three: ThreeHandle = glyph.handle('three:r3f-type-fixture', ThreeConfig);

const inline = createElement(Text, { style: { color: '#ff00ff' } }, 'span');
const label = createElement(Text<typeof bitmap>, { font: bitmapFont, material, pixelSnapping: true }, 'Typed ', inline);
const labels = createElement(TextGroup, { material, pixelSnapping: true }, label);
const selected = createElement(Text, { font: selectedStack }, 'Selected at runtime');
const provided = createElement(GlyphProvider, { handle: three }, labels);
const namedRootProvided = createElement(GlyphProvider, { handle: three('hud') }, labels);
const declared = createElement(
  GlyphProvider,
  {
    fontFaces: {
      Inter: '/fonts/Inter.font.glb',
      Title: { src: '/fonts/Title.font.glb', format: 'slug' },
    },
  },
  createElement(Text, { font: 'Inter' }, 'Named provider font'),
);

// @ts-expect-error Handle selection is internal to Text and comes from GlyphProvider or the built-in default.
createElement(Text, { font: bitmapFont, handle: three }, 'no per-object handle');
// @ts-expect-error TextGroup uses the same provider-or-default selection boundary.
createElement(TextGroup, { handle: three }, label);

function FontConsumer(): null {
  const loaded: Font<typeof bitmap> = useFont(
    { baked: '/fonts/Inter.font.glb' },
    { format: { technique: bitmap, options: { strikes: [16] } } },
  );
  useBitmap({ baked: '/fonts/Inter.font.glb' }, { strikes: [16] }) satisfies Font<typeof bitmap>;
  useMsdf({ baked: '/fonts/Inter.font.glb' }) satisfies Font<typeof msdf>;
  useMsdf({ baked: '/fonts/Inter.font.glb' }, { emSize: 64, pixelRange: 8 }) satisfies Font<typeof msdf>;
  useSlug({ baked: '/fonts/Inter.font.glb' }) satisfies Font<typeof slug>;
  void loaded;
  useFont({ baked: '/fonts/Inter.font.glb' }, { format: bitmap({ strikes: [16] }) }) satisfies Font<typeof bitmap>;
  // @ts-expect-error Bitmap's exact request helper requires bake options.
  bitmap();
  // @ts-expect-error Slug has no request options.
  slug({});
  return null;
}

const consumer = createElement(FontConsumer);
const preloaded: Promise<void> = useFont.preload(
  { baked: '/fonts/Inter.font.glb' },
  { format: { technique: bitmap, options: { strikes: [16] } } },
);
useFont.clear({ baked: '/fonts/Inter.font.glb' }, { format: { technique: bitmap, options: { strikes: [16] } } });
useFont.preload(
  { baked: '/fonts/Inter.font.glb' },
  { format: { technique: bitmap, options: { strikes: [16] } } },
) satisfies Promise<void>;
useFont.clear({ baked: '/fonts/Inter.font.glb' }, { format: { technique: bitmap, options: { strikes: [16] } } });
useBitmap.preload({ baked: '/fonts/Inter.font.glb' }, { strikes: [16] }) satisfies Promise<void>;
useBitmap.clear({ baked: '/fonts/Inter.font.glb' }, { strikes: [16] });
useMsdf.preload({ baked: '/fonts/Inter.font.glb' }) satisfies Promise<void>;
useMsdf.clear({ baked: '/fonts/Inter.font.glb' });
useSlug.preload({ baked: '/fonts/Inter.font.glb' }) satisfies Promise<void>;
useSlug.clear({ baked: '/fonts/Inter.font.glb' });

// @ts-expect-error React uses R3F's shared loader cache; no hook factory is public.
void ReactApi.createUseFont;
GlyphProvider satisfies typeof ReactApi.GlyphProvider;
// @ts-expect-error Nested Text is the public inline-run syntax.
void ReactApi.TextSpan;

// @ts-expect-error The selected font technique must match the Text technique.
createElement(Text<typeof bitmap>, { font: mtsdfFont }, 'wrong technique');

// @ts-expect-error An outer Text font must be a loaded font selection.
createElement(Text, { font: 42 }, 'invalid font');

// The same Text component is a paragraph at the root and an inline run when nested.
// JSX erases element identity, so box-only nested props are rejected by the runtime flattener.
declare const paragraphElement: ReactElement<R3fTextProps<typeof bitmap>>;
paragraphElement satisfies R3fTextChild<typeof bitmap>;

void labels;
void selected;
void provided;
void namedRootProvided;
void declared;
void slugFont;
void FontConsumer;
void consumer;
void preloaded;
