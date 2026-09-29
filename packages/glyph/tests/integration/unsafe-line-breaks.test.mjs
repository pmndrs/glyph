import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, createFontStack, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

const fredokaUrl = new URL(
  '../../../../benches/fixtures/rendering/fredoka-issue-216-bitmap-16.font.glb',
  import.meta.url,
);

const amiriUrl = new URL('../../../../benches/fixtures/rendering/amiri-bitmap-16.font.glb', import.meta.url);
const cjkUrl = new URL(
  '../../../../benches/fixtures/rendering/noto-sans-cjk-showcase-bitmap-16.font.glb',
  import.meta.url,
);
const devanagariUrl = new URL(
  '../../../../benches/fixtures/rendering/noto-sans-devanagari-bitmap-16.font.glb',
  import.meta.url,
);
const iconUrl = new URL(
  '../../../../benches/fixtures/rendering/font-awesome-free-6.7.2-bitmap-16.font.glb',
  import.meta.url,
);

async function loadBitmapFont(url) {
  return loadFont({ baked: { bytes: await readFile(url) } }, bitmap({ strikes: [16] }));
}

test('a legal unsafe boundary reshapes the selected lines without disabling kerning', async (t) => {
  await glyph.init();
  const font = await loadBitmapFont(fredokaUrl);
  const root = glyph.handle(
    'three:integration:unsafe-line-breaks',
    defineThreeConfig({ capacity: { size: 256, policy: 'grow' } }),
  );
  const text = 'Reveals one grapheme at a time over a duration. Layout stays put and a trigger fires at the end.';
  const paragraph = root.createText({
    font,
    text,
    style: { fontSize: 24 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 420 } },
  });
  t.after(() => {
    paragraph.dispose();
    root.dispose();
    font.dispose();
  });

  const measurement = paragraph.measure();
  assert.deepEqual(
    measurement.lines.map((line) => text.slice(line.textStart, line.textEnd)),
    ['Reveals one grapheme at a time over a ', 'duration. Layout stays put and a ', 'trigger fires at the end.'],
  );
  assert.equal(
    measurement.lines.every((line) => line.advance <= 420),
    true,
  );
  assert.equal(measurement.minContentWidth > 0, true);
  assert.equal(
    measurement.minContentWidth < measurement.maxContentWidth,
    true,
    'legal unsafe opportunities must contribute exact min-content segments instead of joining the whole paragraph',
  );

  const glyphs = paragraph.glyphs();
  assert.deepEqual(
    Array.from(glyphs.lineTextStarts),
    measurement.lines.map((line) => line.textStart),
  );
  assert.deepEqual(
    Array.from(glyphs.lineTextEnds),
    measurement.lines.map((line) => line.textEnd),
  );
});

test('unsafe-boundary support preserves Arabic, Devanagari, and CJK line legality', async (t) => {
  await glyph.init();
  const [amiri, devanagari, cjk] = await Promise.all([
    loadBitmapFont(amiriUrl),
    loadBitmapFont(devanagariUrl),
    loadBitmapFont(cjkUrl),
  ]);
  const root = glyph.handle(
    'three:integration:unsafe-line-breaks:non-latin',
    defineThreeConfig({ capacity: { size: 256, policy: 'grow' } }),
  );
  const cases = [
    {
      font: amiri,
      text: 'مرحبا بالعالم هذا اختبار لتغليف النص العربي بشكل صحيح.',
      width: 180,
      validBoundary(text, offset) {
        return offset === text.length || text[offset - 1] === ' ';
      },
    },
    {
      font: devanagari,
      text: 'यह देवनागरी पाठ संयुक्त अक्षरों और मात्राओं के साथ सही ढंग से पंक्तियों में टूटता है।',
      width: 180,
      validBoundary(text, offset) {
        return offset === text.length || text[offset - 1] === ' ';
      },
    },
    {
      font: cjk,
      text: '日本語の文章を正しく改行しながら表示します。',
      width: 120,
      validBoundary(text, offset) {
        return offset === text.length || !'、。)]）］｝〉》」』】'.includes(text[offset]);
      },
    },
  ];
  const paragraphs = cases.map(({ font, text, width }) =>
    root.createText({
      font,
      text,
      style: { fontSize: 24 },
      layout: { wrap: 'word' },
      constraints: { width: { mode: 'exact', size: width } },
    }),
  );
  t.after(() => {
    for (const paragraph of paragraphs) paragraph.dispose();
    root.dispose();
    amiri.dispose();
    devanagari.dispose();
    cjk.dispose();
  });

  for (const [index, paragraph] of paragraphs.entries()) {
    const fixture = cases[index];
    const measurement = paragraph.measure();
    assert.equal(measurement.lines.length > 1, true);
    assert.equal(
      measurement.lines.every((line) => line.advance <= fixture.width),
      true,
    );
    assert.equal(
      measurement.lines.every((line) => fixture.validBoundary(fixture.text, line.textEnd)),
      true,
    );
    const glyphs = paragraph.glyphs();
    assert.deepEqual(
      Array.from(glyphs.lineTextStarts),
      measurement.lines.map((line) => line.textStart),
    );
    assert.deepEqual(
      Array.from(glyphs.lineTextEnds),
      measurement.lines.map((line) => line.textEnd),
    );
  }
});

