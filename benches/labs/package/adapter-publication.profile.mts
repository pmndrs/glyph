import { Session } from 'node:inspector/promises';
import type { HeapProfiler, Profiler } from 'node:inspector';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { createTrailingSpanPublicationWorkload } from './adapter-publication-workload.ts';

interface Hotspot {
  readonly functionName: string;
  readonly total: number;
  readonly url: string;
}

interface GarbageCollectionEntry {
  readonly duration: number;
  readonly detail?: Readonly<{ kind?: number }>;
}

const output = process.env.GLYPH_PUBLICATION_PROFILE_OUTPUT;
if (output === undefined) throw new Error('GLYPH_PUBLICATION_PROFILE_OUTPUT is required');
const iterations = positiveInteger(process.env.GLYPH_PUBLICATION_PROFILE_ITERATIONS, 'iterations');
const warmups = positiveInteger(process.env.GLYPH_PUBLICATION_PROFILE_WARMUPS, 'warmups');
const workload = createTrailingSpanPublicationWorkload();

for (let index = 0; index < warmups; index += 1) workload.update();
const expected = workload.inspect();
globalGc()?.();
await setImmediate();

const gcEntries: GarbageCollectionEntry[] = [];
const observer = new PerformanceObserver((entries) => {
  for (const entry of entries.getEntries()) gcEntries.push(entry as GarbageCollectionEntry);
});
observer.observe({ entryTypes: ['gc'] });

const session = new Session();
session.connect();
await session.post('Profiler.enable');
await session.post('HeapProfiler.enable');
await session.post('HeapProfiler.startSampling', {
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
  samplingInterval: 16_384,
});
await session.post('Profiler.start');

const before = process.memoryUsage();
const setAndStageMs: number[] = [];
const commitMs: number[] = [];
for (let index = 0; index < iterations; index += 1) {
  const setStart = performance.now();
  workload.setNext();
  const commitStart = performance.now();
  workload.commit();
  const end = performance.now();
  setAndStageMs.push(commitStart - setStart);
  commitMs.push(end - commitStart);
}
const after = process.memoryUsage();

const cpu = await session.post('Profiler.stop');
const heap = await session.post('HeapProfiler.stopSampling');
session.disconnect();
for (const entry of observer.takeRecords()) gcEntries.push(entry as GarbageCollectionEntry);
observer.disconnect();

const actual = workload.inspect();
if (
  actual.textCount !== expected.textCount ||
  actual.checksum !== expected.checksum ||
  actual.draws.draws !== expected.draws.draws ||
  actual.draws.glyphs !== expected.draws.glyphs ||
  !expected.paintMatchesSelected ||
  !actual.paintMatchesSelected
) {
  throw new Error(`profiled trailing-span publication changed output: ${JSON.stringify({ expected, actual })}`);
}
workload.dispose();

const directory = resolve(output);
await mkdir(directory, { recursive: true });
await Promise.all([
  writeFile(resolve(directory, 'cpu-profile.json'), `${JSON.stringify(cpu.profile)}\n`),
  writeFile(resolve(directory, 'heap-sampling-profile.json'), `${JSON.stringify(heap.profile)}\n`),
]);
const summary = {
  workload: {
    labels: 1_000,
    spansPerLabel: 8,
    iterations,
    warmups,
  },
  correctness: actual,
  phaseMs: {
    setAndStage: distribution(setAndStageMs),
    commit: distribution(commitMs),
    total: distribution(setAndStageMs.map((value, index) => value + commitMs[index]!)),
  },
  garbageCollection: {
    count: gcEntries.length,
    totalMs: sum(gcEntries.map((entry) => entry.duration)),
    maxMs: Math.max(0, ...gcEntries.map((entry) => entry.duration)),
    byKind: summarizeGarbageCollection(gcEntries),
  },
  memoryDeltaBytes: {
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
    external: after.external - before.external,
    heapUsed: after.heapUsed - before.heapUsed,
    rss: after.rss - before.rss,
  },
  cpuProfile: {
    garbageCollectorSampledMs: sampledCpuTime(cpu.profile, (name) => name === '(garbage collector)') / 1_000,
    totalSampledMs: sum(cpu.profile.timeDeltas ?? []) / 1_000,
  },
  heapSampling: {
    totalBytes: sampledHeapBytes(heap.profile),
    weakMapBytes: sampledHeapBytes(heap.profile, (name) => name === 'WeakMap'),
  },
  cpuHotspots: summarizeCpuProfile(cpu.profile),
  heapHotspots: summarizeHeapProfile(heap.profile),
};
await writeFile(resolve(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

function positiveInteger(value: string | undefined, label: string): number {
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

function summarizeGarbageCollection(entries: readonly GarbageCollectionEntry[]) {
  const kinds: Record<string, { count: number; totalMs: number }> = {};
  for (const entry of entries) {
    const key = String(entry.detail?.kind ?? 'unknown');
    const current = kinds[key] ?? { count: 0, totalMs: 0 };
    current.count += 1;
    current.totalMs += entry.duration;
    kinds[key] = current;
  }
  return kinds;
}

function sampledCpuTime(profile: Profiler.Profile, matches: (functionName: string) => boolean): number {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  let total = 0;
  for (const [index, nodeId] of (profile.samples ?? []).entries()) {
    if (matches(nodes.get(nodeId)?.functionName ?? '')) total += profile.timeDeltas[index] ?? 0;
  }
  return total;
}

function sampledHeapBytes(
  profile: HeapProfiler.SamplingHeapProfile,
  matches: (functionName: string) => boolean = () => true,
): number {
  let total = 0;
  const visit = (node: HeapProfiler.SamplingHeapProfileNode): void => {
    if (matches(node.callFrame.functionName)) total += node.selfSize;
    for (const child of node.children) visit(child);
  };
  visit(profile.head);
  return total;
}

function summarizeCpuProfile(profile: Profiler.Profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const totals = new Map<string, Hotspot>();
  for (const [index, nodeId] of (profile.samples ?? []).entries()) {
    const callFrame = nodes.get(nodeId);
    if (callFrame === undefined) continue;
    const key = `${callFrame.functionName}\u0000${callFrame.url}`;
    const current = totals.get(key);
    totals.set(key, {
      functionName: callFrame.functionName,
      total: (current?.total ?? 0) + (profile.timeDeltas[index] ?? 0),
      url: callFrame.url,
    });
  }
  return [...totals.values()].sort((left, right) => right.total - left.total).slice(0, 30);
}

function summarizeHeapProfile(profile: HeapProfiler.SamplingHeapProfile) {
  const totals = new Map<string, Hotspot>();
  const visit = (node: typeof profile.head): void => {
    const key = `${node.callFrame.functionName}\u0000${node.callFrame.url}`;
    const current = totals.get(key);
    totals.set(key, {
      functionName: node.callFrame.functionName,
      total: (current?.total ?? 0) + node.selfSize,
      url: node.callFrame.url,
    });
    for (const child of node.children) visit(child);
  };
  visit(profile.head);
  return [...totals.values()].sort((left, right) => right.total - left.total).slice(0, 30);
}
