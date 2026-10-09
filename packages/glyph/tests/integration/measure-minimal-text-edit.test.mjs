import assert from 'node:assert/strict';
import test from 'node:test';

import { bitmap } from '@pmndrs/glyph';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

/** Records the newest synchronous-measure request before the shaper instance is created. */
let latestRequest;
const instantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async (source, imports) => {
  const instance = await instantiate(source, imports);
  const exports = { ...instance.exports };
  const measure = exports[textShaperAbi.functions.measureParagraph];
  exports[textShaperAbi.functions.measureParagraph] = (...args) => {
    const [, pointer, length] = args;
    latestRequest = new Uint8Array(exports.memory.buffer, pointer, length).slice();
    return measure(...args);
  };
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

test('a measured one-character edit sends the minimal splice, not a whole-text replacement', { timeout }, async () => {
  const font = await fonts.load('inter');
  const text = 'The quick brown fox jumps over the lazy dog';
  const properties = { style: { fontSize: 6 }, constraints: { width: { mode: 'exact', size: 120 } }, text };
  const mounted = mount(font, [{ properties }]);
  try {
    const [node] = mounted.nodes;
    node.set({ text: `${text.slice(0, 10)}x${text.slice(10)}` });
    node.measure();
    assert.deepEqual(textMutations(latestRequest), [{ start: 10, deleteCount: 0, insertCount: 1 }]);
  } finally {
    unmount(mounted);
    fonts.dispose();
  }
});

test('a measured full-string assignment sends one replacement spanning distant edits', { timeout }, async () => {
  const font = await fonts.load('inter');
  const text = 'alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet';
  const properties = { style: { fontSize: 6 }, constraints: { width: { mode: 'exact', size: 120 } }, text };
  const mounted = mount(font, [{ properties }]);
  try {
    const [node] = mounted.nodes;
    node.set({ text: 'Alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|JulieT' });
    node.measure();
    assert.deepEqual(textMutations(latestRequest), [{ start: 0, deleteCount: 62, insertCount: 62 }]);
  } finally {
    unmount(mounted);
    fonts.dispose();
  }
});
