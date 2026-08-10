/* @workflow {
  "name": "text:rust-layout-benchmark",
  "summary": "Measures the complete retained Rust text_update path with real font data and render-plan publication.",
  "requirements": "Built @pmndrs/text and @pmndrs/text/bake packages. Accepts --glyphs, --reps, --warmup, and --json.",
  "writes": "stdout and the optional JSON report path"
} */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { validateFontArtifact } from '@pmndrs/text/bake';
import { validateBitmapArtifact } from '@pmndrs/text/bakers/bitmap/validate';
import { validateMsdfArtifact } from '@pmndrs/text/bakers/msdf/validate';
import { validateSlugArtifact } from '@pmndrs/text/bakers/slug/validate';
import { bitmapDescriptor } from '@pmndrs/text/raster/bitmap';
import { msdfDescriptor } from '@pmndrs/text/raster/msdf';
import { slugDescriptor } from '@pmndrs/text/raster/slug';

import { paragraphTextForGlyphs } from './support/paragraph-benchmark-fixture.mts';
import { copyIntoAllocation, engineFrameUpdateBytes } from '../tests/support/engine-abi.mjs';
import { techniqueProof } from './support/render-technique-proof.mjs';

const options = parseArguments(process.argv.slice(2));
const sessionId = 1;
const policyHandle = 1;
const fontHandle = 1;
const fontStackHandle = 1;
const regionHeight = options.height;

const [wasm, abi, artifact] = await Promise.all([
  readFile(options.wasm ?? new URL('../dist/text_shaper.wasm', import.meta.url)),
  readFile(new URL('../dist/text-shaper-abi-v0.json', import.meta.url), 'utf8').then(JSON.parse),
  loadArtifact(options.technique),
]);
const validated = await validateFontArtifact(artifact);
const raster = await validateRaster(options.technique, artifact, validated);
const technique = techniqueProof(abi, options.technique, raster, options.allocation);
const outputCapacity = technique.outputBytesPerGlyph > 48 ? 8 * 1024 * 1024 : 4 * 1024 * 1024;
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
  `technique=${options.technique} allocation=${options.allocation} output=${technique.outputBytesPerGlyph} bytes/glyph · memory bytes: instantiate=${memoryAtInstantiation}, initialize=${memoryAfterInitialize}, registered=${memoryAfterRegistration}`,
);

const reports = [];
const cases = ['cold', 'no-op', 'font-size', 'column-resize', 'suffix-edit', 'localized-edit', 'localized-splice'];
for (const name of options.case === undefined ? cases : [options.case]) {
  reports.push(name === 'cold' ? measureCold() : measureWarm(name));
}
printReport(reports);
if (options.jsonPath !== undefined) {
  await writeFile(
    options.jsonPath,
    `${JSON.stringify(
      {
        schemaVersion: 0,
        generatedBy: 'text:rust-layout-benchmark',
        wasmSha256: createHash('sha256').update(wasm).digest('hex'),
        technique: options.technique,
        allocation: options.allocation,
        glyphTarget: options.glyphs,
        warmup: options.warmup,
        repetitions: options.repetitions,
        reports,
      },
      undefined,
      2,
    )}\n`,
  );
  console.log(`wrote ${options.jsonPath}`);
}

function measureCold() {
  const samples = [];
  const plans = [];
  let glyphs = 0;
  for (let index = 0; index < options.warmup + options.repetitions; index += 1) {
    createSession(initial.byteLength);
    const result = execute(initial, true);
    glyphs = result.glyphCount;
    if (index >= options.warmup) {
      samples.push(result.durationMs);
      plans.push(result);
    }
    requireStatus(fn.disposeSession(sessionId), 'dispose cold session');
  }
  return summarize('cold', glyphs, samples, plans);
}

