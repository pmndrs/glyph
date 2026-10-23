import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = process.env.GLYPH_LABS_PACKAGE_ROOT;
const output = process.env.GLYPH_BITMAP_REPLAY_OUTPUT;
const mode = process.env.GLYPH_BITMAP_REPLAY_MODE;
if (packageRoot === undefined || output === undefined || !['smoke', 'full'].includes(mode ?? '')) {
  throw new Error('Set GLYPH_LABS_PACKAGE_ROOT, GLYPH_BITMAP_REPLAY_OUTPUT, and smoke/full mode');
}

const { textShaperAbi: abi } = (await import(pathToFileURL(resolve(packageRoot, 'dist/text-shaper-abi.js')).href)) as {
  textShaperAbi: {
    functions: Record<string, string>;
    layouts: {
      engineResult: { byteLength: number; size: number; status: number; rootId: number };
      engineUpdateBatchEntry: {
        size: number;
        rootId: number;
        requestLength: number;
        resultPointer: number;
        status: number;
      };
    };
  };
};
const wasm = readFileSync(resolve(packageRoot, 'dist/text-shaper.wasm'));
const module = await WebAssembly.compile(wasm);
const packageFacade = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/index.js')).href
)) as typeof import('@pmndrs/glyph');
const events: Array<Record<string, unknown>> = [];
const blobs: Record<string, { length: number; sha256: string }> = {};
const blobDir = resolve(output, 'blobs');
mkdirSync(blobDir, { recursive: true });
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
let phase = 'fixture-import';
let sequence = 0;
let wrappedInstances = 0;
let memory: WebAssembly.Memory;
let realExports: WebAssembly.Exports;
function blob(label: string, bytes: Uint8Array): string {
  const name = `${String(sequence).padStart(7, '0')}-${label}.bin`;
  const copy = Uint8Array.from(bytes);
  writeFileSync(resolve(blobDir, name), copy);
  blobs[name] = { length: copy.length, sha256: hash(copy) };
  return name;
}
function event(kind: string, fields: Record<string, unknown>): void {
  events.push({ sequence: sequence++, phase, kind, ...fields });
}
function bytesAt(pointer: number, length: number): Uint8Array {
  if (
    !Number.isSafeInteger(pointer) ||
    !Number.isSafeInteger(length) ||
    pointer < 0 ||
    length < 0 ||
    pointer + length > memory.buffer.byteLength
  ) {
    throw new Error(`Invalid Wasm byte range ${pointer}/${length}`);
  }
  return new Uint8Array(memory.buffer, pointer, length);
}
function u32(pointer: number): number {
  return new DataView(memory.buffer).getUint32(pointer, true);
}
function result(pointer: number, rootId: number): { result: string; resultLength: number } {
  const layout = abi.layouts.engineResult;
  if (pointer === 0 || pointer + layout.size > memory.buffer.byteLength)
    throw new Error(`Missing result for root ${rootId}`);
  const length = u32(pointer + layout.byteLength);
  if (length < layout.size || pointer + length > memory.buffer.byteLength)
    throw new Error(`Bad result length ${length}`);
  if (u32(pointer + layout.rootId) !== rootId || u32(pointer + layout.status) !== 0) {
    throw new Error(`Failed or wrong-root result for ${rootId}`);
  }
  return { result: blob('result', bytesAt(pointer, length)), resultLength: length };
}
function request(rootId: number, length: number): string {
  const pointerExport = realExports[abi.functions.requestPointer];
  if (typeof pointerExport !== 'function') throw new Error('Missing request pointer export');
  const pointer = (pointerExport as (root: number) => number)(rootId);
  if (pointer === 0) throw new Error(`Missing request pointer for root ${rootId}`);
  return blob('request', bytesAt(pointer, length));
}

