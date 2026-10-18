import { Session } from 'node:inspector/promises';
import assert, { deepStrictEqual } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Profiler } from 'node:inspector';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import {
  createLabels,
  createParagraph,
  disposeLabels,
  disposeParagraph,
  glyph,
  paragraphTextForGlyphs,
  createPublishedParagraph,
} from './fixture.ts';

const output = requiredEnvironment('GLYPH_EDIT_PROFILE_OUTPUT');
const profileCase = requiredEnvironment('GLYPH_EDIT_PROFILE_CASE');
const boundary = process.env.GLYPH_EDIT_PROFILE_BOUNDARY ?? 'publication';
const count = positiveInteger(requiredEnvironment('GLYPH_EDIT_PROFILE_COUNT'), 'count');
const iterations = positiveInteger(requiredEnvironment('GLYPH_EDIT_PROFILE_ITERATIONS'), 'iterations');
const warmups = positiveInteger(requiredEnvironment('GLYPH_EDIT_PROFILE_WARMUPS'), 'warmups');
const position = requiredEnvironment('GLYPH_EDIT_PROFILE_POSITION');
if (
  ![
    'same-length',
    'length-changing',
    'color-only',
    'interleaved-read',
    'prepared-read',
    'width-reflow',
    'width-inspection',
  ].includes(profileCase)
) {
  throw new Error(`Unknown profile case: ${profileCase}`);
}
if (position !== 'first' && position !== 'last') throw new Error(`Unknown profile position: ${position}`);
if (boundary !== 'preparation' && boundary !== 'publication') throw new Error(`Unknown profile boundary: ${boundary}`);
if (
  boundary === 'preparation' &&
  profileCase !== 'prepared-read' &&
  profileCase !== 'width-reflow' &&
  profileCase !== 'width-inspection'
) {
  throw new Error('The preparation boundary requires the prepared-read, width-reflow, or width-inspection case');
}
const widthCase = profileCase === 'width-reflow' || profileCase === 'width-inspection';
const sampleBindings = profileCase === 'width-inspection' ? await installedInspectionBindings() : undefined;
if (widthCase && count !== 1) {
  throw new RangeError('The width-reflow and width-inspection cases require one paragraph');
}
if (profileCase === 'prepared-read' && count !== 100 && count !== 1000) {
  throw new RangeError('The prepared-read case requires 100 or 1000 labels');
}
if (profileCase === 'interleaved-read' && count < 100) {
  throw new RangeError('The interleaved-read case requires at least 100 labels');
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

const widthText = widthCase ? paragraphTextForGlyphs(22_000) : undefined;
const created = (() => {
  if (widthText !== undefined) {
    const paragraph =
      profileCase === 'width-inspection' && boundary === 'preparation'
        ? createParagraph(widthText)
        : createPublishedParagraph(widthText);
    return { ...paragraph, labels: [paragraph.paragraph], dispose: () => disposeParagraph(paragraph) };
  }
  const labels = createLabels(count);
  return { ...labels, dispose: () => disposeLabels(labels) };
})();
const edited = profileCase === 'prepared-read' ? created.labels.filter((_, index) => index % (count / 100) === 0) : [];
const untouched =
  profileCase === 'prepared-read' ? created.labels.filter((_, index) => index % (count / 100) !== 0) : [];
const untouchedMeasurements = untouched.map((label) => JSON.stringify(label.measure()));
const targetIndex = position === 'first' ? 0 : count - 1;
const target = created.labels[targetIndex]!;
let alternate = false;
const updateOne = () => {
  alternate = !alternate;
  if (profileCase === 'same-length') target.text = alternate ? '12,345' : '54,321';
  else if (profileCase === 'length-changing') target.text = alternate ? '123,456' : '12,345';
  else target.style = { color: alternate ? '#f97316' : '#38bdf8', fontSize: 16 };
  glyph.shape();
  if (created.textGroup.error !== undefined) throw created.textGroup.error;
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
let widthIteration = 0;
const updateWidth = () => {
  widthIteration += 1;
  target.constraints = { width: { mode: 'exact', size: 420 + widthIteration / 64 } };
  const glyphCount = profileCase === 'width-inspection' ? target.glyphs().glyphCount : target.measure().glyphCount;
  if (boundary === 'publication') {
    if (!('scene' in created)) throw new Error('publication width profile requires a mounted scene');
    created.scene.updateMatrixWorld(true);
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
  }
  return glyphCount;
};
const update = widthCase
  ? updateWidth
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
const directory = resolve(output);
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'cpu-profile.json'), `${JSON.stringify(cpu.profile)}\n`);
if (boundary === 'publication') assertCommitted();