function measureWarm(name) {
  createSession(initial.byteLength);
  let state = execute(initial, true);
  const liveGlyphCount = state.glyphCount;
  const localizedText = [...utf16];
  const spliceStart = Math.floor(utf16.length / 2);
  let spliceInserted = false;
  let suffixLength = utf16.length;
  const samples = [];
  const plans = [];
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
    } else if (name === 'localized-splice') {
      const insert = spliceInserted ? [] : [0x61];
      const deleteCount = spliceInserted ? 1 : 0;
      spliceInserted = !spliceInserted;
      const textEnd = utf16.length + Number(spliceInserted);
      bytes = updateBytes({
        ...common,
        textMutation: { start: spliceStart, deleteCount, insert },
        style: { ...baseStyle, textEnd },
        geometry: baseGeometry,
      });
    } else {
      bytes = updateBytes({ ...common, geometry: baseGeometry });
    }
    state = execute(bytes, index < options.warmup, `${name}[${index}]`);
    if (index >= options.warmup) {
      samples.push(state.durationMs);
      plans.push(state);
    }
  }
  requireStatus(fn.disposeSession(sessionId), `dispose ${name} session`);
  return summarize(name, liveGlyphCount, samples, plans);
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
  const status = result.getUint32(layout.status, true);
  if (status !== abi.status.ok) {
    const requiredRequestCapacity = result.getUint32(layout.requiredRequestCapacity, true);
    const requiredResultCapacity = result.getUint32(layout.requiredResultCapacity, true);
    throw new Error(
      `${operation} failed with status ${status}; required request=${requiredRequestCapacity}, result=${requiredResultCapacity}`,
    );
  }
  const patchCount = result.getUint32(layout.patchCount, true);
  const patchesOffset = result.getUint32(layout.patchesOffset, true);
  const patchLayout = abi.layouts.enginePatch;
  let writeBytes = 0;
  for (let index = 0; index < patchCount; index += 1) {
    const at = resultPointer + patchesOffset + index * patchLayout.size;
    const patch = new DataView(memory.buffer, at, patchLayout.size);
    if (patch.getUint8(patchLayout.opcode) === abi.engine.patchOpcodes.write) {
      writeBytes += patch.getUint32(patchLayout.byteLength, true);
    }
  }
  const primitiveCount = result.getUint32(layout.primitiveCount, true);
  const primitivesOffset = result.getUint32(layout.primitivesOffset, true);
  const primitiveLayout = abi.layouts.enginePrimitive;
  let glyphCount = 0;
  for (let index = 0; index < primitiveCount; index += 1) {
    const at = resultPointer + primitivesOffset + index * primitiveLayout.size;
    const primitive = new DataView(memory.buffer, at, primitiveLayout.size);
    if (primitive.getUint8(primitiveLayout.kind) === abi.engine.primitiveKinds.glyph) {
      glyphCount += primitive.getUint16(primitiveLayout.recordCount, true);
    }
  }
  return {
    durationMs,
    engineRevision: result.getUint32(layout.engineRevision, true),
    planRevision: result.getUint32(layout.planRevision, true),
    publicationGeneration: result.getUint32(layout.publicationGeneration, true),
    primitiveCount,
    glyphCount,
    patchCount,
    writeBytes,
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
  const bytes = technique.bindingBytes;
  const pointer = copyIntoAllocation(memory, fn.allocate, bytes);
  requireStatus(fn.registerFontBinding(fontHandle, fontHandle, pointer, bytes.byteLength), 'register font binding');
  fn.deallocate(pointer, bytes.byteLength);
}

function registerStack() {
  const bytes = Uint8Array.of(fontHandle, 0, 0, 0);
  const pointer = copyIntoAllocation(memory, fn.allocate, bytes);
  requireStatus(fn.registerFontStack(fontStackHandle, pointer, 1), 'register font stack');
  fn.deallocate(pointer, bytes.byteLength);
}

function registerPolicy() {
  const bytes = technique.policyBytes;
  const pointer = copyIntoAllocation(memory, fn.allocate, bytes);
  requireStatus(fn.registerPolicy(policyHandle, pointer, bytes.byteLength), 'register render policy');
  fn.deallocate(pointer, bytes.byteLength);
}