const observed = new Set([
  'initialize',
  'registerFont',
  'disposeFont',
  'registerFontBinding',
  'disposeFontBinding',
  'registerFontStack',
  'disposeFontStack',
  'registerCodec',
  'disposeCodec',
  'createRoot',
  'reserveRoot',
  'resetRoot',
  'disposeRoot',
  'reserveUpdateBatch',
  'measureParagraph',
  'textUpdateBatch',
  'textUpdate',
  'borrowParagraphLayout',
  'borrowParagraphGlyphs',
  'copyGlyphs',
  'copyDecorations',
]);
const originalInstantiate = WebAssembly.instantiate;
try {
  WebAssembly.instantiate = (async (...args: Parameters<typeof WebAssembly.instantiate>) => {
    const instance = await originalInstantiate(...args);
    if (args[0] !== module) return instance;
    if (!(instance instanceof WebAssembly.Instance) || ++wrappedInstances !== 1) {
      throw new Error('Expected exactly one real shaper instance');
    }
    realExports = instance.exports;
    memory = realExports.memory as WebAssembly.Memory;
    if (!(memory instanceof WebAssembly.Memory)) throw new Error('Shaper memory missing');
    const facade: Record<string, WebAssembly.ExportValue> = { ...realExports };
    for (const name of observed) {
      const exportName = abi.functions[name];
      const original = realExports[exportName];
      if (typeof original !== 'function') throw new Error(`Missing ${name} export`);
      facade[exportName] = ((...callArgs: number[]) => {
        if (
          ['textUpdate', 'borrowParagraphLayout', 'borrowParagraphGlyphs', 'copyGlyphs', 'copyDecorations'].includes(
            name,
          )
        ) {
          throw new Error(`Unmodeled ${name} call in exact Bitmap fixture`);
        }
        const inputs: Record<string, unknown> = {};
        if (name === 'registerFont') {
          inputs.sfnt = blob('sfnt', bytesAt(callArgs[1]!, callArgs[2]!));
          inputs.extents = blob('extents', bytesAt(callArgs[3]!, callArgs[4]!));
          inputs.availability = blob('availability', bytesAt(callArgs[5]!, callArgs[6]!));
        } else if (['registerFontBinding', 'registerCodec'].includes(name)) {
          const offset = name === 'registerFontBinding' ? 2 : 1;
          inputs.bytes = blob(name, bytesAt(callArgs[offset]!, callArgs[offset + 1]!));
        } else if (name === 'registerFontStack') {
          inputs.bytes = blob('font-stack', bytesAt(callArgs[1]!, callArgs[2]! * 4));
        } else if (name === 'measureParagraph') {
          inputs.request = request(callArgs[0]!, callArgs[2]!);
        } else if (name === 'textUpdateBatch') {
          const [pointer, count] = callArgs;
          if (count !== 1) throw new Error(`Bitmap replay requires exactly one batch entry, received ${String(count)}`);
          const layout = abi.layouts.engineUpdateBatchEntry;
          const view = new DataView(memory.buffer);
          const entries = [];
          const roots = new Set<number>();
          for (let index = 0; index < count!; index++) {
            const base = pointer! + index * layout.size;
            const rootId = view.getUint32(base + layout.rootId, true);
            const length = view.getUint32(base + layout.requestLength, true);
            if (roots.has(rootId)) throw new Error(`Duplicate root ${rootId} in one batch`);
            roots.add(rootId);
            entries.push({ rootId, requestLength: length, request: request(rootId, length) });
          }
          inputs.entries = entries;
        }
        const answer = (original as (...values: number[]) => number)(...callArgs);
        if (name === 'measureParagraph') {
          Object.assign(inputs, result(answer, callArgs[0]!));
        } else if (name === 'textUpdateBatch') {
          const layout = abi.layouts.engineUpdateBatchEntry;
          const view = new DataView(memory.buffer);
          const responses = [];
          for (let index = 0; index < callArgs[1]!; index++) {
            const base = callArgs[0]! + index * layout.size;
            const rootId = view.getUint32(base + layout.rootId, true);
            const status = view.getUint32(base + layout.status, true);
            const pointer = view.getUint32(base + layout.resultPointer, true);
            if (status !== 0) throw new Error(`Batch root ${rootId} failed with ${status}`);
            responses.push({ rootId, status, ...result(pointer, rootId) });
          }
          inputs.responses = responses;
        }
        if (name !== 'measureParagraph' && name !== 'textUpdateBatch' && answer !== 0) {
          throw new Error(`${name} failed with ${answer}`);
        }
        event(name, { args: callArgs, status: name === 'textUpdateBatch' ? answer : 0, ...inputs });
        return answer;
      }) as WebAssembly.ExportValue;
    }
    return { exports: facade } as WebAssembly.Instance;
  }) as typeof WebAssembly.instantiate;
  await packageFacade.glyph.init({ wasm: module });
} finally {
  WebAssembly.instantiate = originalInstantiate;
}
assert.equal(wrappedInstances, 1, 'facade was accepted exactly once');
assert(packageFacade.glyph.initialized);
process.env.GLYPH_LABS_PACKAGE_ROOT = packageRoot;
const fixture = (await import(
  pathToFileURL(resolve(import.meta.dirname, 'fixture.ts')).href
)) as typeof import('./fixture.ts');
assert.equal(fixture.glyph, packageFacade.glyph, 'fixture reused initialized package');
let batch: ReturnType<typeof fixture.createTextBatch> | undefined;
try {
  phase = 'initial';
  batch = fixture.createTextBatch(1_024);
  assert.equal(batch.texts.length, 1_024);
  assert.equal(batch.textGroup.textCount, 1_024);
  assert(fixture.inspectDraws(batch.scene).glyphs > 0);
  if (mode === 'full') {
    for (const [nextPhase, word] of [
      ['forward', 'bravo'],
      ['reverse', 'alpha'],
    ] as const) {
      phase = nextPhase;
      for (const [index, label] of batch.texts.entries()) {
        const value = `${word} ${String(index).padStart(4, '0')}`;
        label.text = value;
        assert.equal(label.text, value);
      }
      batch.scene.updateMatrixWorld(true);
      if (batch.textGroup.error !== undefined) throw batch.textGroup.error;
      assert(batch.texts.every((text) => text.commitState().status === 'committed'));
      assert.equal(batch.textGroup.textCount, 1_024);
      assert(fixture.inspectDraws(batch.scene).glyphs > 0);
    }
  }
} finally {
  if (batch !== undefined) {
    phase = 'dispose';
    fixture.disposeTextBatch(batch);
  }
}
const measureCounts = Object.fromEntries(
  ['initial', 'forward', 'reverse'].map((name) => [
    name,
    events.filter((e) => e.phase === name && e.kind === 'measureParagraph').length,
  ]),
);
const batchCounts = Object.fromEntries(
  ['initial', 'forward', 'reverse'].map((name) => [
    name,
    events.filter((e) => e.phase === name && e.kind === 'textUpdateBatch').length,
  ]),
);
if (
  measureCounts.initial !== 2_048 ||
  (mode === 'full' && (measureCounts.forward !== 1_024 || measureCounts.reverse !== 1_024))
) {
  throw new Error(`Incomplete setter preparation: ${JSON.stringify(measureCounts)}`);
}
if (batchCounts.initial !== 1 || (mode === 'full' && (batchCounts.forward !== 1 || batchCounts.reverse !== 1))) {
  throw new Error(`Incomplete publication: ${JSON.stringify(batchCounts)}`);
}
writeFileSync(resolve(output, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
writeFileSync(
  resolve(output, 'capture-manifest.json'),
  JSON.stringify(
    {
      mode,
      replayScope: 'one root, one entry per batch; native replay invokes ordered engine entries directly',
      wrappedInstances,
      measureCounts,
      batchCounts,
      eventCount: events.length,
      blobs,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write(JSON.stringify({ mode, eventCount: events.length, measureCounts, batchCounts }) + '\n');
