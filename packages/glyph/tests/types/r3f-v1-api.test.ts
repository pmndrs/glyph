import { createElement, type ReactElement } from 'react';

import { glyph, type Font, type FontStack } from '@pmndrs/glyph';
import * as ReactApi from '@pmndrs/glyph/react';
import { GlyphProvider, Text, TextGroup } from '@pmndrs/glyph/react';
import type { GlyphProviderProps, R3fTextChild, R3fTextProps } from '@pmndrs/glyph/react';
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
const titleFace = glyph.fontFace('/fonts/Title.font.glb', { format: msdf });

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
});
const provided = createElement(GlyphProvider, { handle: three }, labels);
const namedRootProvided = createElement(GlyphProvider, { handle: three('hud') }, labels);
const defaultNamedRootProvided = createElement(GlyphProvider, { handle: 'surface' }, labels);
void defaultNamedRootProvided;
const declared = createElement(
  GlyphProvider,
  {
    fontFaces: {
      Inter: msdfFace,
      Title: titleFace,
    },
  },
  createElement(Text, { font: 'Inter' }, createElement(Text, { font: 'Title' }, 'Nested named provider font')),
);

// @ts-expect-error Provider aliases reference existing FontFace declarations; they do not declare sources.
const invalidProviderAliases: GlyphProviderProps = { fontFaces: { Inter: '/fonts/Inter.font.glb' } };

// @ts-expect-error Handle selection is internal to Text and comes from GlyphProvider or the built-in default.
createElement(Text, { font: bitmapFont, handle: three }, 'no per-object handle');
// @ts-expect-error TextGroup uses the same provider-or-default selection boundary.
createElement(TextGroup, { handle: three }, label);

// @ts-expect-error Bitmap's exact request helper requires bake options.
bitmap();
// @ts-expect-error Slug has no request options.
slug({});

// @ts-expect-error Raster-format requests come from the format helper, not a structural object.
glyph.fontFace('/fonts/Inter.font.glb', { format: { raster: bitmap, options: { strikes: [16] } } });

// @ts-expect-error React uses R3F's shared loader cache; no hook factory is public.
void ReactApi.createUseFont;
// @ts-expect-error FontFace declaration and loading belong to glyph.fontFace(), not the React adapter.
void ReactApi.useFont;
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
void namedRootProvided;
void declared;
void invalidProviderAliases;
void slugFont;