function summarize(name, glyphs, samples, plans) {
  if (glyphs < Math.floor(options.glyphs * 0.95)) {
    throw new Error(`benchmark planned only ${glyphs} glyph records for a ${options.glyphs}-glyph fixture target`);
  }
  const sorted = samples.toSorted((left, right) => left - right);
  const patchCounts = plans.map((plan) => plan.patchCount).toSorted((left, right) => left - right);
  const writeBytes = plans.map((plan) => plan.writeBytes).toSorted((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return {
    name,
    glyphs,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    minMs: sorted[0],
    rsdPercent: (Math.sqrt(variance) / mean) * 100,
    patchCount: patchCounts[Math.floor(patchCounts.length / 2)],
    writeBytes: writeBytes[Math.floor(writeBytes.length / 2)],
  };
}

function printReport(caseReports) {
  console.log(
    `\ncomplete Rust text_update + ${options.technique} render plan · ${caseReports[0]?.glyphs ?? 0} renderable instances (${options.glyphs} fixture target) · ${options.warmup} warmup · ${options.repetitions} measured`,
  );
  console.log(
    `${'case'.padEnd(16)}${'instances'.padStart(9)}${'median'.padStart(11)}${'p95'.padStart(11)}${'min'.padStart(11)}${'rsd'.padStart(9)}${'patches'.padStart(9)}${'writes'.padStart(11)}`,
  );
  for (const report of caseReports) {
    console.log(
      `${report.name.padEnd(16)}${String(report.glyphs).padStart(9)}${`${report.medianMs.toFixed(3)}ms`.padStart(11)}${`${report.p95Ms.toFixed(3)}ms`.padStart(11)}${`${report.minMs.toFixed(3)}ms`.padStart(11)}${`${report.rsdPercent.toFixed(1)}%`.padStart(9)}${String(report.patchCount).padStart(9)}${formatBytes(report.writeBytes).padStart(11)}`,
    );
  }
  console.log('column-resize is the existing layout-width case: one fully active column is reflowed end to end.');
  console.log(
    'suffix-edit matches the TypeScript text benchmark; localized-edit replaces one code unit; localized-splice alternates one middle insertion/deletion.',
  );
  console.log(`Wasm memory after retained high-water mark: ${(memory.buffer.byteLength / 1024 / 1024).toFixed(2)} MiB`);
}

function formatBytes(value) {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`;
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
    technique: normalizeTechnique(readString('--technique', 'bitmap')),
    allocation: readAllocation('--allocation'),
    wasm: readString('--wasm'),
    case: readCase('--case'),
    glyphs: read('--glyphs', 22_000),
    height: read('--height', 100_000),
    repetitions: read('--reps', 31),
    warmup: read('--warmup', 8),
    jsonPath: readString('--json'),
  };

  function readString(name, fallback) {
    const index = arguments_.indexOf(name);
    return index === -1 ? fallback : arguments_[index + 1];
  }

  function readCase(name) {
    const value = readString(name);
    if (
      value !== undefined &&
      !['cold', 'no-op', 'font-size', 'column-resize', 'suffix-edit', 'localized-edit', 'localized-splice'].includes(
        value,
      )
    ) {
      throw new RangeError(`unknown benchmark case: ${value}`);
    }
    return value;
  }

  function readAllocation(name) {
    const value = readString(name, 'ordered');
    if (value !== 'ordered' && value !== 'stable') throw new RangeError(`unknown allocation strategy: ${value}`);
    return value;
  }
}

function normalizeTechnique(value) {
  const name = value === 'msdf' ? 'mtsdf' : value;
  if (!['bitmap', 'mtsdf', 'slug'].includes(name)) {
    throw new RangeError('--technique must be bitmap, mtsdf, msdf, or slug');
  }
  return name;
}

async function loadArtifact(techniqueName) {
  const fixtures = {
    bitmap: ['inter-bitmap-16.font.glb', false],
    mtsdf: ['inter-mtsdf.font.glb.gz', true],
    slug: ['inter-slug.font.glb.gz', true],
  };
  const [file, compressed] = fixtures[techniqueName];
  const bytes = await readFile(new URL(`../../../apps/benchmarks/fixtures/rendering/${file}`, import.meta.url));
  return compressed ? gunzipSync(bytes) : bytes;
}

async function validateRaster(techniqueName, bytes, core) {
  const rasterIdentity = core.document.extensions.PMNDRS_font.rasters[0];
  const context = {
    rasterKey: rasterIdentity.rasterKey,
    shapingHash: core.shapingHash,
    glyphCount: core.glyphCount,
    glyphIdWidth: 16,
  };
  if (techniqueName === 'bitmap') {
    return validateBitmapArtifact(bytes, { ...context, descriptor: bitmapDescriptor({ strikes: [16] }) });
  }
  if (techniqueName === 'mtsdf') {
    return validateMsdfArtifact(bytes, { ...context, descriptor: msdfDescriptor() });
  }
  return validateSlugArtifact(bytes, { ...context, descriptor: slugDescriptor() });
}
