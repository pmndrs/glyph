// One process, one memory cap: grows a paragraph until the engine fails, then reports whether the
// root, an unrelated sibling label and the victim itself still work. Printed as one JSON line.
import { capWasmMemory, shaperInstanceCount, shaperMemoryPages } from './wasm-crossings.mjs';

import { readFile } from 'node:fs/promises';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { loadFont } from '../../dist/loader.js';

const maxPages = Number(process.argv[2]);
const recover = process.argv[3];
const wasm = await readFile(new URL('../../dist/text-shaper.wasm', import.meta.url));
await glyph.init({ wasm: capWasmMemory(wasm, maxPages) });
const font = await loadFont(
  {
    baked: {
      bytes: await readFile(
        new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url),
      ),
    },
  },
  bitmap({ strikes: [16] }),
);
const handle = glyph.handle('three:capped-memory', defineThreeConfig({ maxTextUnits: 1 << 24 }));
const scene = new THREE.Scene();
const victim = handle.createText({
  font,
  style: { fontSize: 6 },
  constraints: { width: { mode: 'exact', size: 400 } },
  text: 'victim paragraph',
});
const sibling = handle.createText({ font, style: { fontSize: 6 }, text: 'innocent sibling label' });
scene.add(victim, sibling);
const frame = () => scene.updateMatrixWorld(true);
frame();
const siblingBefore = sibling.measure().width;
const attempt = (operation) => {
  try {
    return { value: operation() };
  } catch (error) {
    return { threw: `${error?.constructor?.name}: ${String(error?.message).slice(0, 120)}` };
  }
};

const sentence = 'The quick brown fox jumps over the lazy dog. ';
let text = sentence.repeat(64);
let failure;
for (let step = 0; step < 14 && failure === undefined; step += 1) {
  const set = attempt(() => {
    victim.text = text;
  });
  if (set.threw !== undefined) failure = { where: 'setter', units: text.length, error: set.threw };
  else {
    const framed = attempt(frame);
    if (framed.threw !== undefined) failure = { where: 'frame threw', units: text.length, error: framed.threw };
    else if (victim.error !== undefined) {
      failure = {
        where: 'frame',
        units: text.length,
        error: String(victim.error?.message ?? victim.error).slice(0, 120),
      };
    } else text += text;
  }
}

const report = {
  maxPages,
  failure,
  pagesAtFailure: shaperMemoryPages(),
  victimKeptItsValue: victim.text.length === (failure?.units ?? victim.text.length),
  siblingErrorAtFailure:
    sibling.error === undefined ? undefined : String(sibling.error?.message ?? sibling.error).slice(0, 80),
};
// The sibling must be untouched by whatever happened to the victim.
report.siblingRead = attempt(() => sibling.measure().width === siblingBefore);
report.siblingSet = attempt(() => {
  sibling.text = 'innocent sibling edited';
  frame();
  return sibling.commitState().status;
});
if (recover === 'shrink') {
  report.recovery = attempt(() => {
    victim.text = 'small again';
    frame();
    frame();
    return {
      victim: victim.commitState().status,
      error: victim.error === undefined ? undefined : String(victim.error?.message ?? victim.error).slice(0, 80),
      glyphs: victim.measure().glyphCount,
      sibling: sibling.commitState().status,
    };
  });
} else {
  report.recovery = attempt(() => {
    scene.remove(victim);
    victim.dispose();
    frame();
    frame();
    sibling.text = 'innocent sibling after disposal';
    frame();
    return { sibling: sibling.commitState().status, glyphs: sibling.measure().glyphCount };
  });
}
report.siblingAfter = attempt(() => ({ status: sibling.commitState().status, error: sibling.error === undefined }));
report.instances = shaperInstanceCount();
process.stdout.write(`${JSON.stringify(report)}\n`);
