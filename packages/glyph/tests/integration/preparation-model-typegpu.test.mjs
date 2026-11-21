import { crossingsOf } from '../support/wasm-crossings.mjs';

import assert from 'node:assert/strict';
import test from 'node:test';

import { readFile } from 'node:fs/promises';

import { glyph, msdf } from '@pmndrs/glyph';
import { preparationModel } from '../support/preparation-model.mjs';
import { recordingHost } from '../support/typegpu-recording-host.mjs';

const fontBytes = await readFile(
  new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url),
);
await glyph.init();
let nextHandle = 1;

preparationModel('TypeGPU', async (labels) => {
  const host = recordingHost();
  const handle = glyph.handle(`typegpu:preparation-model:${String(nextHandle++)}`, host.config);
  const font = glyph.fontFace(new Blob([fontBytes]), { format: msdf });
  await font.load();
  const values = [...labels];
  const texts = labels.map((text, index) => handle.createText({ font, text, position: [0, index * 40] }));
  return {
    texts: texts.map((text, index) => ({
      object: text,
      value: () => values[index],
      set: (value) => {
        text.update({ text: value });
        values[index] = value;
      },
      setStyle: (style) => text.update({ style }),
      read: () => text.measure(),
    })),
    frame: () => glyph.shape(),
    unmount: () => {
      handle.dispose();
      font.dispose();
    },
  };
});

test('TypeGPU: an anchored text is constructed without entering the engine and drawn anchored on its first frame', async () => {
  const host = recordingHost();
  const handle = glyph.handle(`typegpu:preparation-model:${String(nextHandle++)}`, host.config);
  const font = glyph.fontFace(new Blob([fontBytes]), { format: msdf });
  await font.load();
  try {
    let anchored;
    assert.deepEqual(
      crossingsOf(() => {
        handle.createText({ font, text: 'Anchor', position: [100, 100] });
        anchored = handle.createText({
          font,
          text: 'Anchor',
          position: [100, 100],
          constraints: { anchor: { x: 'center', y: 'middle' } },
        });
      }),
      {},
    );
    assert.deepEqual(
      crossingsOf(() => glyph.shape()),
      { engine_prepare_batch: 1, engine_update_batch: 1 },
    );
    handle.draw({}, { width: 640, height: 240 });
    const offset = anchored.measure().anchorOffset;
    assert.ok(offset.x < 0 && offset.y < 0);
    assert.deepEqual(
      host.recorded.map((draw) => [...draw.position]),
      [
        [100, 100],
        [100 + offset.x, 100 + offset.y],
      ],
    );
  } finally {
    handle.dispose();
    font.dispose();
  }
});
