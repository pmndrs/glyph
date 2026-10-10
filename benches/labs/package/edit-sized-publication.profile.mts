import { Session } from 'node:inspector/promises';
import assert, { deepStrictEqual } from 'node:assert/strict';
import type { Profiler } from 'node:inspector';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { createLabels, disposeLabels, glyph } from './fixture.ts';

const output = requiredEnvironment('GLYPH_EDIT_PROFILE_OUTPUT');
const profileCase = requiredEnvironment('GLYPH_EDIT_PROFILE_CASE');
const boundary = process.env.GLYPH_EDIT_PROFILE_BOUNDARY ?? 'publication';
const count = positiveInteger(requiredEnvironment('GLYPH_EDIT_PROFILE_COUNT'), 'count');
const iterations = positiveInteger(requiredEnvironment('GLYPH_EDIT_PROFILE_ITERATIONS'), 'iterations');
const warmups = positiveInteger(requiredEnvironment('GLYPH_EDIT_PROFILE_WARMUPS'), 'warmups');
const position = requiredEnvironment('GLYPH_EDIT_PROFILE_POSITION');
if (
  !['same-length', 'length-changing', 'color-only', 'interleaved-read', 'prepared-read', 'bulk-write'].includes(
    profileCase,
  )
) {
  throw new Error(`Unknown profile case: ${profileCase}`);
}
if (position !== 'first' && position !== 'last') throw new Error(`Unknown profile position: ${position}`);
if (boundary !== 'preparation' && boundary !== 'publication') throw new Error(`Unknown profile boundary: ${boundary}`);
if (boundary === 'preparation' && profileCase === 'interleaved-read') {
  throw new Error('The interleaved-read case requires publication');
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

const created = createLabels(count);
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
    glyphCount += label.measure().glyphCount;
  }
  if (boundary === 'publication') {
    glyph.shape();
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
  }
  return glyphCount;
};
const update =
  profileCase === 'bulk-write'
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

if (expectedMeasurements !== undefined) {
  assert.equal(edited.length, 100);
  for (const label of edited) deepStrictEqual(label.measure(), expectedMeasurements[alternate ? 0 : 1]);
  deepStrictEqual(
    untouched.map((label) => JSON.stringify(label.measure())),
    untouchedMeasurements,
  );
}
if (boundary === 'publication') assertCommitted();
if (['same-length', 'length-changing', 'color-only'].includes(profileCase)) {
  const cold = createLabels(1);
  try {
    cold.labels[0]!.text = target.text;
    cold.labels[0]!.style = target.style;
    deepStrictEqual(target.measure(), cold.labels[0]!.measure());
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
disposeLabels(created);
const directory = resolve(output);
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'cpu-profile.json'), `${JSON.stringify(cpu.profile)}\n`);
const summary = {
  workload: { boundary, count, iterations, position, profileCase, warmups },
  elapsedMs: distribution(elapsedMs),
  sampledMs: {
    total: sampleTotal(cpu.profile) / 1_000,
    stages: stageTotals(cpu.profile),
  },
  cpuHotspots: hotspots(cpu.profile),
};
await writeFile(resolve(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

function assertCommitted(): void {
  if (target.commitState().status !== 'committed') throw new Error('profile target did not commit');
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
