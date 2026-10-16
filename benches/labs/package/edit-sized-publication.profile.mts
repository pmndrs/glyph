import { Session } from 'node:inspector/promises';
import assert, { deepStrictEqual } from 'node:assert/strict';
import type { Profiler } from 'node:inspector';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { classifyCpuProfileStage } from '../../src/benchmark/cpu-profile-stage.mts';
import {
  createLabels,
  createMultiOwnerPublication,
  createParagraph,
  createTextBatch,
  disposeLabels,
  disposeParagraph,
  disposeTextBatch,
  font,
  glyph,
  inspectDraws,
  paragraphTextForGlyphs,
  createPublishedParagraph,
  fredokaFont,
  fredokaTextForGlyphs,
} from './fixture.ts';

const output = requiredEnvironment('GLYPH_EDIT_PROFILE_OUTPUT');
const profileCase = requiredEnvironment('GLYPH_EDIT_PROFILE_CASE');
const boundary = process.env.GLYPH_EDIT_PROFILE_BOUNDARY ?? 'publication';
const rawBulkReads = process.env.GLYPH_EDIT_PROFILE_READS;
const rawBulkPublicationPath = process.env.GLYPH_EDIT_PROFILE_PUBLICATION_PATH;
const bulkReads = rawBulkReads ?? 'measure';
const bulkPublicationPath = rawBulkPublicationPath ?? 'engine';
const count = positiveInteger(requiredEnvironment('GLYPH_EDIT_PROFILE_COUNT'), 'count');
const iterations = positiveInteger(requiredEnvironment('GLYPH_EDIT_PROFILE_ITERATIONS'), 'iterations');
const warmups = positiveInteger(requiredEnvironment('GLYPH_EDIT_PROFILE_WARMUPS'), 'warmups');
const position = requiredEnvironment('GLYPH_EDIT_PROFILE_POSITION');
if (
  ![
    'same-length',
    'same-value',
    'overwrite-before-publication',
    'length-changing',
    'color-only',
    'interleaved-read',
    'prepared-read',
    'bulk-write',
    'fredoka-edit',
    'inter-edit',
    'width-reflow',
    'font-size',
    'multi-owner-balanced',
    'multi-owner-unbalanced',
  ].includes(profileCase)
) {
  throw new Error(`Unknown profile case: ${profileCase}`);
}
if (position !== 'first' && position !== 'last') throw new Error(`Unknown profile position: ${position}`);
if (boundary !== 'setter' && boundary !== 'preparation' && boundary !== 'publication') {
  throw new Error(`Unknown profile boundary: ${boundary}`);
}
if (profileCase !== 'bulk-write' && (rawBulkReads !== undefined || rawBulkPublicationPath !== undefined)) {
  throw new Error('Bulk-write read and publication options only apply to that case');
}
if (profileCase === 'bulk-write' && bulkReads !== 'none' && bulkReads !== 'measure') {
  throw new Error(`Unknown bulk-write read mode: ${bulkReads}`);
}
if (profileCase === 'bulk-write' && bulkPublicationPath !== 'engine' && bulkPublicationPath !== 'scene') {
  throw new Error(`Unknown bulk-write publication path: ${bulkPublicationPath}`);
}
if (
  boundary === 'setter' &&
  !['same-length', 'same-value', 'overwrite-before-publication', 'fredoka-edit', 'inter-edit', 'font-size'].includes(
    profileCase,
  )
) {
  throw new Error(
    'The setter boundary supports same-length, same-value, overwrite-before-publication, fredoka-edit, inter-edit, or font-size',
  );
}
if (profileCase === 'font-size' && (count !== 1 || boundary === 'preparation')) {
  throw new RangeError('The font-size case requires one label and the setter or publication boundary');
}
if (['fredoka-edit', 'inter-edit'].includes(profileCase) && count !== 1) {
  throw new RangeError('The typing edit case requires one label');
}
if (boundary === 'preparation' && profileCase === 'interleaved-read') {
  throw new Error('The interleaved-read case requires publication');
}
if (profileCase === 'prepared-read' && count !== 100 && count !== 1000) {
  throw new RangeError('The prepared-read case requires 100 or 1000 labels');
}
if (profileCase === 'interleaved-read' && count < 100) {
  throw new RangeError('The interleaved-read case requires at least 100 labels');
}
if (profileCase.startsWith('multi-owner-') && (boundary !== 'publication' || (count !== 100 && count !== 1000))) {
  throw new RangeError('Multi-owner profiling requires publication and 100 or 1000 labels');
}