const inspectionColumns = [
  'glyphIds',
  'clusters',
  'glyphBidiLevels',
  'glyphFontSizes',
  'x',
  'y',
  'glyphAdvances',
  'glyphInkX',
  'glyphInkY',
  'glyphInkWidths',
  'glyphInkHeights',
  'glyphFlags',
  'lineTextStarts',
  'lineTextEnds',
  'lineGlyphStarts',
  'lineGlyphCounts',
  'lineBaselines',
  'lineAdvances',
] as const;
const inspectionOracles: {
  readonly width: number;
  readonly glyphCount: number;
  readonly lineCount: number;
  readonly stableIdsSha256: string;
}[] = [];
if (profileCase === 'width-inspection' && widthText !== undefined) {
  try {
    for (const width of [420, 420.5, 420 + widthIteration / 64]) {
      const cold = boundary === 'preparation' ? createParagraph(widthText) : createPublishedParagraph(widthText);
      try {
        target.constraints = { width: { mode: 'exact', size: width } };
        cold.paragraph.constraints = { width: { mode: 'exact', size: width } };
        const inspected = target.glyphs();
        const repeated = target.glyphs();
        assert.equal(repeated.glyphCount, inspected.glyphCount);
        assert.equal(repeated.lineCount, inspected.lineCount);
        deepStrictEqual(repeated.glyphStableIds, inspected.glyphStableIds, 'a repeated query retains glyph identities');
        deepStrictEqual(repeated.fontHandles, inspected.fontHandles);
        deepStrictEqual(repeated.glyphFontSlots, inspected.glyphFontSlots);
        for (const field of inspectionColumns) {
          deepStrictEqual(repeated[field], inspected[field], `repeated width ${width} inspection ${field}`);
        }
        const fresh = cold.paragraph.glyphs();
        assert.equal(inspected.glyphCount, fresh.glyphCount);
        assert.equal(inspected.lineCount, fresh.lineCount);
        for (const field of inspectionColumns) {
          deepStrictEqual(inspected[field], fresh[field], `cold width ${width} inspection ${field}`);
        }
        deepStrictEqual(target.measure(), cold.paragraph.measure(), `cold width ${width} measurement`);
        inspectionOracles.push({
          width,
          glyphCount: inspected.glyphCount,
          lineCount: inspected.lineCount,
          stableIdsSha256: createHash('sha256')
            .update(
              new Uint8Array(
                inspected.glyphStableIds.buffer,
                inspected.glyphStableIds.byteOffset,
                inspected.glyphStableIds.byteLength,
              ),
            )
            .digest('hex'),
        });
      } finally {
        disposeParagraph(cold);
      }
    }
  } catch (error) {
    await writeFile(
      resolve(directory, 'validation.json'),
      `${JSON.stringify({ status: 'failed', error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
    );
    throw error;
  }
  await writeFile(resolve(directory, 'validation.json'), '{"status":"passed"}\n');
}
if (profileCase === 'width-reflow' && widthText !== undefined) {
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
if (expectedMeasurements !== undefined) {
  assert.equal(edited.length, 100);
  for (const label of edited) deepStrictEqual(label.measure(), expectedMeasurements[alternate ? 0 : 1]);
  deepStrictEqual(
    untouched.map((label) => JSON.stringify(label.measure())),
    untouchedMeasurements,
  );
}
created.dispose();
const exclusiveAncestry =
  sampleBindings === undefined ? undefined : exclusiveInspectionAncestry(cpu.profile, sampleBindings);
const sampledTotalMs = sampleTotal(cpu.profile) / 1_000;
const summary = {
  workload: { boundary, count, iterations, position, profileCase, warmups },
  ...(inspectionOracles.length === 0 ? {} : { inspectionOracles }),
  elapsedMs: distribution(elapsedMs),
  sampledMs: {
    total: sampledTotalMs,
    stages: stageTotals(cpu.profile),
    ...(exclusiveAncestry === undefined
      ? {}
      : {
          exclusiveAncestry,
          nonProfilerNonIdle:
            sampledTotalMs - (exclusiveAncestry['profiler-runtime'] ?? 0) - (exclusiveAncestry['idle-runtime'] ?? 0),
        }),
  },
  ...(sampleBindings === undefined ? {} : { sampleBindings }),
  cpuHotspots: hotspots(cpu.profile),
};
await writeFile(resolve(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

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
    const stage = classify(frame?.functionName ?? '', frame?.url ?? '');
    totals[stage] = (totals[stage] ?? 0) + (profile.timeDeltas[index] ?? 0) / 1_000;
  }
  return Object.fromEntries(Object.entries(totals).sort((left, right) => right[1] - left[1]));
}

interface SampleBinding {
  readonly exportName: string;
  readonly functionName: string;
  readonly urls: readonly string[];
}

interface InspectionBindings {
  readonly semanticDecode: readonly SampleBinding[];
  readonly publicColumnCopy: SampleBinding;
}

async function installedInspectionBindings(): Promise<InspectionBindings> {
  const packageRoot = requiredEnvironment('GLYPH_LABS_PACKAGE_ROOT');
  const semanticPath = resolve(packageRoot, 'dist/internal/layout-query-view.js');
  const copyPath = resolve(packageRoot, 'dist/layout.js');
  const [semantic, layout] = await Promise.all([
    import(pathToFileURL(semanticPath).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(copyPath).href) as Promise<Record<string, unknown>>,
  ]);
  const binding = async (
    path: string,
    exports: Record<string, unknown>,
    exportName: string,
  ): Promise<SampleBinding> => {
    const value = exports[exportName];
    if (typeof value !== 'function' || value.name.length === 0) {
      throw new Error(`installed inspection export ${exportName} is unavailable`);
    }
    return {
      exportName,
      functionName: value.name,
      urls: [...new Set([pathToFileURL(path).href, pathToFileURL(await realpath(path)).href])],
    };
  };
  return {
    semanticDecode: await Promise.all([
      binding(semanticPath, semantic, 'readPlannerLayouts'),
      binding(semanticPath, semantic, 'readPlannerMeasurements'),
    ]),
    publicColumnCopy: await binding(copyPath, layout, 'copyGlyphLayoutInspection'),
  };
}

/** Exclusive sampled CPU by the nearest authenticated installed-package ancestor; Wasm remains opaque. */
function exclusiveInspectionAncestry(profile: Profiler.Profile, bindings: InspectionBindings): Record<string, number> {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const totals: Record<string, number> = {};
  for (const [index, nodeId] of (profile.samples ?? []).entries()) {
    let stage = 'other';
    let current: number | undefined = nodeId;
    while (current !== undefined) {
      const frame = nodes.get(current)?.callFrame;
      const name = frame?.functionName ?? '';
      const url = frame?.url ?? '';
      if (name.includes('garbage collector') || name === '(GC)') {
        stage = 'gc-runtime';
        break;
      }
      if (url === 'node:inspector') {
        stage = 'profiler-runtime';
        break;
      }
      if (name === '(idle)') {
        stage = 'idle-runtime';
        break;
      }
      if (name.startsWith('wasm-function') || name.startsWith('_R')) {
        stage = 'native-wasm-opaque';
        break;
      }
      if (matchesSampleBinding(frame, bindings.publicColumnCopy)) {
        stage = 'public-column-copy';
        break;
      }
      if (bindings.semanticDecode.some((binding) => matchesSampleBinding(frame, binding))) {
        stage = 'semantic-decode-columns';
        break;
      }
      if (
        name.includes('measureParagraph') ||
        name.includes('queryTextPublication') ||
        name.includes('queryInspection') ||
        name.includes('decodeResult') ||
        name.includes('preparePlannerFrameUpdate') ||
        name.includes('writePreparedPlannerFrameUpdate')
      ) {
        stage = 'request-transport-named';
        break;
      }
      current = parents.get(current);
    }
    totals[stage] = (totals[stage] ?? 0) + (profile.timeDeltas[index] ?? 0) / 1_000;
  }
  return Object.fromEntries(Object.entries(totals).sort((left, right) => right[1] - left[1]));
}

function matchesSampleBinding(frame: Profiler.ProfileNode['callFrame'] | undefined, binding: SampleBinding): boolean {
  return frame?.functionName === binding.functionName && binding.urls.includes(frame.url);
}

function classify(functionName: string, url: string): string {
  if (functionName.includes('codec_gather') || functionName.includes('append_planner_gather')) return 'gather';
  if (
    functionName.includes('ordered_plan') ||
    functionName.includes('render_plan_compiler') ||
    functionName.includes('plan_packing')
  ) {
    return 'render-plan';
  }
  if (functionName.includes('render_plan_wire') || functionName.includes('transport')) return 'serialization';
  if (functionName.includes('shaping_state') || functionName.includes('harfrust')) return 'shaping';
  if (functionName.includes('alloc') || functionName.includes('talc') || functionName.includes('RawVec')) {
    return 'allocation';
  }
  if (functionName.startsWith('wasm-function') || functionName.startsWith('_R')) return 'other-wasm';
  if (url.length !== 0) return 'javascript';
  return 'runtime';
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
