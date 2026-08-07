import {
  createFontStack,
  createTextRuntime,
  span,
  txt,
  type LoadedFont,
  type Paragraph,
  type TextRuntime,
} from '../../src/index.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { mtsdf } from '../../src/raster/mtsdf.js';
import { slug } from '../../src/raster/slug-technique.js';

declare const runtime: TextRuntime;
declare const bitmapFont: LoadedFont<typeof bitmap>;
declare const bitmapFallback: LoadedFont<typeof bitmap>;
declare const mtsdfFont: LoadedFont<typeof mtsdf>;

const uiFont = createFontStack(bitmapFont, bitmapFallback);

// @ts-expect-error A FontStack cannot mix raster techniques.
createFontStack(bitmapFont, mtsdfFont);

const labels = runtime.createParagraphBatch({
  technique: bitmap,
  capacity: { size: 128, policy: 'fixed' },
  renderVariant: 'plain' as 'plain' | 'warning',
});

const warning = span(bitmapFallback, { color: '#ff00ff', fontSize: 18 });
const label: Paragraph<typeof bitmap, 'plain' | 'warning'> = labels.add({
  font: uiFont,
  text: txt`A ${warning`fallback`} label`,
  renderVariant: 'warning',
});

label.text = 'Plain text';
label.set({ order: 4, contentBox: { width: { mode: 'at-most', size: 320 }, wrap: 'word' } });
labels.setCapacity({ size: 256, policy: 'fixed' });

runtime.updateAsync({
  priority: 'urgent',
  onProgress(progress) {
    progress.preparedParagraphs satisfies number;
    progress.totalParagraphs satisfies number;
    progress.stagedGlyphs satisfies number;
  },
});
runtime.updateAsync((result) => {
  if (result.ok && result.value.status === 'published')
    result.value.value satisfies import('../../src/index.js').TextRuntimeRevision;
});

// @ts-expect-error A paragraph batch cannot accept a font from another technique.
labels.add({ font: mtsdfFont, text: 'wrong technique' });

async function loadTargetV1Fonts(): Promise<void> {
  const created = await createTextRuntime();
  await created.loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: bitmap, options: { strikes: [16, 32] } },
  });
  await created.loadFont({ input: { baked: '/fonts/Inter.font.glb' }, raster: { technique: mtsdf } });
  await created.loadFont({ input: { baked: '/fonts/Inter.font.glb' }, raster: { technique: slug } });

  created.loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    // @ts-expect-error Bitmap technique options are required.
    raster: { technique: bitmap },
  });
}

void label;
void loadTargetV1Fonts;
