import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

const fixtures = new URL('../../../../benches/fixtures/rendering/', import.meta.url);
const crossSpaceText =
  'the apple ate a banana while the eagle and the ape made a cake at the lake; a bee came and ate a pear near a tree';

async function session(t, name, fixture) {
  await glyph.init();
  const font = await loadFont(
    { baked: { bytes: await readFile(new URL(fixture, fixtures)) } },
    bitmap({ strikes: [16] }),
  );
  const root = glyph.handle(
    `three:integration:unsafe-break-review:${name}`,
    defineThreeConfig({ capacity: { size: 1024, policy: 'grow' } }),
  );
  t.after(() => {
    root.dispose();
    font.dispose();
  });
  return (options) => {
    const paragraph = root.createText({ font, style: { fontSize: 24 }, ...options });
    t.after(() => paragraph.dispose());
    return paragraph;
  };
}

const width = (size) => ({ width: { mode: 'exact', size } });

test('a terminal hard break measures without trapping the engine', async (t) => {
  const create = await session(t, 'terminal-break', 'fredoka-issue-216-bitmap-16.font.glb');
  const paragraph = create({ text: 'abc\n', layout: { wrap: 'word' }, constraints: width(200) });
  assert.equal(paragraph.measure().lines.length > 0, true);
});

test('a clipped paragraph inspects the same lead glyphs as the unclipped paragraph', async (t) => {
  const create = await session(t, 'clipped-lead', 'cross-space-bitmap-16.font.glb');
  const open = create({ text: crossSpaceText, layout: { wrap: 'word' }, constraints: width(200) }).glyphs();
  const clipped = create({
    text: crossSpaceText,
    layout: { wrap: 'word', overflow: 'clip' },
    constraints: { ...width(200), height: { mode: 'exact', size: 28 } },
  }).glyphs();
  assert.deepEqual(Array.from(clipped.glyphIds), Array.from(open.glyphIds));
});

test('a text edit that also changes shaping features does not keep stale break corrections', async (t) => {
  const create = await session(t, 'edit-restyle', 'cross-space-bitmap-16.font.glb');
  const style = { features: [{ tag: 'calt', value: 0 }] };
  const shape = (paragraph) => {
    const glyphs = paragraph.glyphs();
    return { lines: Array.from(glyphs.lineTextEnds), advances: Array.from(glyphs.lineAdvances) };
  };
  for (let size = 200; size <= 440; size += 40) {
    const edited = create({ text: crossSpaceText, layout: { wrap: 'word' }, constraints: width(size) });
    edited.measure();
    edited.set({ text: `${crossSpaceText} x`, style });
    const fresh = create({ text: `${crossSpaceText} x`, style, layout: { wrap: 'word' }, constraints: width(size) });
    assert.deepEqual(shape(edited), shape(fresh), `width ${size}`);
  }
});

test('justification expands the gaps inside a multi-cluster corrected lead', async (t) => {
  const create = await session(t, 'justified-lead', 'fredoka-issue-216-bitmap-16.font.glb');
  const text = 'Wow AVATAR AVA AVAVA AWAY WAVE AVIATE VALVE TAVERN TYPE AVAVAV YAWAY TO WA VA AV';
  const justify = { maxWordSpaceRatio: 1, letterSpaceExpansion: 20 };
  let compared = 0;
  for (let size = 130; size <= 160; size += 10) {
    const paragraph = (layout) =>
      create({ text, layout: { wrap: 'word', ...layout }, constraints: width(size) }).glyphs();
    const justified = paragraph({ align: 'justify', justify });
    const natural = paragraph({});
    for (let line = 0; line < justified.lineTextStarts.length - 1; line += 1) {
      if (text[justified.lineTextStarts[line]] !== 'A') continue;
      const at = justified.lineGlyphStarts[line];
      const grown = [0, 1, 2, 3, 4].map(
        (i) => justified.x[at + i + 1] - justified.x[at + i] - (natural.x[at + i + 1] - natural.x[at + i]),
      );
      if (justified.lineAdvances[line] === natural.lineAdvances[line]) continue;
      for (const gap of grown) assert.ok(Math.abs(gap - grown[0]) < 0.05, `width ${size} line ${line}: ${grown}`);
      compared += 1;
    }
  }
  assert.equal(compared > 0, true);
});
