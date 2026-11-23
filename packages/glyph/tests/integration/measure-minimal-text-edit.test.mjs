import assert from 'node:assert/strict';
import test from 'node:test';

import { bitmap } from '@pmndrs/glyph';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

/** Records the newest on-demand preparation request; installed before the shaper instance is created. */
let latestRequest;
let preparationCalls = 0;
let queryMaterializationCalls = 0;
let publicationCalls = 0;
const instantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async (source, imports) => {
  const instance = await instantiate(source, imports);
  const exports = { ...instance.exports };
  const measure = exports[textShaperAbi.functions.measureParagraph];
  exports[textShaperAbi.functions.measureParagraph] = (...args) => {
    const [, pointer, length] = args;
    latestRequest = new Uint8Array(exports.memory.buffer, pointer, length).slice();
    const layout = textShaperAbi.layouts.engineUpdateRequest;
    const header = new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength);
    const semanticCounts = [
      layout.paragraphMutationCount,
      layout.paragraphOrderMutationCount,
      layout.textMutationCount,
      layout.styleMutationCount,
      layout.constraintCount,
      layout.regionCount,
      layout.exclusionCount,
      layout.inlineObjectCount,
    ];
    if (semanticCounts.some((offset) => header.getUint32(offset, true) > 0)) preparationCalls += 1;
    else queryMaterializationCalls += 1;
    return measure(...args);
  };
  for (const name of [textShaperAbi.functions.textUpdate, textShaperAbi.functions.textUpdateBatch]) {
    const publish = exports[name];
    exports[name] = (...args) => {
      publicationCalls += 1;
      return publish(...args);
    };
  }
  return { exports };
};
const { createFontCache, mount, timeout, unmount } = await import('../support/text-mutation-lanes.mjs');
WebAssembly.instantiate = instantiate;

const fonts = createFontCache({ inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap({ strikes: [16] }) } });

function textMutations(bytes) {
  const request = textShaperAbi.layouts.engineUpdateRequest;
  const record = textShaperAbi.layouts.engineTextMutation;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = view.getUint32(request.textMutationsOffset, true);
  const count = view.getUint32(request.textMutationCount, true);
  return Array.from({ length: count }, (_, index) => {
    const at = offset + index * record.size;
    const insertOffset = view.getUint32(at + record.insertOffset, true);
    const insertCount = view.getUint32(at + record.insertCount, true);
    return {
      start: view.getUint32(at + record.textStart, true),
      deleteCount: view.getUint32(at + record.deleteCount, true),
      insert: String.fromCharCode(
        ...Array.from({ length: insertCount }, (_value, unit) => view.getUint16(insertOffset + unit * 2, true)),
      ),
    };
  });
}

/** Everything a layout decides, as plain data. */
function layoutOf(node) {
  const glyphs = node.glyphs();
  const measurement = node.measure();
  return {
    width: measurement.width,
    height: measurement.height,
    lineCount: measurement.lineCount,
    glyphCount: measurement.glyphCount,
    glyphIds: [...glyphs.glyphIds],
    x: [...glyphs.x],
    y: [...glyphs.y],
    clusters: [...glyphs.clusters],
  };
}

/** The text ranges of the request's style records: a length-changing edit restates the range of each style it moves. */
function styleRanges(bytes) {
  const request = textShaperAbi.layouts.engineUpdateRequest;
  const record = textShaperAbi.layouts.engineStyleMutation;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = view.getUint32(request.styleMutationsOffset, true);
  const count = view.getUint32(request.styleMutationCount, true);
  return Array.from({ length: count }, (_, index) => ({
    start: view.getUint32(offset + index * record.size + record.textStart, true),
    end: view.getUint32(offset + index * record.size + record.textEnd, true),
  }));
}

/** Bytes of a request holding only its header, the given records and the inserted UTF-16 units. */
function editRequestBytes({ textRecords, styleRecords, insertedUnits }) {
  return (
    textShaperAbi.layouts.engineUpdateRequest.size +
    textRecords * textShaperAbi.layouts.engineTextMutation.size +
    styleRecords * textShaperAbi.layouts.engineStyleMutation.size +
    insertedUnits * 2
  );
}

