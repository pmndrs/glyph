import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const wasmUrl = new URL("../../dist/text_shaper.wasm", import.meta.url);
const abiUrl = new URL("../../dist/text-shaper-abi-v0.json", import.meta.url);

test("fixed-seed shaper request mutations fail safely and deterministically", async () => {
  const [wasm, abi] = await Promise.all([
    readFile(wasmUrl),
    readFile(abiUrl, "utf8").then(JSON.parse),
  ]);
  const module = await WebAssembly.compile(wasm);
  const corpus = mutationCorpus();
  const first = await execute(module, abi, corpus);
  const second = await execute(module, abi, corpus);
  assert.deepEqual(first, second);
  assert.ok(first.every((status) => status === 5 || status === 6));
});

async function execute(module, abi, corpus) {
  const instance = await WebAssembly.instantiate(module, {});
  const memory = instance.exports.memory;
  const allocate = instance.exports[abi.functions.allocate];
  const deallocate = instance.exports[abi.functions.deallocate];
  const shapeBatch = instance.exports[abi.functions.shapeBatch];
  const reshapeRanges = instance.exports[abi.functions.reshapeRanges];
  const statuses = [];
  for (const { bytes, reshape } of corpus) {
    const pointer = allocate(bytes.length);
    new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes);
    statuses.push((reshape ? reshapeRanges : shapeBatch)(pointer, bytes.length));
    deallocate(pointer, bytes.length);
  }
  const outOfBounds = memory.buffer.byteLength - 2;
  statuses.push(shapeBatch(outOfBounds, 8));
  statuses.push(reshapeRanges(outOfBounds, 8));
  return statuses;
}

function mutationCorpus() {
  const bases = [shapeRequest(), reshapeRequest()];
  const corpus = bases.map((bytes, reshape) => ({ bytes, reshape: reshape === 1 }));
  let state = 0x504d_4e44;
  for (const [baseIndex, base] of bases.entries()) {
    for (let mutation = 0; mutation < 128; mutation++) {
      const bytes = base.slice();
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      const offset = state % bytes.length;
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      bytes[offset] ^= state & 0xff || 1;
      corpus.push({ bytes, reshape: baseIndex === 1 });
    }
  }
  return corpus;
}

function shapeRequest() {
  const bytes = new Uint8Array(68);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 32, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, 36, true);
  view.setUint32(12, 1, true);
  view.setUint32(16, 68, true);
  view.setUint32(20, 0, true);
  view.setUint32(24, 68, true);
  view.setUint32(28, 0, true);
  view.setUint16(32, 0x41, true);
  writeRun(view, 36);
  return bytes;
}

function reshapeRequest() {
  const bytes = new Uint8Array(100);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 40, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, 44, true);
  view.setUint32(12, 1, true);
  view.setUint32(16, 76, true);
  view.setUint32(20, 0, true);
  view.setUint32(24, 76, true);
  view.setUint32(28, 0, true);
  view.setUint32(32, 76, true);
  view.setUint32(36, 1, true);
  view.setUint16(40, 0x41, true);
  writeRun(view, 44);
  view.setUint32(76, 0, true);
  view.setUint32(80, 0, true);
  view.setUint32(84, 1, true);
  view.setUint32(88, 0, true);
  view.setUint32(92, 1, true);
  view.setUint32(96, 0x40, true);
  return bytes;
}

function writeRun(view, offset) {
  view.setUint32(offset, 1, true);
  view.setUint32(offset + 4, 0, true);
  view.setUint32(offset + 8, 1, true);
  view.setUint32(offset + 12, 0x4c61_746e, true);
  view.setUint32(offset + 16, 0xffff_ffff, true);
  view.setUint32(offset + 20, 0, true);
  view.setUint16(offset + 24, 0, true);
  view.setUint8(offset + 26, 0);
  view.setUint8(offset + 27, 0);
  view.setUint32(offset + 28, 0x40, true);
}
