import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, posix, resolve } from 'node:path';
import { promisify } from 'node:util';

import { GREATEST_LOWER_BOUND, originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';

import {
  authenticateNamedShaper,
  sha256,
  wasmSections,
} from '../../../packages/glyph/scripts/support/named-shaper.mjs';
import { classifyCpuProfileStage, type CpuProfileStage } from '../../src/benchmark/cpu-profile-stage.mts';

const execFileAsync = promisify(execFile);

interface CallFrame {
  readonly functionName: string;
  readonly url: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

interface ProfileNode {
  readonly id: number;
  readonly callFrame: CallFrame;
  readonly children?: readonly number[];
}

interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

export interface Hotspot {
  readonly functionName: string;
  readonly url: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
  readonly selfMicroseconds: number;
  readonly inclusiveMicroseconds: number;
  readonly selfSamples: number;
  readonly originalFile?: string;
  readonly originalLineNumber?: number;
  readonly originalColumnNumber?: number;
}

export interface CpuProfileStageTotal {
  readonly stage: CpuProfileStage;
  readonly microseconds: number;
}

interface NamedFunction {
  readonly functionIndex: number;
  readonly name: string;
}

interface NamedWasmProof {
  readonly file: string;
  readonly sha256: string;
  readonly executableSha256: string;
  readonly functions: readonly NamedFunction[];
}

interface NamedWasmManifest {
  readonly artifact?: { readonly sha256: string };
  readonly namedWasm?: NamedWasmProof;
}

interface OriginalLocation {
  readonly file: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

interface ArtifactSourceMaps {
  readonly artifactSha256: string;
  readonly locations: ReadonlyMap<string, OriginalLocation>;
}

export async function summarizeCpuProfile(
  profilePath: string,
  manifestPath?: string,
  wasmUrl?: string,
  artifactPath?: string,
): Promise<{
  readonly totalMicroseconds: number;
  readonly sampleCount: number;
  readonly stageTotals: readonly CpuProfileStageTotal[];
  readonly hotspots: readonly Hotspot[];
  readonly sourceMapArtifactSha256?: string;
}> {
  if (wasmUrl !== undefined && manifestPath === undefined) {
    throw new Error('--wasm-url requires --manifest');
  }
  const profile = parseProfile(JSON.parse(await readFile(profilePath, 'utf8')));
  const names = manifestPath === undefined ? undefined : await readNamedFunctions(manifestPath, wasmUrl !== undefined);
  const sourceMaps =
    artifactPath === undefined
      ? undefined
      : await readArtifactSourceMaps(
          artifactPath,
          manifestPath,
          profile.nodes.map((node) => node.callFrame),
        );
  const totals = new Map<string, Hotspot>();
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = validateTree(profile.nodes, nodes);
  let totalMicroseconds = 0;
  const stageTotals = new Map<CpuProfileStage, number>();

  for (let index = 0; index < profile.samples.length; index++) {
    const sampleId = profile.samples[index]!;
    const delta = profile.timeDeltas[index]!;
    totalMicroseconds += delta;
    if (!Number.isSafeInteger(totalMicroseconds)) throw new Error('Profile sampled time exceeds safe integer range');
    const sampledNode = nodes.get(sampleId);
    if (sampledNode === undefined) throw new Error(`Sample references unknown profile node ${sampleId}`);
    const sampledFrame = resolveFrame(sampledNode.callFrame, names, wasmUrl);
    const stage = classifyCpuProfileStage(sampledFrame.functionName, sampledFrame.url);
    stageTotals.set(stage, (stageTotals.get(stage) ?? 0) + delta);
    const original = sourceMaps?.locations.get(frameKey(sampledNode.callFrame));
    add(totals, sampledFrame, 'selfMicroseconds', delta, true, original);
    let ancestorId: number | undefined = sampleId;
    const seenOnStack = new Set<string>();
    while (ancestorId !== undefined) {
      const ancestor = nodes.get(ancestorId)!;
      const frame = resolveFrame(ancestor.callFrame, names, wasmUrl);
      const key = frameKey(frame);
      if (!seenOnStack.has(key)) {
        add(
          totals,
          frame,
          'inclusiveMicroseconds',
          delta,
          false,
          sourceMaps?.locations.get(frameKey(ancestor.callFrame)),
        );
        seenOnStack.add(key);
      }
      ancestorId = parents.get(ancestorId);
    }
  }

  return {
    totalMicroseconds,
    sampleCount: profile.samples.length,
    stageTotals: [...stageTotals]
      .map(([stage, microseconds]) => ({ stage, microseconds }))
      .sort((left, right) => right.microseconds - left.microseconds || left.stage.localeCompare(right.stage)),
    hotspots: [...totals.values()].sort(
      (left, right) =>
        right.inclusiveMicroseconds - left.inclusiveMicroseconds ||
        right.selfMicroseconds - left.selfMicroseconds ||
        left.url.localeCompare(right.url) ||
        left.functionName.localeCompare(right.functionName) ||
        left.lineNumber - right.lineNumber ||
        left.columnNumber - right.columnNumber,
    ),
    ...(sourceMaps === undefined ? {} : { sourceMapArtifactSha256: sourceMaps.artifactSha256 }),
  };
}

export function renderCpuProfileSummary(summary: {
  readonly totalMicroseconds: number;
  readonly sampleCount: number;
  readonly stageTotals: readonly CpuProfileStageTotal[];
  readonly hotspots: readonly Hotspot[];
  readonly sourceMapArtifactSha256?: string;
}): string {
  const lines = [
    '# V8 CPU profile summary',
    '',
    `Samples: ${summary.sampleCount}`,
    `Sampled CPU: ${summary.totalMicroseconds} µs`,
    '',
    'Inclusive rows overlap: each sampled stack contributes once to every distinct frame identity on that stack, so totals across frames can exceed sampled CPU.',
    'Sampled CPU is profiler attribution, not timed latency or FPS.',
    'Corrected origin-based stage totals below supersede stage buckets in prior capture summaries; raw profiles and frame rows are unchanged.',
    'Function names and URLs are kept as recorded; unresolved and minified frames stay unresolved.',
    'Raw V8 names, URLs, and coordinates are preserved; mapped source locations are additional artifact-backed fields.',
    ...(summary.sourceMapArtifactSha256 === undefined
      ? []
      : [
          'TypeScript member labels are omitted because the pinned TypeScript package exposes no public standalone parser.',
        ]),
    ...(summary.sourceMapArtifactSha256 === undefined
      ? []
      : [`Source maps verified against artifact SHA-256 ${summary.sourceMapArtifactSha256}.`]),
    '',
    'Exclusive sampled CPU by frame origin; Wasm boundary transitions are kept separate from module work.',
    '| Stage | Self sampled CPU (µs) |',
    '| --- | ---: |',
    ...summary.stageTotals.map(({ stage, microseconds }) => `| ${stage} | ${microseconds} |`),
    '',
    '| Function | URL | Line | Column | Original source | Original line | Original column | Self (µs) | Inclusive (µs) | Self samples |',
    '| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const hotspot of summary.hotspots) {
    lines.push(
      `| ${cell(hotspot.functionName)} | ${cell(hotspot.url)} | ${hotspot.lineNumber} | ${hotspot.columnNumber} | ${cell(hotspot.originalFile ?? '')} | ${hotspot.originalLineNumber ?? ''} | ${hotspot.originalColumnNumber ?? ''} | ${hotspot.selfMicroseconds} | ${hotspot.inclusiveMicroseconds} | ${hotspot.selfSamples} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function parseProfile(value: unknown): CpuProfile {
  if (
    !isObject(value) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.samples) ||
    !Array.isArray(value.timeDeltas)
  ) {
    throw new Error('Profile must contain nodes, samples, and timeDeltas arrays');
  }
  const nodes: ProfileNode[] = value.nodes.map((entry, index) => {
    if (!isObject(entry) || !isSafeIndex(entry.id) || !isObject(entry.callFrame)) {
      throw new Error(`Invalid profile node at index ${index}`);
    }
    const { functionName, url } = entry.callFrame;
    const lineNumber = entry.callFrame.lineNumber === undefined ? -1 : entry.callFrame.lineNumber;
    const columnNumber = entry.callFrame.columnNumber === undefined ? -1 : entry.callFrame.columnNumber;
    if (
      typeof functionName !== 'string' ||
      typeof url !== 'string' ||
      !isFrameLocation(lineNumber) ||
      !isFrameLocation(columnNumber)
    ) {
      throw new Error(`Invalid call frame in profile node ${entry.id}`);
    }
    let children: number[] | undefined;
    if (entry.children !== undefined) {
      if (!Array.isArray(entry.children)) throw new Error(`Invalid children in profile node ${entry.id}`);
      children = entry.children.map((child: unknown) => {
        if (!isSafeIndex(child)) throw new Error(`Invalid children in profile node ${entry.id}`);
        return child;
      });
    }
    return {
      id: entry.id,
      callFrame: { functionName, url, lineNumber, columnNumber },
      ...(children === undefined ? {} : { children }),
    };
  });
  const samples = value.samples.map((sample: unknown) => {
    if (!isSafeIndex(sample)) throw new Error('Profile samples must contain safe integer node ids');
    return sample;
  });
  const timeDeltas = value.timeDeltas.map((delta: unknown) => {
    if (!isSafeIndex(delta)) throw new Error('Profile timeDeltas must contain non-negative safe integers');
    return delta;
  });
  if (samples.length !== timeDeltas.length)
    throw new Error('Profile samples and timeDeltas must have matching lengths');
  return { nodes, samples, timeDeltas };
}

function validateTree(
  nodes: readonly ProfileNode[],
  byId: ReadonlyMap<number, ProfileNode>,
): Map<number, number | undefined> {
  if (byId.size !== nodes.length) throw new Error('Profile contains duplicate node ids');
  const parents = new Map<number, number | undefined>();
  for (const node of nodes) {
    for (const child of node.children ?? []) {
      if (!byId.has(child)) throw new Error(`Node ${node.id} references unknown child ${child}`);
      if (parents.has(child)) throw new Error(`Profile node ${child} has multiple parents`);
      parents.set(child, node.id);
    }
  }
  for (const node of nodes) if (!parents.has(node.id)) parents.set(node.id, undefined);
  const roots = [...parents].filter(([, parent]) => parent === undefined).map(([id]) => id);
  if (roots.length !== 1) throw new Error('Profile must have exactly one root node');
  const visited = new Set<number>();
  const active = new Set<number>();
  const visit = (id: number): void => {
    if (active.has(id)) throw new Error(`Profile contains a cycle at node ${id}`);
    if (visited.has(id)) return;
    active.add(id);
    for (const child of byId.get(id)!.children ?? []) visit(child);
    active.delete(id);
    visited.add(id);
  };
  visit(roots[0]!);
  if (visited.size !== nodes.length) throw new Error('Profile contains nodes detached from its root');
  return parents;
}

async function readNamedFunctions(
  manifestPath: string,
  required: boolean,
): Promise<ReadonlyMap<number, string> | undefined> {
  const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')), manifestPath);
  if (manifest.namedWasm === undefined) {
    if (required) throw new Error('Manifest has no namedWasm proof');
    return undefined;
  }
  const proof = manifest.namedWasm;
  const candidate = await readFile(resolve(process.cwd(), proof.file));
  if (sha256(candidate) !== proof.sha256) throw new Error('namedWasm file SHA-256 does not match manifest');
  const header = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const stripped = Buffer.concat([
    header,
    ...wasmSections(candidate)
      .filter((section) => section.id !== 0)
      .map((section) => section.bytes),
  ]);
  const authenticated = authenticateNamedShaper(stripped, candidate);
  if (authenticated.executableSha256 !== proof.executableSha256) {
    throw new Error('namedWasm executable SHA-256 does not match manifest');
  }
  if (!sameFunctions(authenticated.functions, proof.functions)) {
    throw new Error('namedWasm function map does not match manifest');
  }
  return new Map(authenticated.functions.map(({ functionIndex, name }) => [functionIndex, name]));
}

function parseManifest(value: unknown, manifestPath: string): NamedWasmManifest {
  if (!isObject(value)) throw new Error('Manifest must be an object');
  let artifact: NamedWasmManifest['artifact'];
  if (value.artifact !== undefined) {
    if (
      !isObject(value.artifact) ||
      typeof value.artifact.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.artifact.sha256)
    ) {
      throw new Error('Manifest artifact proof is malformed');
    }
    artifact = { sha256: value.artifact.sha256 };
  }
  const namedWasm =
    value.namedWasm === undefined && value.namedSha256 !== undefined
      ? {
          file: resolve(dirname(manifestPath), 'text-shaper.named.wasm'),
          sha256: value.namedSha256,
          executableSha256: value.executableSha256,
          functions: value.functions,
        }
      : value.namedWasm;
  if (namedWasm === undefined) return artifact === undefined ? {} : { artifact };
  if (
    !isObject(namedWasm) ||
    typeof namedWasm.file !== 'string' ||
    typeof namedWasm.sha256 !== 'string' ||
    typeof namedWasm.executableSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(namedWasm.sha256) ||
    !/^[0-9a-f]{64}$/.test(namedWasm.executableSha256) ||
    !Array.isArray(namedWasm.functions)
  ) {
    throw new Error('Manifest namedWasm proof is malformed');
  }
  const functions = namedWasm.functions.map((entry, index) => {
    if (
      !isObject(entry) ||
      !isSafeIndex(entry.functionIndex) ||
      typeof entry.name !== 'string' ||
      entry.name.length === 0
    ) {
      throw new Error(`Manifest namedWasm function is malformed at index ${index}`);
    }
    return { functionIndex: entry.functionIndex, name: entry.name };
  });
  return {
    ...(artifact === undefined ? {} : { artifact }),
    namedWasm: {
      file: namedWasm.file,
      sha256: namedWasm.sha256,
      executableSha256: namedWasm.executableSha256,
      functions,
    },
  };
}

async function readArtifactSourceMaps(
  artifactPath: string,
  manifestPath: string | undefined,
  frames: readonly CallFrame[],
): Promise<ArtifactSourceMaps> {
  if (manifestPath === undefined) throw new Error('--artifact requires --manifest');
  const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')), manifestPath);
  if (manifest.artifact === undefined) throw new Error('Manifest has no artifact SHA-256 proof');
  const absoluteArtifact = resolve(process.cwd(), artifactPath);
  const artifact = await readFile(absoluteArtifact);
  if (sha256(artifact) !== manifest.artifact.sha256) throw new Error('artifact SHA-256 does not match manifest');

  const { stdout: listing } = await execFileAsync('tar', ['-tzf', absoluteArtifact], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const members = new Set(
    listing.split('\n').filter((member) => member.startsWith('package/dist/') && member.endsWith('.js.map')),
  );
  const maps = new Map<string, TraceMap>();
  const originals = new Map<string, OriginalLocation>();
  for (const frame of frames) {
    const member = sourceMapMember(frame.url);
    if (member === undefined || !members.has(member)) continue;
    let map = maps.get(member);
    if (map === undefined) {
      const { stdout } = await execFileAsync('tar', ['-xOzf', absoluteArtifact, member], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      map = new TraceMap(JSON.parse(stdout));
      maps.set(member, map);
    }
    if (frame.lineNumber < 0 || frame.columnNumber < 0) continue;
    const original = originalPositionFor(map, {
      line: frame.lineNumber + 1,
      column: frame.columnNumber,
      bias: GREATEST_LOWER_BOUND,
    });
    const source = original.source;
    if (source === null || source === undefined || original.line == null || original.column == null) continue;
    const file = originalSourcePath(member, map.sourceRoot ?? null, source);
    originals.set(frameKey(frame), {
      file,
      lineNumber: original.line,
      columnNumber: original.column,
    });
  }
  return { artifactSha256: manifest.artifact.sha256, locations: originals };
}

function sourceMapMember(url: string): string | undefined {
  if (!url.startsWith('file:')) return undefined;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const marker = '/node_modules/@pmndrs/glyph/dist/';
  const index = pathname.lastIndexOf(marker);
  if (index < 0) return undefined;
  try {
    return `package/dist/${decodeURIComponent(pathname.slice(index + marker.length))}.map`;
  } catch {
    return undefined;
  }
}

function originalSourcePath(mapMember: string, sourceRoot: string | null, source: string): string {
  try {
    const pathname = new URL(source).pathname;
    const packagePrefix = '/package/';
    if (pathname.startsWith(packagePrefix))
      return `packages/glyph/${decodeURIComponent(pathname.slice(packagePrefix.length))}`;
    if (source.startsWith('file:') && pathname.startsWith('/src/'))
      return `packages/glyph${decodeURIComponent(pathname)}`;
  } catch {
    // Relative source paths are resolved below against the map's artifact member.
  }
  const mapRelative = mapMember.slice('package/'.length, -'.map'.length);
  const packagePath = posix.normalize(posix.join('package', posix.dirname(mapRelative), sourceRoot ?? '', source));
  return packagePath.startsWith('package/') ? `packages/glyph/${packagePath.slice('package/'.length)}` : source;
}

function sameFunctions(left: readonly NamedFunction[], right: readonly NamedFunction[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index];
      return other !== undefined && entry.functionIndex === other.functionIndex && entry.name === other.name;
    })
  );
}

function resolveFrame(
  frame: CallFrame,
  names: ReadonlyMap<number, string> | undefined,
  wasmUrl: string | undefined,
): CallFrame {
  const match = /^wasm-function\[(\d+)\]$/.exec(frame.functionName);
  if (match === null || names === undefined || wasmUrl === undefined || frame.url !== wasmUrl) return frame;
  const mapped = names.get(Number(match[1]));
  return mapped === undefined ? frame : { ...frame, functionName: mapped };
}

function add(
  totals: Map<string, Hotspot>,
  frame: CallFrame,
  field: 'selfMicroseconds' | 'inclusiveMicroseconds',
  delta: number,
  isSelf: boolean,
  original?: OriginalLocation,
): void {
  const key = frameKey(frame);
  const previous = totals.get(key) ?? {
    functionName: frame.functionName,
    url: frame.url,
    lineNumber: frame.lineNumber,
    columnNumber: frame.columnNumber,
    selfMicroseconds: 0,
    inclusiveMicroseconds: 0,
    selfSamples: 0,
    ...(original === undefined
      ? {}
      : {
          originalFile: original.file,
          originalLineNumber: original.lineNumber,
          originalColumnNumber: original.columnNumber,
        }),
  };
  const total = previous[field] + delta;
  if (!Number.isSafeInteger(total)) throw new Error('Profile attribution exceeds safe integer range');
  totals.set(key, {
    ...previous,
    [field]: total,
    selfSamples: previous.selfSamples + Number(isSelf),
  });
}

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\r', '').replaceAll('\n', '<br>');
}

function frameKey(frame: CallFrame): string {
  return JSON.stringify([frame.url, frame.functionName, frame.lineNumber, frame.columnNumber]);
}

function isFrameLocation(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= -1;
}

function isSafeIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
