import { createElement, type ReactElement } from 'react';

import type { FontStack, LoadedFont } from '../../src/index.js';
import { Text, TextGroup, TextSpan, useFont } from '../../src/react.js';
import type { R3fTextChild, R3fTextProps, R3fTextSpanProps } from '../../src/react.js';
import type { ThreeTextMaterial } from '../../src/three.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { msdf } from '../../src/raster/msdf.js';
import { slug } from '../../src/raster/slug-technique.js';

declare const bitmapFont: LoadedFont<typeof bitmap>;
declare const mtsdfFont: LoadedFont<typeof msdf>;
declare const slugFont: LoadedFont<typeof slug>;
declare const selectedStack: FontStack<typeof bitmap> | FontStack<typeof msdf> | FontStack<typeof slug>;
declare const material: ThreeTextMaterial;

const inline = createElement(TextSpan, { paint: { color: '#ff00ff' } }, 'span');
const label = createElement(Text<typeof bitmap>, { font: bitmapFont, material, pixelSnapping: true }, 'Typed ', inline);
const labels = createElement(TextGroup, { compositing: 'independent', material, pixelSnapping: true }, label);
const selected = createElement(Text, { font: selectedStack }, 'Selected at runtime');

function FontConsumer(): null {
  const loaded: LoadedFont<typeof bitmap> = useFont({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  void loaded;
  const [loadedBitmap, loadedMsdf, loadedSlug] = useFont({
    input: { baked: '/fonts/Inter.font.glb' },
    rasters: [{ technique: bitmap, options: { strikes: [16] } }, { technique: msdf }, { technique: slug }],
  });
  loadedBitmap satisfies LoadedFont<typeof bitmap>;
  loadedMsdf satisfies LoadedFont<typeof msdf>;
  loadedSlug satisfies LoadedFont<typeof slug>;
  return null;
}

// @ts-expect-error The selected font technique must match the Text technique.
createElement(Text<typeof bitmap>, { font: mtsdfFont }, 'wrong technique');

// @ts-expect-error An outer Text font must be a loaded font selection.
createElement(Text, { font: 42 }, 'invalid font');

// A span is a styled run, not an object in the scene, so every box-level prop is a type error on it
// rather than a prop the flattener accepts and discards.
// @ts-expect-error A TextSpan has no transform: it is not an object in the scene.
createElement(TextSpan, { font: bitmapFont, position: [0, 0, 0] }, 'inline');

// @ts-expect-error A TextSpan has no content box; the paragraph owns it.
createElement(TextSpan, { font: bitmapFont, contentBox: { wrap: 'none' } }, 'inline');

// @ts-expect-error A TextSpan is never mounted, so a ref to it could never fire.
createElement(TextSpan, { font: bitmapFont, ref: () => {} }, 'inline');

// @ts-expect-error A TextSpan has no error boundary; failures surface on the paragraph.
createElement(TextSpan, { font: bitmapFont, onError: () => {} }, 'inline');

// @ts-expect-error Capacity and pixel snapping belong to the standalone paragraph.
createElement(TextSpan, { font: bitmapFont, capacity: { size: 8 }, pixelSnapping: true }, 'inline');

// A Text element is a paragraph, not a run, so it is not a legal inline child. The check is stated
// against the child type directly: `createElement`'s variadic children parameter is typed
// `ReactNode` by React itself and would accept any element regardless of what the component says.
declare const paragraphElement: ReactElement<R3fTextProps<typeof bitmap>>;
declare const spanElement: ReactElement<R3fTextSpanProps<typeof bitmap>>;
spanElement satisfies R3fTextChild<typeof bitmap>;
// @ts-expect-error Inline children are TextSpan elements, not Text paragraphs.
paragraphElement satisfies R3fTextChild<typeof bitmap>;

void labels;
void selected;
void slugFont;
void FontConsumer;