const texts = ['ticker 000', 'quote! 000'] as const;
const expectedMeasurements =
  profileCase === 'prepared-read'
    ? texts.map((text) => {
        const cold = createLabels(1);
        try {
          cold.labels[0]!.text = text;
          if (boundary === 'publication') glyph.shape();
          return cold.labels[0]!.measure();
        } finally {
          disposeLabels(cold);
        }
      })
    : undefined;
if (expectedMeasurements !== undefined) {
  assert(JSON.stringify(expectedMeasurements[0]) !== JSON.stringify(expectedMeasurements[1]));
}

const widthText = profileCase === 'width-reflow' ? paragraphTextForGlyphs(22_000) : undefined;
const fontSizeText = profileCase === 'font-size' ? paragraphTextForGlyphs(22_000) : undefined;
const typingText =
  profileCase === 'fredoka-edit'
    ? fredokaTextForGlyphs(4_000)
    : profileCase === 'inter-edit'
      ? paragraphTextForGlyphs(4_000)
      : undefined;
const typingFont = profileCase === 'fredoka-edit' ? fredokaFont : font;
const multiOwner = profileCase.startsWith('multi-owner-')
  ? createMultiOwnerPublication(count, profileCase === 'multi-owner-balanced', true)
  : undefined;
const created = (() => {
  if (multiOwner !== undefined) {
    return { ...multiOwner.created, dispose: () => disposeLabels(multiOwner.created) };
  }
  if (typingText !== undefined) {
    const paragraph = createParagraph(typingText, 600, typingFont);
    return { ...paragraph, labels: [paragraph.paragraph], dispose: () => disposeParagraph(paragraph) };
  }
  const publicationText = widthText ?? fontSizeText;
  if (publicationText !== undefined) {
    const paragraph = createPublishedParagraph(publicationText);
    return { ...paragraph, labels: [paragraph.paragraph], dispose: () => disposeParagraph(paragraph) };
  }
  if (profileCase === 'bulk-write') {
    const batch = createTextBatch(count);
    return { ...batch, labels: batch.texts, dispose: () => disposeTextBatch(batch) };
  }
  const labels = createLabels(count);
  return { ...labels, dispose: () => disposeLabels(labels) };
})();
const initialDrawTopology = 'scene' in created ? inspectDraws(created.scene) : undefined;
const edited = profileCase === 'prepared-read' ? created.labels.filter((_, index) => index % (count / 100) === 0) : [];
const untouched =
  profileCase === 'prepared-read' ? created.labels.filter((_, index) => index % (count / 100) !== 0) : [];
const untouchedMeasurements = untouched.map((label) => JSON.stringify(label.measure()));
const targetIndex = position === 'first' ? 0 : count - 1;
const target = created.labels[targetIndex]!;
let alternate = false;
const updateOne = () => {
  alternate = !alternate;
  if (profileCase === 'same-value') target.set({ text: target.text });
  else if (profileCase === 'overwrite-before-publication') {
    target.text = alternate ? '123,456' : '12,345';
    target.text = alternate ? '54,321' : '65,432';
  } else if (profileCase === 'same-length') target.text = alternate ? '12,345' : '54,321';
  else if (profileCase === 'length-changing') target.text = alternate ? '123,456' : '12,345';
  else if (typingText !== undefined) {
    const middle = typingText.length >> 1;
    target.text = alternate ? `${typingText.slice(0, middle)}x${typingText.slice(middle)}` : typingText;
  } else target.style = { color: alternate ? '#f97316' : '#38bdf8', fontSize: 16 };
  if (boundary === 'setter') return;
  const glyphCount = target.measure().glyphCount;
  if (boundary === 'publication') {
    glyph.shape();
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
  }
  return glyphCount;
};
const updateInterleaved = () => {
  alternate = !alternate;
  for (let index = 0; index < 100; index++) {
    const label = created.labels[index]!;
    label.text = alternate ? `ticker ${String(index).padStart(3, '0')}` : `quote! ${String(index).padStart(3, '0')}`;
    glyph.shape();
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
    if (label.measureGlyphs() === undefined) throw new Error('interleaved read did not observe committed glyphs');
  }
};
const updatePrepared = () => {
  alternate = !alternate;
  let glyphCount = 0;
  for (const label of edited) {
    label.text = texts[alternate ? 0 : 1];
    if (boundary === 'publication') glyph.shape();
    glyphCount += label.measure().glyphCount;
  }
  return glyphCount;
};
const updateBulk = () => {
  alternate = !alternate;
  const prefix = alternate ? 'bravo' : 'alpha';
  let glyphCount = 0;
  for (const [index, label] of created.labels.entries()) {
    label.text = `${prefix} ${String(index).padStart(4, '0')}`;
    if (bulkReads === 'measure') glyphCount += label.measure().glyphCount;
  }
  if (boundary === 'publication') {
    if (bulkPublicationPath === 'scene') created.scene.updateMatrixWorld(true);
    else glyph.shape();
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
  }
  return glyphCount;
};
let widthIteration = 0;
const updateWidth = () => {
  widthIteration += 1;
  target.constraints = { width: { mode: 'exact', size: 420 + widthIteration / 64 } };
  const glyphCount = target.measure().glyphCount;
  if (boundary === 'publication') {
    created.scene.updateMatrixWorld(true);
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
  }
  return glyphCount;
};
let fontSizeIteration = 0;
const updateFontSize = () => {
  fontSizeIteration += 1;
  target.style = { fontSize: 12 + fontSizeIteration / 256 };
  if (boundary === 'setter') return;
  created.scene.updateMatrixWorld(true);
  if (created.textGroup.error !== undefined) throw created.textGroup.error;
  return created.textGroup.textCount;
};
const update =
  multiOwner !== undefined
    ? multiOwner.publish
    : profileCase === 'font-size'
      ? updateFontSize
      : profileCase === 'width-reflow'
        ? updateWidth
        : profileCase === 'bulk-write'
          ? updateBulk
          : profileCase === 'prepared-read'
            ? updatePrepared
            : profileCase === 'interleaved-read'
              ? updateInterleaved
              : updateOne;