test('a one-character assignment sends a one-unit range replacement from the read', { timeout }, async () => {
  const font = await fonts.load('inter');
  const text = 'The quick brown fox jumps over the lazy dog';
  const edited = `${text.slice(0, 10)}x${text.slice(10)}`;
  const properties = { style: { fontSize: 6 }, constraints: { width: { mode: 'exact', size: 120 } }, text };
  const mounted = mount(font, [{ properties }, { properties: { ...properties, text: edited } }]);
  try {
    const [node, cold] = mounted.nodes;
    const before = { preparationCalls, queryMaterializationCalls, publicationCalls };
    latestRequest = undefined;
    node.set({ text: edited });
    assert.equal(preparationCalls, before.preparationCalls, 'the setter does not enter the engine');
    assert.equal(queryMaterializationCalls, before.queryMaterializationCalls, 'the setter materializes nothing');
    assert.equal(latestRequest, undefined, 'the setter sends no request');
    node.measure();
    assert.equal(preparationCalls, before.preparationCalls + 1, 'the first read prepares exactly once');
    assert.equal(
      queryMaterializationCalls,
      before.queryMaterializationCalls,
      'the preparing read returns its summary from the same call',
    );
    assert.deepEqual(textMutations(latestRequest), [{ start: 10, deleteCount: 0, insert: 'x' }]);
    assert.deepEqual(
      styleRanges(latestRequest),
      [{ start: 0, end: edited.length }],
      'the base style is restated only to cover the longer text',
    );
    assert.equal(
      latestRequest.byteLength,
      editRequestBytes({ textRecords: 1, styleRecords: 1, insertedUnits: 1 }),
      'the request carries one text record, one style range and one inserted unit, not the paragraph',
    );
    for (let index = 0; index < 100; index += 1) node.measure();
    const glyphs = node.glyphs();
    assert.equal(
      Array.from(glyphs.lineGlyphCounts).reduce((total, count) => total + count, 0),
      glyphs.glyphCount,
      'owned glyph demand combines prepared line spans with borrowed glyph records',
    );
    assert.equal(preparationCalls, before.preparationCalls + 1, 'unchanged metric and glyph reads reuse preparation');
    assert.equal(
      queryMaterializationCalls,
      before.queryMaterializationCalls + 1,
      'repeated measurement reuses the summary; the glyph read positions once for its glyph facts',
    );
    assert.equal(publicationCalls, before.publicationCalls, 'reads do not publish renderer state');
    assert.deepEqual(layoutOf(node), layoutOf(cold), 'the range edit leaves the layout of a cold build');
  } finally {
    unmount(mounted);
    fonts.dispose();
  }
});

test(
  'a scattered same-length assignment sends one replacement spanning its first to last differing unit',
  { timeout },
  async () => {
    const font = await fonts.load('inter');
    const text = 'alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet';
    const edited = 'alpha|Bravo|charlie|delta|eCho|foxtrot|golf|hotel|India|juliet';
    const first = text.indexOf('bravo');
    const last = text.indexOf('india');
    const properties = { style: { fontSize: 6 }, constraints: { width: { mode: 'exact', size: 120 } }, text };
    const mounted = mount(font, [{ properties }, { properties: { ...properties, text: edited } }]);
    try {
      const [node, cold] = mounted.nodes;
      const before = { preparationCalls, queryMaterializationCalls, publicationCalls };
      latestRequest = undefined;
      node.set({ text: edited });
      assert.equal(preparationCalls, before.preparationCalls, 'the setter does not enter the engine');
      assert.equal(latestRequest, undefined, 'the setter sends no request');
      node.measure();
      assert.equal(preparationCalls, before.preparationCalls + 1, 'the read owns the one preparation call');
      assert.equal(queryMaterializationCalls, before.queryMaterializationCalls);
      assert.deepEqual(
        textMutations(latestRequest),
        [{ start: first, deleteCount: last + 1 - first, insert: edited.slice(first, last + 1) }],
        'three scattered differences travel as the one range from the first to the last of them',
      );
      assert.deepEqual(styleRanges(latestRequest), [], 'a same-length edit moves no style range');
      assert.equal(
        latestRequest.byteLength,
        editRequestBytes({ textRecords: 1, styleRecords: 0, insertedUnits: last + 1 - first }),
        'the request carries one text record and the replaced span only',
      );
      assert.equal(publicationCalls, before.publicationCalls, 'the read does not publish renderer state');
      assert.deepEqual(layoutOf(node), layoutOf(cold), 'the spanning edit leaves the layout of a cold build');
      assert.equal(preparationCalls, before.preparationCalls + 1, 'layout inspection reuses the preparation');
    } finally {
      unmount(mounted);
      fonts.dispose();
    }
  },
);
