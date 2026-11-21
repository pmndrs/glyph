import '../support/wasm-crossings.mjs';

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