for (let index = 0; index < warmups; index++) update();
globalGc()?.();
await setImmediate();

const session = new Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.start');
const elapsedMs: number[] = [];
for (let index = 0; index < iterations; index++) {
  const start = performance.now();
  update();
  elapsedMs.push(performance.now() - start);
}
const cpu = await session.post('Profiler.stop');
session.disconnect();
if (boundary === 'publication') assertCommitted();

if (typingText !== undefined) {
  const cold = createParagraph(target.text, 600, typingFont);
  try {
    deepStrictEqual(
      withoutPublicationOnlyMeasurementFields(target.measure()),
      withoutPublicationOnlyMeasurementFields(cold.paragraph.measure()),
    );
  } finally {
    disposeParagraph(cold);
  }
}

if (widthText !== undefined) {
  const cold = createPublishedParagraph(widthText);
  try {
    cold.paragraph.constraints = { width: { mode: 'exact', size: 420 + widthIteration / 64 } };
    assert(cold.paragraph.measure().glyphCount > 0, 'cold width reflow must contain glyphs');
    if (boundary === 'publication') {
      cold.scene.updateMatrixWorld(true);
      if (cold.textGroup.error !== undefined) throw cold.textGroup.error;
    }
    // Demand the same optional ink metadata in both controls before comparing complete measurements.
    target.glyphs();
    cold.paragraph.glyphs();
    assert(target.measure().glyphCount > 0, 'width reflow must contain glyphs');
    deepStrictEqual(target.measure(), cold.paragraph.measure());
  } finally {
    disposeParagraph(cold);
  }
}
if (fontSizeText !== undefined) {
  assert.equal(fontSizeIteration, warmups + iterations);
  if (boundary === 'publication') assert.equal(created.textGroup.textCount, 1);
  const finalFontSize = 12 + fontSizeIteration / 256;
  const cold = createPublishedParagraph(fontSizeText);
  try {
    cold.paragraph.style = { fontSize: finalFontSize };
    cold.scene.updateMatrixWorld(true);
    if (cold.textGroup.error !== undefined) throw cold.textGroup.error;
    assert.equal(cold.textGroup.textCount, 1);
    // Demand optional ink metadata on both sides before comparing the complete layout and placements.
    const actualGlyphs = target.glyphs();
    const coldGlyphs = cold.paragraph.glyphs();
    assert(target.measure().glyphCount > 0, 'font-size profile must contain glyphs');
    deepStrictEqual(target.measure(), cold.paragraph.measure());
    deepStrictEqual(withoutGlyphIdentities(actualGlyphs), withoutGlyphIdentities(coldGlyphs));
  } finally {
    disposeParagraph(cold);
  }
}
if (expectedMeasurements !== undefined) {
  assert.equal(edited.length, 100);
  for (const label of edited) deepStrictEqual(label.measure(), expectedMeasurements[alternate ? 0 : 1]);
  deepStrictEqual(
    untouched.map((label) => JSON.stringify(label.measure())),
    untouchedMeasurements,
  );
}
if (
  ['same-length', 'same-value', 'overwrite-before-publication', 'length-changing', 'color-only'].includes(profileCase)
) {
  const cold = createLabels(1);
  try {
    cold.labels[0]!.text = target.text;
    cold.labels[0]!.style = target.style;
    // Reproduce the timed set+read+publication sequence for older packages whose read does not
    // prepare drawable glyphs. This control is outside the timed profile loop.
    cold.labels[0]!.measure();
    if (boundary === 'publication') glyph.shape();
    // The 0.1.0 baseline does not populate per-line glyphCount or inkBounds on this path. Compare
    // the shared layout contract; candidate-specific query coverage checks those fields separately.
    deepStrictEqual(
      withoutPublicationOnlyMeasurementFields(target.measure()),
      withoutPublicationOnlyMeasurementFields(cold.labels[0]!.measure()),
    );
  } finally {
    disposeLabels(cold);
  }
}
if (profileCase === 'bulk-write') {
  const prefix = alternate ? 'bravo' : 'alpha';
  for (const [index, label] of created.labels.entries()) {
    assert.equal(label.text, `${prefix} ${String(index).padStart(4, '0')}`);
    assert(label.measure().glyphCount > 0);
    if (boundary === 'publication') {
      assert.equal(label.commitState().status, 'committed');
      assert(label.measureGlyphs() !== undefined);
    }
  }
}
if (multiOwner !== undefined) {
  for (const label of multiOwner.edited) {
    const cold = createLabels(1);
    try {
      cold.labels[0]!.text = label.text;
      glyph.shape();
      if (cold.textGroup.error !== undefined) throw cold.textGroup.error;
      deepStrictEqual(label.measure(), cold.labels[0]!.measure());
    } finally {
      disposeLabels(cold);
    }
  }
}
const finalDrawTopology = 'scene' in created ? inspectDraws(created.scene) : undefined;
created.dispose();
const directory = resolve(output);
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'cpu-profile.json'), `${JSON.stringify(cpu.profile)}\n`);
const summary = {
  workload: {
    boundary,
    count,
    iterations,
    position,
    profileCase,
    warmups,
    ...(fontSizeText === undefined
      ? {}
      : {
          input: { paragraphGlyphTarget: 22_000, textLength: fontSizeText.length },
          finalFontSize: 12 + fontSizeIteration / 256,
          callbacks: { warmup: warmups, timed: iterations, total: fontSizeIteration },
        }),
    ...(profileCase === 'bulk-write' ? { reads: bulkReads, publicationPath: bulkPublicationPath } : {}),
  },
  operations: {
    perIteration: operationCountsPerIteration(profileCase, boundary, count, bulkReads),
    timed: scaleOperationCounts(operationCountsPerIteration(profileCase, boundary, count, bulkReads), iterations),
    warmup: scaleOperationCounts(operationCountsPerIteration(profileCase, boundary, count, bulkReads), warmups),
    postTimedCorrectness:
      profileCase === 'bulk-write'
        ? {
            measurementReads: count,
            commitStateReads: boundary === 'publication' ? count + 1 : 0,
            glyphReads: boundary === 'publication' ? count + 1 : 0,
          }
        : profileCase === 'font-size'
          ? {
              measurementReads: 3,
              glyphInspectionReads: 2,
              commitStateReads: boundary === 'publication' ? 1 : 0,
              rendererGlyphReads: boundary === 'publication' ? 1 : 0,
              coldFinalPublications: 1,
            }
          : undefined,
  },
  drawTopology: { initial: initialDrawTopology, final: finalDrawTopology },
  elapsedMs: {
    ...distribution(elapsedMs),
    ...(fontSizeText === undefined ? {} : { iterations: elapsedMs }),
  },
  sampledMs: {
    total: sampleTotal(cpu.profile) / 1_000,
    stages: stageTotals(cpu.profile),
  },
  cpuHotspots: hotspots(cpu.profile),
};
await writeFile(resolve(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

function operationCountsPerIteration(
  selectedCase: string,
  selectedBoundary: string,
  labelCount: number,
  selectedBulkReads: string,
): { readonly sets: number; readonly reads: number; readonly publications: number } {
  if (selectedCase.startsWith('multi-owner-')) return { sets: 3, reads: 0, publications: 1 };
  if (selectedCase === 'font-size') {
    return { sets: 1, reads: 0, publications: Number(selectedBoundary === 'publication') };
  }
  if (selectedBoundary === 'setter') {
    if (selectedCase === 'same-value') return { sets: 1, reads: 0, publications: 0 };
    if (selectedCase === 'overwrite-before-publication') return { sets: 2, reads: 0, publications: 0 };
    return { sets: 1, reads: 0, publications: 0 };
  }
  const publications = selectedBoundary === 'publication';
  if (selectedCase === 'same-value') return { sets: 1, reads: 1, publications: Number(publications) };
  if (selectedCase === 'overwrite-before-publication') {
    return { sets: 2, reads: 1, publications: Number(publications) };
  }
  if (selectedCase === 'interleaved-read') {
    return { sets: 100, reads: 100, publications: 100 };
  }
  if (selectedCase === 'prepared-read') {
    return { sets: 100, reads: 100, publications: publications ? 100 : 0 };
  }
  if (selectedCase === 'bulk-write') {
    return {
      sets: labelCount,
      reads: selectedBulkReads === 'measure' ? labelCount : 0,
      publications: Number(publications),
    };
  }
  return { sets: 1, reads: 1, publications: Number(publications) };
}

function scaleOperationCounts(
  counts: { readonly sets: number; readonly reads: number; readonly publications: number },
  repetitions: number,
) {
  return {
    sets: counts.sets * repetitions,
    reads: counts.reads * repetitions,
    publications: counts.publications * repetitions,
  };
}

function assertCommitted(): void {
  const state = target.commitState();
  if (state.status !== 'committed') throw new Error(`profile target did not commit: ${JSON.stringify(state)}`);
  if (target.measureGlyphs() === undefined) throw new Error('profile target has no committed glyph output');
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new RangeError(`${label} must be a positive integer`);
  return parsed;
}

function globalGc(): (() => void) | undefined {
  return (globalThis as typeof globalThis & { gc?: () => void }).gc;
}

function withoutPublicationOnlyMeasurementFields<
  T extends {
    readonly inkBounds: unknown;
    readonly lines: readonly { readonly glyphCount: number; readonly inkBounds: unknown }[];
  },
>(measurement: T) {
  const { inkBounds: _inkBounds, ...sharedMeasurement } = measurement;
  return {
    ...sharedMeasurement,
    lines: measurement.lines.map(({ glyphCount: _glyphCount, inkBounds: _lineInkBounds, ...line }) => line),
  };
}

function withoutGlyphIdentities<
  T extends { readonly fontHandles: unknown; readonly glyphStableIds: unknown; readonly outlineAt: unknown },
>(glyphs: T) {
  // A cold mount has its own font handle and stable glyph IDs; positioned columns must still match.
  const { fontHandles: _fontHandles, glyphStableIds: _glyphStableIds, outlineAt: _outlineAt, ...placements } = glyphs;
  return placements;
}

function distribution(values: readonly number[]) {
  const sorted = values.toSorted((left, right) => left - right);
  return {
    mean: sum(values) / values.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]!;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sampleTotal(profile: Profiler.Profile): number {
  return sum(profile.timeDeltas ?? []);
}

function stageTotals(profile: Profiler.Profile): Record<string, number> {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const totals: Record<string, number> = {};
  for (const [index, nodeId] of (profile.samples ?? []).entries()) {
    const frame = nodes.get(nodeId);
    const stage = classifyCpuProfileStage(frame?.functionName ?? '', frame?.url ?? '');
    totals[stage] = (totals[stage] ?? 0) + (profile.timeDeltas[index] ?? 0) / 1_000;
  }
  return Object.fromEntries(Object.entries(totals).sort((left, right) => right[1] - left[1]));
}

function hotspots(profile: Profiler.Profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const totals = new Map<string, { functionName: string; sampledMs: number; url: string }>();
  for (const [index, nodeId] of (profile.samples ?? []).entries()) {
    const frame = nodes.get(nodeId);
    if (frame === undefined) continue;
    const key = `${frame.functionName}\u0000${frame.url}`;
    const current = totals.get(key);
    totals.set(key, {
      functionName: frame.functionName,
      sampledMs: (current?.sampledMs ?? 0) + (profile.timeDeltas[index] ?? 0) / 1_000,
      url: frame.url,
    });
  }
  return [...totals.values()].sort((left, right) => right.sampledMs - left.sampledMs).slice(0, 30);
}
