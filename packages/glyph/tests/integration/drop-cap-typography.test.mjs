import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { bitmap, txt, span } from '@pmndrs/glyph';
import { loadFont } from '../../dist/loader.js';
import { createThreeTestHandle } from '../support/three-handle.mjs';

const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 0.0001, `${label}: ${actual} != ${expected}`);

for (const alignment of ['baseline', 'text-top']) {
  test(`drop-cap ${alignment} contributes cap/x-height references while preserving the body strut`, async (t) => {
    const handle = await createThreeTestHandle(t);
    const fonts = await Promise.all(
      ['inter', 'amiri'].map(async (name) =>
        loadFont(
          {
            baked: {
              bytes: await readFile(
                new URL(`../../../../benches/fixtures/rendering/${name}-bitmap-16-32.font.glb`, import.meta.url),
              ),
            },
          },
          bitmap({ strikes: [16, 32] }),
        ),
      ),
    );
    t.after(() => {
      for (const font of fonts) font.dispose();
    });
    const [bodyFont, capFont] = fonts;
    const body = handle.createText({ font: bodyFont, text: 'body', style: { fontSize: 20, lineHeight: 1.2 } });
    const initial = handle.createText({ font: capFont, text: 'A', style: { fontSize: 40 } });
    const bodyMetrics = body.measure();
    const capMetrics = initial.measure();
    const label = handle.createText({
      font: bodyFont,
      text: txt`${span(capFont, { fontSize: 40 })`A`} body follows beside the initial and wraps into several lines of text.`,
      style: { fontSize: 20, lineHeight: 1.2 },
      constraints: { width: { mode: 'exact', size: 150 }, anchor: { y: 'cap-height-top' } },
      layout: { wrap: 'word', dropCap: { lines: 3, align: alignment } },
    });
    t.after(() => {
      label.dispose();
      initial.dispose();
      body.dispose();
    });
    const measured = label.measure();
    const line = measured.lines[0];
    assert.ok(measured.lineCount > 1);
    near(line.lineHeight, bodyMetrics.lines[0].lineHeight, 'body line height');
    near(line.baseline, bodyMetrics.firstBaseline, 'body baseline');
    near(line.fontMetrics.ascent, bodyMetrics.fontMetrics.ascent, 'body font ascent');
    near(line.fontMetrics.descent, bodyMetrics.fontMetrics.descent, 'body font descent');
    const capBaseline =
      alignment === 'baseline'
        ? line.baseline
        : line.baseline - bodyMetrics.fontMetrics.capHeight + capMetrics.fontMetrics.capHeight;
    const capTop = Math.min(
      line.baseline - bodyMetrics.fontMetrics.capHeight,
      capBaseline - capMetrics.fontMetrics.capHeight,
    );
    const xTop = Math.min(
      line.baseline - bodyMetrics.fontMetrics.xHeight,
      capBaseline - capMetrics.fontMetrics.xHeight,
    );
    near(measured.capHeightTop, capTop, 'absolute cap envelope');
    near(measured.xHeightTop, xTop, 'absolute x-height envelope');
    near(
      measured.fontMetrics.capHeight,
      Math.max(bodyMetrics.fontMetrics.capHeight, capMetrics.fontMetrics.capHeight),
      'cap dimension',
    );
    near(
      measured.fontMetrics.xHeight,
      Math.max(bodyMetrics.fontMetrics.xHeight, capMetrics.fontMetrics.xHeight),
      'x-height dimension',
    );
    for (const key of ['capHeightSource', 'xHeightSource']) {
      assert.equal(
        measured.fontMetrics[key],
        [bodyMetrics.fontMetrics[key], capMetrics.fontMetrics[key]].includes('fallback') ? 'fallback' : 'font',
      );
    }
    near(measured.anchorOffset.y, -capTop, 'cap anchor');
    const glyphs = label.glyphs();
    near(glyphs.capHeightTop, capTop, 'inspection cap envelope');
    label.constraints = { width: { mode: 'exact', size: 150 }, anchor: { y: 'first-baseline' } };
    near(label.measure().anchorOffset.y, -line.baseline, 'body baseline anchor');
    assert.deepEqual(measured.lines[1].fontMetrics, bodyMetrics.fontMetrics);
  });
}
