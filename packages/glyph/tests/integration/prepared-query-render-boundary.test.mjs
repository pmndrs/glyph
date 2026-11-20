import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { bitmap } from '@pmndrs/glyph';
import { bitmapSchema } from '@pmndrs/glyph/core';
import { createFontCache, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';

const fonts = createFontCache({ inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap({ strikes: [16] }) } });
after(() => fonts.dispose());

const fields = [
  'glyphFontSlots',
  'glyphIds',
  'clusters',
  'glyphBidiLevels',
  'glyphFontSizes',
  'x',
  'y',
  'glyphAdvances',
  'glyphInkX',
  'glyphInkY',
  'glyphInkWidths',
  'glyphInkHeights',
  'glyphFlags',
  'lineTextStarts',
  'lineTextEnds',
  'lineGlyphStarts',
  'lineGlyphCounts',
  'lineBaselines',
  'lineAdvances',
];

function querySnapshot(node) {
  const measure = node.measure();
  const owned = node.glyphs();
  const borrowed = node.readGlyphs((view) =>
    Array.from({ length: view.glyphCount }, (_, index) => view.glyphAt(index)),
  );
  assert.equal(owned.glyphCount, borrowed.length);
  for (const [index, glyph] of borrowed.entries()) {
    assert.equal(glyph.stableId, owned.glyphStableIds[index], 'borrow and owned copy use the same owner identity');
    assert.equal(glyph.glyphId, owned.glyphIds[index]);
    assert.equal(glyph.cluster, owned.clusters[index]);
    assert.equal(glyph.x, owned.x[index]);
    assert.equal(glyph.y, owned.y[index]);
  }
  return {
    measure,
    lines: owned.lines,
    columns: Object.fromEntries(fields.map((field) => [field, Array.from(owned[field])])),
    borrowed: borrowed.map(({ stableId: _ownerIdentity, ...glyph }) => glyph),
  };
}

function drawBytes(object) {
  const draws = [];
  object.traverse((child) => {
    if (!child.isMesh) return;
    draws.push({
      count: child.geometry.instanceCount,
      attributes: Object.fromEntries(
        Object.entries(child.geometry.attributes).map(([name, attribute]) => [name, Array.from(attribute.array)]),
      ),
    });
  });
  return draws;
}

function splitSnapshot(copy) {
  const colors = [];
  const colorName = `_pmndrsGlyph_${bitmapSchema.buffers.color.id}`;
  copy.traverse((child) => {
    if (!child.isMesh) return;
    const attribute = child.geometry.getAttribute(colorName);
    if (attribute === undefined) return;
    const start = child.userData.pmndrsGlyphRunStart;
    for (let index = 0; index < child.geometry.instanceCount; index += 1) {
      colors.push(Array.from({ length: attribute.itemSize }, (_, lane) => attribute.getComponent(start + index, lane)));
    }
  });
  return {
    glyphs: Array.from({ length: copy.count }, (_, index) => {
      const { key: _ownerIdentity, ...glyph } = copy.glyphAt(index);
      return glyph;
    }),
    measurements: copy.measurements.map(({ anchorPoint, ...measurement }) => ({
      ...measurement,
      center: anchorPoint('center'),
    })),
    colors,
  };
}

test(
  'prepared count and paint edit serves current queries and an independent split before source publication',
  { timeout },
  async () => {
    const font = await fonts.load('inter');
    const initial = { text: 'ink', style: { fontSize: 6, color: '#0000ff' } };
    const edited = {
      text: 'painted words',
      style: { fontSize: 9, color: '#ff0000' },
      constraints: { width: { mode: 'exact', size: 80 } },
    };
    const cold = mount(font, [{ properties: edited }]);
    let expected;
    try {
      const [copy, decorations] = cold.nodes[0].split();
      try {
        expected = { query: querySnapshot(cold.nodes[0]), split: splitSnapshot(copy) };
      } finally {
        copy.dispose();
        decorations?.dispose();
      }
    } finally {
      unmount(cold);
    }
    assert.ok(expected.split.colors.length > 0, 'the oracle includes drawable paint');
    assert.ok(
      expected.split.colors.every(([red, green, blue]) => red === 1 && green === 0 && blue === 0),
      'the cold split carries the authored red paint',
    );

    const mounted = mount(font, [
      { properties: initial },
      { properties: { text: 'sibling stays', style: { fontSize: 6 } } },
    ]);
    const [source, sibling] = mounted.nodes;
    let copy;
    let decorations;
    try {
      const rendererBefore = drawBytes(mounted.scene);
      const initialGlyphCount = source.measure().glyphCount;
      const siblingBefore = querySnapshot(sibling);
      source.set(edited);
      assert.equal(source.text, edited.text, 'queries must retain the authored replacement');
      assert.equal(source.commitState().status, 'pending');
      assert.notEqual(expected.query.measure.glyphCount, initialGlyphCount, 'the edit changes glyph count');

      assert.deepEqual(
        querySnapshot(source),
        expected.query,
        'all prepared public queries match independent cold layout',
      );
      [copy, decorations] = source.split();
      const saved = splitSnapshot(copy);
      assert.deepEqual(saved, expected.split, 'the pending split carries cold geometry and paint');
      assert.equal(source.commitState().status, 'pending', 'queries and split do not publish the source');
      assert.deepEqual(querySnapshot(sibling), siblingBefore, 'the sibling keeps its accepted query state');
      assert.equal(sibling.commitState().status, 'committed');
      assert.deepEqual(drawBytes(mounted.scene), rendererBefore, 'the source renderer still holds its accepted bytes');

      source.set({ text: 'later edit', style: { fontSize: 7, color: '#00ff00' } });
      source.measure();
      mounted.scene.updateMatrixWorld(true);
      source.dispose();
      assert.deepEqual(
        splitSnapshot(copy),
        saved,
        'later edit, publication, and source disposal cannot mutate the split',
      );
    } finally {
      copy?.dispose();
      decorations?.dispose();
      unmount(mounted);
    }
  },
);
