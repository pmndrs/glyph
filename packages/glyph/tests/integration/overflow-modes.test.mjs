/** `layout.overflow` with a fixed height, observed where it matters: the instances a renderer draws and the lines a read reports. A line's box fits when it ends at or above the block end, straddles when it starts inside and ends past it, and is outside otherwise; `visible` keeps the straddling line of the last region, `clip` keeps only fitting lines. */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { bitmap } from '@pmndrs/glyph';

import { createFontCache, lanes, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';
import { renderScene } from '../support/three-render.mjs';

const fonts = createFontCache({ bitmap: { file: 'inter-bitmap-16.font.glb', raster: bitmap({ strikes: [16] }) } });
after(() => fonts.dispose());

const text =
  'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore. '.repeat(4);
const width = 200;

function drawn(font, layout, height) {
  const mounted = mount(font, [
    {
      properties: {
        text,
        style: { fontSize: 16 },
        layout: { wrap: 'word', ...layout },
        constraints: {
          width: { mode: 'exact', size: width },
          ...(height === undefined ? {} : { height: { mode: 'exact', size: height } }),
        },
      },
    },
  ]);
  try {
    renderScene(mounted.scene);
    const measured = mounted.nodes[0].measure();
    return {
      instances: lanes(mounted).draws.reduce((sum, draw) => sum + draw.instances, 0),
      draws: lanes(mounted).draws.length,
      lines: measured.lines.length,
      overflowed: measured.overflowed,
      contentHeight: measured.contentHeight,
    };
  } finally {
    unmount(mounted);
  }
}

/** The line pitch of the unconstrained layout; every line of this text has the same box. */
async function pitch(font) {
  const mounted = mount(font, [
    {
      properties: {
        text,
        style: { fontSize: 16 },
        layout: { wrap: 'word' },
        constraints: { width: { mode: 'exact', size: width } },
      },
    },
  ]);
  try {
    const [first, second] = mounted.nodes[0].measure().lines;
    return second.baseline - first.baseline;
  } finally {
    unmount(mounted);
  }
}

test('visible keeps the straddling line, clip keeps only the lines that fit', { timeout }, async () => {
  const font = await fonts.load('bitmap');
  const line = await pitch(font);
  const full = drawn(font, {}, undefined);
  assert.ok(full.lines > 6, 'the text overflows a three-line box');

  const visible = drawn(font, { overflow: 'visible' }, line * 2.5);
  const byDefault = drawn(font, {}, line * 2.5);
  const clip = drawn(font, { overflow: 'clip' }, line * 2.5);
  const clipThree = drawn(font, { overflow: 'clip' }, line * 3.5);
  const visibleTwo = drawn(font, { overflow: 'visible' }, line * 1.5);

  assert.deepEqual(byDefault, visible, 'visible is the default');
  assert.equal(visible.lines, 3, 'two fitting lines and the straddling one');
  assert.equal(clip.lines, 2, 'only the fitting lines');
  // The same three lines drawn either as visible's spill or as clip's fitting lines.
  assert.equal(visible.instances, clipThree.instances);
  assert.equal(clip.instances, visibleTwo.instances);
  assert.ok(clip.instances < visible.instances);
  for (const result of [visible, clip]) {
    assert.equal(result.overflowed, true);
    assert.equal(result.contentHeight, full.contentHeight);
  }
});

test(
  'with columns only the last column keeps a straddling line, and clip never runs past its foot',
  { timeout },
  async () => {
    const font = await fonts.load('bitmap');
    const line = await pitch(font);
    const columns = { count: 2, gap: 10 };
    const height = line * 2.5;
    const visible = drawn(font, { columns }, height);
    const clip = drawn(font, { columns, overflow: 'clip' }, height);
    assert.equal(visible.lines, 5, 'two lines in the first column, two and the straddling one in the last');
    assert.equal(clip.lines, 4);
    assert.equal(clip.draws, 1, 'columns no longer split a clipped paragraph into one draw each');
    assert.ok(clip.instances < visible.instances);
  },
);
