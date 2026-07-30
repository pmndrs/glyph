import { readFile } from 'node:fs/promises';

interface CpuProfileNode {
  readonly id: number;
  readonly children?: readonly number[];
  readonly callFrame: {
    readonly functionName: string;
    readonly url: string;
    readonly lineNumber: number;
  };
}

interface CpuProfile {
  readonly nodes: readonly CpuProfileNode[];
  readonly samples: readonly number[];
}

const path = process.argv[2];
if (path === undefined) throw new TypeError('CPU profile summary requires a profile path');
const value: unknown = JSON.parse(await readFile(path, 'utf8'));
if (typeof value !== 'object' || value === null || !('nodes' in value) || !('samples' in value)) {
  throw new TypeError('CPU profile must contain nodes and samples');
}
const profile = value as CpuProfile;
if (!Array.isArray(profile.nodes) || !Array.isArray(profile.samples)) {
  throw new TypeError('CPU profile nodes and samples must be arrays');
}
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const counts = new Map<number, number>();
const parents = new Map<number, number>();
for (const node of profile.nodes) {
  for (const child of node.children ?? []) parents.set(child, node.id);
}
for (const sample of profile.samples) counts.set(sample, (counts.get(sample) ?? 0) + 1);
const total = profile.samples.length;
const inclusive = new Map<number, number>();
for (const [sample, count] of counts) {
  let current: number | undefined = sample;
  while (current !== undefined) {
    inclusive.set(current, (inclusive.get(current) ?? 0) + count);
    current = parents.get(current);
  }
}
for (const [id, count] of [...inclusive].sort((left, right) => right[1] - left[1]).slice(0, 40)) {
  const node = nodes.get(id);
  if (node === undefined) continue;
  const percent = total === 0 ? 0 : (count / total) * 100;
  console.log(
    `${percent.toFixed(1).padStart(5)}%  ${String(count).padStart(5)}  ${node.callFrame.functionName || '(anonymous)'}  ${node.callFrame.url}:${node.callFrame.lineNumber + 1}`,
  );
}
