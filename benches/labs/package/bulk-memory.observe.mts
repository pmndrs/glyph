import assert from 'node:assert/strict';
import { rename, writeFile } from 'node:fs/promises';

const output = process.env.GLYPH_BULK_MEMORY_OUTPUT;
if (output === undefined) throw new Error('GLYPH_BULK_MEMORY_OUTPUT is required');
const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
if (gc === undefined) throw new Error('Run with --expose-gc');

const checkpoints: unknown[] = [];
const report: {
  format: string;
  status: 'running' | 'completed' | 'failed';
  workload: object;
  checkpoints: unknown[];
  oracleChecked: number;
  error?: { name: string; message: string };
  cleanupErrors: string[];
  limitations: string[];
} = {
  format: 'glyph-bulk1024-untimed-memory-v1',
  status: 'running',
  workload: {
    labels: 1024,
    producer: 'fixture.createTextBatch(1024)',
    cycles: 8,
    words: ['bravo', 'alpha'],
    publication: 'scene.updateMatrixWorld(true)',
  },
  checkpoints,
  oracleChecked: 0,
  cleanupErrors: [],
  limitations: [
    'V8 process.memoryUsage and exported Wasm capacity are separate observations; neither is added to OS physical footprint.',
    'Explicit GC is requested after each lifecycle phase and is not proof that all memory is reclaimable.',
    'The OS maximum spans the entire command, including all cold controls and teardown; it is not an edit-only peak.',
  ],
};
async function persist(): Promise<void> {
  const next = `${output}.next`;
  await writeFile(next, `${JSON.stringify(report, null, 2)}\n`);
  await rename(next, output);
}
await persist();

// Capture only memories exported by actual instantiated package modules. Remove the hook after fixture loading.
const instantiate = WebAssembly.instantiate;
const memories: WebAssembly.Memory[] = [];
WebAssembly.instantiate = (async (...args: Parameters<typeof WebAssembly.instantiate>) => {
  const result = await instantiate(...args);
  const instance = result instanceof WebAssembly.Instance ? result : result.instance;
  const memory = instance.exports.memory;
  if (memory instanceof WebAssembly.Memory && !memories.includes(memory)) memories.push(memory);
  return result;
}) as typeof WebAssembly.instantiate;

let fixture: typeof import('./fixture.ts') | undefined;
let created: ReturnType<(typeof import('./fixture.ts'))['createTextBatch']> | undefined;
let primaryError: unknown;
async function checkpoint(phase: string, cycle?: number): Promise<void> {
  gc!();
  checkpoints.push({
    phase,
    ...(cycle === undefined ? {} : { cycle }),
    timestamp: new Date().toISOString(),
    js: process.memoryUsage(),
    wasm: memories.map((memory, index) => ({ instance: index, capacityBytes: memory.buffer.byteLength })),
  });
  await persist();
}

try {
  try {
    fixture = await import('./fixture.ts');
  } finally {
    WebAssembly.instantiate = instantiate;
  }
  assert(memories.length > 0, 'installed fixture must instantiate an observable Wasm memory');
  created = fixture.createTextBatch(1024);
  await checkpoint('after-create-and-publish');
  for (let cycle = 0; cycle < 8; cycle++) {
    const word = cycle % 2 === 0 ? 'bravo' : 'alpha';
    for (const [index, label] of created.texts.entries()) label.text = `${word} ${String(index).padStart(4, '0')}`;
    created.scene.updateMatrixWorld(true);
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
    await checkpoint('after-update-and-publish', cycle);
  }

  // All reads and cold controls run after the edit cycles and their persisted checkpoints.
  for (const [index, label] of created.texts.entries()) {
    const expectedText = `alpha ${String(index).padStart(4, '0')}`;
    assert.equal(label.text, expectedText);
    assert.equal(label.commitState().status, 'committed');
    const cold = fixture.createTextBatch(1);
    try {
      cold.texts[0]!.text = expectedText;
      cold.scene.updateMatrixWorld(true);
      if (cold.textGroup.error !== undefined) throw cold.textGroup.error;
      // Demand optional glyph metadata in both independent copies before comparing the complete measurement.
      label.glyphs();
      cold.texts[0]!.glyphs();
      assert.deepStrictEqual(label.measure(), cold.texts[0]!.measure());
      // ThreeGlyphMeasurement has a per-object anchorPoint function; JSON compares every serializable data field.
      const actualGlyphs = label.measureGlyphs();
      const coldGlyphs = cold.texts[0]!.measureGlyphs();
      assert(actualGlyphs !== undefined && actualGlyphs.length > 0);
      assert(coldGlyphs !== undefined && coldGlyphs.length > 0);
      assert.equal(JSON.stringify(actualGlyphs), JSON.stringify(coldGlyphs));
      report.oracleChecked++;
    } finally {
      fixture.disposeTextBatch(cold);
    }
  }
  await checkpoint('cold-oracle-complete');
} catch (error) {
  primaryError = error;
  report.error =
    error instanceof Error ? { name: error.name, message: error.message } : { name: 'Unknown', message: String(error) };
} finally {
  WebAssembly.instantiate = instantiate;
  if (fixture !== undefined && created !== undefined) {
    try {
      fixture.disposeTextBatch(created);
      await checkpoint('after-dispose');
    } catch (error) {
      report.cleanupErrors.push(`labels: ${String(error)}`);
      if (primaryError === undefined) primaryError = error;
    }
  }
  if (fixture !== undefined) {
    for (const [name, font] of [
      ['font', fixture.font],
      ['monoFont', fixture.monoFont],
      ['fredokaFont', fixture.fredokaFont],
    ] as const) {
      try {
        font.dispose();
      } catch (error) {
        report.cleanupErrors.push(`${name}: ${String(error)}`);
        if (primaryError === undefined) primaryError = error;
      }
    }
    try {
      await checkpoint('after-fixture-font-dispose');
    } catch (error) {
      report.cleanupErrors.push(`font checkpoint: ${String(error)}`);
      if (primaryError === undefined) primaryError = error;
    }
  }
  report.status = primaryError === undefined ? 'completed' : 'failed';
  if (primaryError !== undefined && report.error === undefined) {
    report.error =
      primaryError instanceof Error
        ? { name: primaryError.name, message: primaryError.message }
        : { name: 'Unknown', message: String(primaryError) };
  }
  try {
    await persist();
  } catch (error) {
    if (primaryError === undefined) primaryError = error;
    else process.stderr.write(`Could not persist final partial checkpoints: ${String(error)}\n`);
  }
}
if (primaryError !== undefined) throw primaryError;
