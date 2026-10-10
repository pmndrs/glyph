import assert from 'node:assert/strict';
import test from 'node:test';

import { bitmap } from '@pmndrs/glyph';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

/** Records the newest synchronous-measure request before the shaper instance is created. */
let latestRequest;
let preparationCalls = 0;
let publicationCalls = 0;
const instantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async (source, imports) => {
  const instance = await instantiate(source, imports);
  const exports = { ...instance.exports };
  const measure = exports[textShaperAbi.functions.measureParagraph];
  exports[textShaperAbi.functions.measureParagraph] = (...args) => {
    const [, pointer, length] = args;
    latestRequest = new Uint8Array(exports.memory.buffer, pointer, length).slice();
    preparationCalls += 1;
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
    return {
      start: view.getUint32(at + record.textStart, true),
      deleteCount: view.getUint32(at + record.deleteCount, true),
      insertCount: view.getUint32(at + record.insertCount, true),
    };
  });
}

test('a one-character assignment sends the full candidate for Rust-owned sparse discovery', { timeout }, async () => {
  const font = await fonts.load('inter');
  const text = 'The quick brown fox jumps over the lazy dog';
  const properties = { style: { fontSize: 6 }, constraints: { width: { mode: 'exact', size: 120 } }, text };
  const mounted = mount(font, [{ properties }]);
  try {
    const [node] = mounted.nodes;
    const before = { preparationCalls, publicationCalls };
    node.set({ text: `${text.slice(0, 10)}x${text.slice(10)}` });
    assert.equal(preparationCalls, before.preparationCalls + 1, 'the setter synchronously prepares exactly once');
    assert.deepEqual(textMutations(latestRequest), [
      { start: 0, deleteCount: text.length, insertCount: text.length + 1 },
    ]);
    for (let index = 0; index < 100; index += 1) node.measure();
    const glyphs = node.glyphs();
    assert.equal(
      Array.from(glyphs.lineGlyphCounts).reduce((total, count) => total + count, 0),
      glyphs.glyphCount,
      'owned glyph demand combines prepared line spans with borrowed glyph records',
    );
    assert.equal(preparationCalls, before.preparationCalls + 1, 'unchanged metric and glyph reads reuse preparation');
    assert.equal(publicationCalls, before.publicationCalls, 'reads do not publish renderer state');
  } finally {
    unmount(mounted);
    fonts.dispose();
  }
});

test(
  'a scattered same-length assignment sends one full replacement to the packed Rust comparator',
  { timeout },
  async () => {
    const font = await fonts.load('inter');
    const text = 'alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet';
    const properties = { style: { fontSize: 6 }, constraints: { width: { mode: 'exact', size: 120 } }, text };
    const mounted = mount(font, [{ properties }]);
    try {
      const [node] = mounted.nodes;
      const before = preparationCalls;
      node.set({ text: 'Alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|JulieT' });
      assert.equal(preparationCalls, before + 1, 'assignment owns the preparation call');
      assert.deepEqual(textMutations(latestRequest), [{ start: 0, deleteCount: 62, insertCount: 62 }]);
    } finally {
      unmount(mounted);
      fonts.dispose();
    }
  },
);
