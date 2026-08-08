/* @workflow {
  "name": "text:rust-layout-benchmark",
  "summary": "Measures the complete retained Rust text_update path with real font data and render-plan publication.",
  "requirements": "Built @pmndrs/text and @pmndrs/text-font-baker packages. Accepts --glyphs, --reps, and --warmup.",
  "writes": "stdout only"
} */
import { readFile } from 'node:fs/promises';

import { validateFontArtifact } from '@pmndrs/text-font-baker/validate';

import { paragraphTextForGlyphs } from './support/paragraph-benchmark-fixture.mts';
import {
  copyIntoAllocation,
  engineFrameUpdateBytes,
  fontBindingBytes,
  renderPolicyBytes,
} from '../tests/support/engine-abi.mjs';

const options = parseArguments(process.argv.slice(2));
const sessionId = 1;
const policyHandle = 1;
const fontHandle = 1;
const fontStackHandle = 1;
const outputCapacity = 4 * 1024 * 1024;
const regionHeight = options.height;

const [wasm, abi, artifact] = await Promise.all([
  readFile(new URL('../dist/text_shaper.wasm', import.meta.url)),
  readFile(new URL('../dist/text-shaper-abi-v0.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
]);
const validated = await validateFontArtifact(artifact);
const instance = await WebAssembly.instantiate(await WebAssembly.compile(wasm), {});
const memory = instance.exports[abi.memory];
const fn = Object.fromEntries(
  Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
);
const memoryAtInstantiation = memory.buffer.byteLength;
requireStatus(fn.initialize(), 'initialize');
const memoryAfterInitialize = memory.buffer.byteLength;
registerFont();
registerBinding();
registerStack();
registerPolicy();
const memoryAfterRegistration = memory.buffer.byteLength;

const text = paragraphTextForGlyphs(options.glyphs);
const utf16 = stringToUtf16(text);
const limits = {
  maxClusters: utf16.length + 1,
  maxLines: utf16.length + 1,
  maxOutputBytes: outputCapacity,
};
const baseGeometry = { width: 600, height: regionHeight, maxLines: utf16.length + 1, revision: 1 };
const baseStyle = { textEnd: utf16.length, fontSize: 24, lineHeight: 1.2, rasterPixelRatio: 1 };
const initial = updateBytes({
  textMutation: { start: 0, deleteCount: 0, insert: utf16 },
  style: baseStyle,
  geometry: baseGeometry,
});
let sessionMemory;

console.log(
  `memory bytes: instantiate=${memoryAtInstantiation}, initialize=${memoryAfterInitialize}, registered=${memoryAfterRegistration}`,
);

const reports = [];
reports.push(measureCold());
for (const name of ['no-op', 'font-size', 'column-resize', 'suffix-edit', 'localized-edit']) {
  reports.push(measureWarm(name));
}
printReport(reports);

function measureCold() {
  const samples = [];
  let glyphs = 0;
  for (let index = 0; index < options.warmup + options.repetitions; index += 1) {
    createSession(initial.byteLength);
    const result = execute(initial, true);
    glyphs = result.primitiveCount;
    if (index >= options.warmup) samples.push(result.durationMs);
    requireStatus(fn.disposeSession(sessionId), 'dispose cold session');
  }
  return summarize('cold', glyphs, samples);
}

function measureWarm(name) {
  createSession(initial.byteLength);
  let state = execute(initial, true);
  const livePrimitiveCount = state.primitiveCount;
  const localizedText = [...utf16];
  let suffixLength = utf16.length;
  const samples = [];
  for (let index = 0; index < options.warmup + options.repetitions; index += 1) {
    const revision = index + 2;
    const common = {
      expectedEngineRevision: state.engineRevision,
      consumedPlanRevision: state.planRevision,
      acknowledgedPublicationGeneration: state.publicationGeneration,
    };
    let bytes;
    if (name === 'font-size') {
      bytes = updateBytes({
        ...common,
        style: { ...baseStyle, fontSize: 12 + index * 0.5 },
        geometry: baseGeometry,
      });
    } else if (name === 'column-resize') {
      bytes = updateBytes({
        ...common,
        geometry: { ...baseGeometry, width: 420 + index * 7, revision },
      });
    } else if (name === 'suffix-edit') {
      const nextLength = utf16.length - index;
      const deleteCount = suffixLength - nextLength;
      bytes =
        deleteCount === 0
          ? updateBytes({ ...common, geometry: baseGeometry })
          : updateBytes({
              ...common,
              textMutation: { start: nextLength, deleteCount, insert: [] },
              style: { ...baseStyle, textEnd: nextLength },
              geometry: baseGeometry,
            });
      suffixLength = nextLength;
    } else if (name === 'localized-edit') {
      const start = Math.floor(utf16.length / 2) + index;
      const replacement = localizedText[start] === 0x61 ? 0x62 : 0x61;
      localizedText[start] = replacement;
      bytes = updateBytes({
        ...common,
        textMutation: { start, deleteCount: 1, insert: [replacement] },
        geometry: baseGeometry,
      });
    } else {
      bytes = updateBytes({ ...common, geometry: baseGeometry });
    }
    state = execute(bytes, index < options.warmup, `${name}[${index}]`);
    if (index >= options.warmup) samples.push(state.durationMs);
  }
  requireStatus(fn.disposeSession(sessionId), `dispose ${name} session`);
  return summarize(name, livePrimitiveCount, samples);
}

function createSession(requestCapacity) {
  const beforeBytes = memory.buffer.byteLength;
  requireStatus(
    fn.createSession(sessionId, requestCapacity, outputCapacity, utf16.length + 1),
    'create benchmark session',
  );
  if (sessionMemory === undefined) {
    sessionMemory = { beforeBytes, afterBytes: memory.buffer.byteLength };
  }
}

function execute(bytes, allowGrowth = false, operation = 'text_update') {
  const requestPointer = fn.requestPointer(sessionId);
  if (requestPointer === 0 || fn.requestCapacity(sessionId) < bytes.byteLength) {
    throw new Error('benchmark request exceeds its pre-reserved arena');
  }
  const buffer = memory.buffer;
  const bufferBytes = buffer.byteLength;
  const started = performance.now();
  new Uint8Array(buffer, requestPointer, bytes.byteLength).set(bytes);
  const resultPointer = fn.textUpdate(sessionId, requestPointer, bytes.byteLength);
  const durationMs = performance.now() - started;
  if (memory.buffer !== buffer && !allowGrowth) {
    throw new Error(`measured text_update grew Wasm memory from ${bufferBytes} to ${memory.buffer.byteLength} bytes`);
  }
  if (resultPointer === 0) throw new Error('text_update returned a null result');
  const layout = abi.layouts.engineResult;
  const result = new DataView(memory.buffer, resultPointer, layout.size);
  requireStatus(result.getUint32(layout.status, true), operation);
  return {
    durationMs,
    engineRevision: result.getUint32(layout.engineRevision, true),
    planRevision: result.getUint32(layout.planRevision, true),
    publicationGeneration: result.getUint32(layout.publicationGeneration, true),
    primitiveCount: result.getUint32(layout.primitiveCount, true),
    patchCount: result.getUint32(layout.patchCount, true),
  };
}

function updateBytes(fields) {
  return engineFrameUpdateBytes(abi, {
    sessionId,
    policyHandle,
    fontStackHandle,
    limits,
    ...fields,
  });
}

function registerFont() {
  const allocations = [validated.shapingSfnt, validated.glyphExtents, validated.glyphExtentsAvailability].map(
    (bytes) => ({
      pointer: copyIntoAllocation(memory, fn.allocate, bytes),
      length: bytes.byteLength,
    }),
  );
  requireStatus(
    fn.registerFont(
      fontHandle,
      allocations[0].pointer,
      allocations[0].length,
      allocations[1].pointer,
      allocations[1].length,
      allocations[2].pointer,
      allocations[2].length,
    ),
    'register font',
  );
  for (const allocation of allocations) fn.deallocate(allocation.pointer, allocation.length);
}

function registerBinding() {
  const glyphCount = validated.glyphExtents.byteLength / 8;
  const bytes = fontBindingBytes(abi, {
    techniqueId: 1,
    glyphCount,
    strikes: [0],
    resources: [{ id: 1, generation: 1, kind: 1, reference: 1 }],
    resourceIndices: new Array(glyphCount).fill(0),
    glyphF32: [new Array(glyphCount).fill(1)],
  });
  const pointer = copyIntoAllocation(memory, fn.allocate, bytes);
  requireStatus(fn.registerFontBinding(fontHandle, pointer, bytes.byteLength), 'register font binding');
  fn.deallocate(pointer, bytes.byteLength);
}

function registerStack() {
  const bytes = Uint8Array.of(fontHandle, 0, 0, 0);
  const pointer = copyIntoAllocation(memory, fn.allocate, bytes);
  requireStatus(fn.registerFontStack(fontStackHandle, pointer, 1), 'register font stack');
  fn.deallocate(pointer, bytes.byteLength);
}

function registerPolicy() {
  const bytes = renderPolicyBytes(abi);
  const pointer = copyIntoAllocation(memory, fn.allocate, bytes);
  requireStatus(fn.registerPolicy(policyHandle, pointer, bytes.byteLength), 'register render policy');
  fn.deallocate(pointer, bytes.byteLength);
}

function summarize(name, glyphs, samples) {
  const sorted = samples.toSorted((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return {
    name,
    glyphs,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    minMs: sorted[0],
    rsdPercent: (Math.sqrt(variance) / mean) * 100,
  };
}

function printReport(caseReports) {
  console.log(
    `\ncomplete Rust text_update · ${caseReports[0]?.glyphs ?? 0} laid-out glyphs (${options.glyphs} fixture target) · ${options.warmup} warmup · ${options.repetitions} measured`,
  );
  console.log(
    `${'case'.padEnd(16)}${'glyphs'.padStart(9)}${'median'.padStart(11)}${'p95'.padStart(11)}${'min'.padStart(11)}${'rsd'.padStart(9)}`,
  );
  for (const report of caseReports) {
    console.log(
      `${report.name.padEnd(16)}${String(report.glyphs).padStart(9)}${`${report.medianMs.toFixed(3)}ms`.padStart(11)}${`${report.p95Ms.toFixed(3)}ms`.padStart(11)}${`${report.minMs.toFixed(3)}ms`.padStart(11)}${`${report.rsdPercent.toFixed(1)}%`.padStart(9)}`,
    );
  }
  console.log('column-resize is the existing layout-width case: one fully active column is reflowed end to end.');
  console.log('suffix-edit matches the TypeScript text benchmark; localized-edit is an additional one-code-unit edit.');
  console.log(`Wasm memory after retained high-water mark: ${(memory.buffer.byteLength / 1024 / 1024).toFixed(2)} MiB`);
}

function stringToUtf16(value) {
  return Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
}

function requireStatus(status, operation) {
  if (status !== abi.status.ok) throw new Error(`${operation} failed with status ${status}`);
}

function parseArguments(arguments_) {
  const read = (name, fallback) => {
    const index = arguments_.indexOf(name);
    return index === -1 ? fallback : Number.parseInt(arguments_[index + 1], 10);
  };
  return {
    glyphs: read('--glyphs', 22_000),
    height: read('--height', 100_000),
    repetitions: read('--reps', 11),
    warmup: read('--warmup', 5),
  };
}