test('unsafe fallback shaping keeps line metrics owned by the stack primary', async (t) => {
  await glyph.init();
  const [icons, fredoka] = await Promise.all([loadBitmapFont(iconUrl), loadBitmapFont(fredokaUrl)]);
  const root = glyph.handle(
    'three:integration:unsafe-line-breaks:fallback',
    defineThreeConfig({ capacity: { size: 256, policy: 'grow' } }),
  );
  const paragraph = root.createText({
    font: createFontStack(icons, fredoka),
    text: 'Reveals one grapheme at a time over a duration.',
    style: { fontSize: 24 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 220 } },
  });
  t.after(() => {
    paragraph.dispose();
    root.dispose();
    icons.dispose();
    fredoka.dispose();
  });

  const measurement = paragraph.measure();
  assert.equal(measurement.lines.length > 1, true);
  assert.equal(
    measurement.lines.every((line) => line.advance <= 220),
    true,
  );
});

test('unsafe fitting preserves hard breaks and narrow ellipsis lines', async (t) => {
  await glyph.init();
  const font = await loadBitmapFont(fredokaUrl);
  const root = glyph.handle(
    'three:integration:unsafe-line-breaks:hard-break-ellipsis',
    defineThreeConfig({ capacity: { size: 256, policy: 'grow' } }),
  );
  const hardBreakText = 'Reveals one grapheme at a time.\nLayout stays put after the break.';
  const hardBreak = root.createText({
    font,
    text: hardBreakText,
    style: { fontSize: 24 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 180 } },
  });
  const ellipsis = root.createText({
    font,
    text: 'Reveals one grapheme at a time over a duration. Layout stays put.',
    style: { fontSize: 24 },
    layout: { maxLines: 2, overflow: 'ellipsis', wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 115 } },
  });
  const clipped = root.createText({
    font,
    text: 'Reveals one grapheme at a time over a duration. Layout stays put after clipping.',
    style: { fontSize: 24 },
    layout: { overflow: 'clip', wrap: 'word' },
    constraints: {
      width: { mode: 'exact', size: 145 },
      height: { mode: 'exact', size: 28 },
    },
  });
  t.after(() => {
    hardBreak.dispose();
    ellipsis.dispose();
    clipped.dispose();
    root.dispose();
    font.dispose();
  });

  const measurement = hardBreak.measure();
  assert.equal(measurement.lines.length > 2, true);
  assert.equal(
    measurement.lines.every((line) => line.advance <= 180),
    true,
  );
  assert.equal(
    measurement.lines.some((line) => hardBreakText.slice(line.textStart, line.textEnd).includes('\n')),
    false,
  );
  const ellipsisMeasurement = ellipsis.measure();
  assert.equal(ellipsisMeasurement.lines.length, 2);
  assert.equal(
    ellipsisMeasurement.lines.every((line) => line.advance <= 115),
    true,
  );
  assert.doesNotThrow(() => ellipsis.glyphs());
  assert.equal(clipped.measure().overflowed, true);
  assert.doesNotThrow(() => clipped.glyphs());
});

test('equal-length incremental edits use the same exact unsafe fit as a cold paragraph', async (t) => {
  await glyph.init();
  const font = await loadBitmapFont(fredokaUrl);
  const warmRoot = glyph.handle(
    'three:integration:unsafe-line-breaks:incremental',
    defineThreeConfig({ capacity: { size: 256, policy: 'grow' } }),
  );
  const coldRoot = glyph.handle(
    'three:integration:unsafe-line-breaks:cold',
    defineThreeConfig({ capacity: { size: 256, policy: 'grow' } }),
  );
  const narrowText = `${'i '.repeat(24)}i`;
  const wideText = `${'W '.repeat(24)}W`;
  const properties = {
    font,
    style: { fontSize: 24 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 420 } },
  };
  const warm = warmRoot.createText({ ...properties, text: narrowText });
  t.after(() => {
    warm.dispose();
    warmRoot.dispose();
    coldRoot.dispose();
    font.dispose();
  });

  assert.equal(warm.measure().lineCount, 1, 'the retained paragraph starts without boundary corrections');
  warm.text = wideText;
  const warmMeasurement = warm.measure();
  const cold = coldRoot.createText({ ...properties, text: wideText });
  t.after(() => cold.dispose());
  const coldMeasurement = cold.measure();

  assert.equal(warmMeasurement.lineCount > 1, true);
  assert.deepEqual(warmMeasurement, coldMeasurement);
  assert.deepEqual(Array.from(warm.glyphs().lineTextStarts), Array.from(cold.glyphs().lineTextStarts));
  assert.deepEqual(Array.from(warm.glyphs().lineTextEnds), Array.from(cold.glyphs().lineTextEnds));
});
