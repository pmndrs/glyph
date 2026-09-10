import { h, type ShallowRef } from 'vue';

import { glyph, type Font, type FontStack, type GlyphFontError } from '@pmndrs/glyph';
import * as VueApi from '@pmndrs/glyph/vue';
import { GlyphProvider, Text, TextGroup, clearFont, preloadFont, useFont } from '@pmndrs/glyph/vue';
import type { UseFontResult, VueTextProps } from '@pmndrs/glyph/vue';
import { clearBitmap, preloadBitmap, useBitmap } from '@pmndrs/glyph/vue/bitmap';
import { clearMsdf, preloadMsdf, useMsdf } from '@pmndrs/glyph/vue/msdf';
import { clearSlug, preloadSlug, useSlug } from '@pmndrs/glyph/vue/slug';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';
import { ThreeConfig, type Text as ThreeText, type ThreeHandle, type ThreeTextMaterial } from '@pmndrs/glyph/three';

declare const bitmapFont: Font<typeof bitmap>;
declare const selectedStack: FontStack<typeof bitmap> | FontStack<typeof msdf> | FontStack<typeof slug>;
declare const material: ThreeTextMaterial;
const three: ThreeHandle = glyph.handle('three:vue-type-fixture', ThreeConfig);
const msdfFace = glyph.fontFace('/fonts/Inter.font.glb', { format: msdf });

const inline = h(Text, { style: { color: '#ff00ff' } }, () => 'span');
const label = h(Text, { font: bitmapFont, material, pixelSnapping: true, position: [0, 1, 0] }, () => [
  'Typed ',
  inline,
]);
const labels = h(TextGroup, { material, pixelSnapping: true, renderOrder: 2 }, () => label);
const selected = h(Text, { font: selectedStack }, () => 'Selected at runtime');
const selectedFace = h(Text, { font: msdfFace.msdf }, () => h(Text, { font: msdfFace.msdf }, () => 'Nested selection'));
const provided = h(GlyphProvider, { handle: three }, () => labels);
const aliased = h(GlyphProvider, { handle: three, fontFaces: { Inter: msdfFace } }, () =>
  h(Text, { font: 'Inter' }, () => 'Existing declaration alias'),
);
const namedRootProvided = h(GlyphProvider, { handle: three('hud') }, () => labels);
const defaultNamedRootProvided = h(GlyphProvider, { handle: 'surface' }, () => labels);
const declared = h(
  GlyphProvider,
  { fontFaces: { Inter: '/fonts/Inter.font.glb', Title: { src: '/fonts/Title.font.glb', format: 'slug' } } },
  () => h(Text, { font: 'Inter' }, () => h(Text, { font: 'Title' }, () => 'Named provider fonts')),
);
void [label, selected, selectedFace, provided, aliased, namedRootProvided, defaultNamedRootProvided, declared];

// The template-ref instance exposes the retained Three object with the technique the font selection implies.
declare const typedLabel: InstanceType<typeof Text<Font<typeof bitmap>>>;
typedLabel.instance satisfies ThreeText<typeof bitmap> | undefined;
declare const untypedLabel: InstanceType<typeof Text>;
untypedLabel.instance satisfies ThreeText<import('@pmndrs/glyph').RasterFormatMetadata> | undefined;

function ComposableTypeAssertions(): void {
  const generic = useFont('/fonts/Inter.font.glb');
  generic satisfies UseFontResult<import('@pmndrs/glyph').RasterFormatMetadata>;
  const explicit = useFont('/fonts/Inter.font.glb', { format: msdf });
  explicit.font satisfies Readonly<ShallowRef<Font<typeof msdf> | undefined>>;
  explicit.error satisfies Readonly<ShallowRef<unknown>>;
  explicit.ready satisfies Promise<Font<typeof msdf>>;
  useBitmap('/fonts/Inter.font.glb', { strikes: [16] }).font satisfies Readonly<
    ShallowRef<Font<typeof bitmap> | undefined>
  >;
  useMsdf('/fonts/Inter.font.glb').ready satisfies Promise<Font<typeof msdf>>;
  useSlug('/fonts/Inter.font.glb').ready satisfies Promise<Font<typeof slug>>;
  preloadFont('/fonts/Inter.font.glb') satisfies Promise<void>;
  preloadFont('/fonts/Inter.font.glb', { format: msdf }) satisfies Promise<void>;
  clearFont('/fonts/Inter.font.glb', { format: msdf });
  preloadBitmap('/fonts/Inter.font.glb', { strikes: [16] }) satisfies Promise<void>;
  clearBitmap('/fonts/Inter.font.glb', { strikes: [16] });
  preloadMsdf('/fonts/Inter.font.glb') satisfies Promise<void>;
  clearMsdf('/fonts/Inter.font.glb', { emSize: 64, pixelRange: 8 });
  preloadSlug('/fonts/Inter.font.glb') satisfies Promise<void>;
  clearSlug('/fonts/Inter.font.glb');
}
void ComposableTypeAssertions;

declare const props: VueTextProps<typeof bitmap>;
props.onError satisfies ((error: unknown) => void) | undefined;
declare const fontError: GlyphFontError;
void fontError;

// Every public name has exactly one home; the boundary test reads the emitted declaration for the rest.
VueApi.Text satisfies typeof Text;
VueApi.TextGroup satisfies typeof TextGroup;
VueApi.GlyphProvider satisfies typeof GlyphProvider;
VueApi.useFont satisfies typeof useFont;
VueApi.preloadFont satisfies typeof preloadFont;
VueApi.clearFont satisfies typeof clearFont;
