import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { sha256, wasmSections } from '../../../packages/glyph/scripts/support/named-shaper.mjs';
import { classifyCpuProfileStage } from './cpu-profile-stage.mts';
import { renderCpuProfileSummary, summarizeCpuProfile } from '../../scripts/support/cpu-profile-summary.mts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('V8 CPU profile summary', () => {
  it('classifies profile samples by module origin before function naming', () => {
    expect(classifyCpuProfileStage('binaryen:byn$mgfn-shared$1328', 'wasm://wasm/0069ebc6')).toBe('other-wasm');
    expect(classifyCpuProfileStage('pmndrs_glyph_engine_measure_paragraph', 'wasm://wasm/0069ebc6')).toBe('other-wasm');
    expect(classifyCpuProfileStage('js-to-wasm:iiii:', 'wasm://wasm/00aa4bda')).toBe('wasm-transition');
    expect(classifyCpuProfileStage('post', 'node:inspector')).toBe('host-runtime');
    expect(classifyCpuProfileStage('c', 'file:///tmp/node_modules/@pmndrs/glyph/dist/internal/frame-wire.js')).toBe(
      'javascript',
    );
    expect(classifyCpuProfileStage('updateBulk', 'file:///work/benches/labs/package/edit.mts')).toBe(
      'benchmark-harness',
    );
    expect(classifyCpuProfileStage('multiplyMatrices', 'file:///tmp/node_modules/three/build/three.core.js')).toBe(
      'external-javascript',
    );
    const workspaceSourcePath = new URL('../../../packages/glyph/src/internal/render-planner.ts', import.meta.url)
      .pathname;
    const cases = [
      ['binaryen:module', 'https://candidate.invalid/packages/glyph/dist/text-shaper.wasm?import#source', 'other-wasm'],
      ['js-to-wasm:i', 'https://baseline.invalid/packages/glyph/dist/text-shaper.wasm?module', 'wasm-transition'],
      ['codec_gather', 'https://baseline.invalid/packages/glyph/dist/text-shaper.wasm?module', 'gather'],
      ['ordered_plan_compiler', 'https://candidate.invalid/text-shaper.wasm#source', 'render-plan'],
      ['renderText', `http://localhost:5173/@fs${workspaceSourcePath}?v=retained-profile`, 'javascript'],
      ['renderText', 'file:///tmp/candidate/packages/glyph/dist/internal/render-planner.js', 'javascript'],
      ['js-to-wasm:i', 'https://cdn.invalid/text-shaper.wasm.js?import', 'external-javascript'],
      ['codec_gather', 'https://cdn.invalid/runtime-shaper.js?asset=text-shaper.wasm#module', 'external-javascript'],
      ['js-to-wasm:i', 'https://cdn.invalid/runtime-shaper.js', 'external-javascript'],
    ] as const;
    for (const [functionName, url, expected] of cases) {
      expect(classifyCpuProfileStage(functionName, url), `${functionName} at ${url}`).toBe(expected);
    }
  });

  it('recomputes exclusive stage buckets from saved profile samples', async () => {
    const workspaceSourcePath = new URL('../../../packages/glyph/src/internal/render-planner.ts', import.meta.url)
      .pathname;
    const profile = await writeProfile({
      nodes: [
        node(1, '(root)', '', [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
        node(2, 'binaryen:byn$mgfn-shared$1328', 'wasm://wasm/0069ebc6'),
        node(3, 'js-to-wasm:i', 'wasm://wasm/00aa4bda'),
        node(4, 'post', 'node:inspector'),
        node(5, 'c', 'file:///tmp/node_modules/@pmndrs/glyph/dist/internal/frame-wire.js'),
        node(6, 'updateBulk', 'file:///work/benches/labs/package/edit.mts'),
        node(7, 'multiplyMatrices', 'file:///tmp/node_modules/three/build/three.core.js'),
        node(8, 'binaryen:module', 'https://candidate.invalid/packages/glyph/dist/text-shaper.wasm?import'),
        node(9, 'js-to-wasm:i', 'https://baseline.invalid/packages/glyph/dist/text-shaper.wasm?module'),
        node(10, 'codec_gather', 'https://baseline.invalid/packages/glyph/dist/text-shaper.wasm?module'),
        node(11, 'ordered_plan_compiler', 'https://candidate.invalid/text-shaper.wasm#source'),
        node(12, 'renderText', `http://localhost:5173/@fs${workspaceSourcePath}?v=retained-profile`),
        node(13, 'js-to-wasm:i', 'https://cdn.invalid/text-shaper.wasm.js?import'),
        node(14, 'codec_gather', 'https://cdn.invalid/runtime-shaper.js?asset=text-shaper.wasm'),
      ],
      samples: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      timeDeltas: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    });
    const summary = await summarizeCpuProfile(profile);
    expect(summary.stageTotals).toEqual([
      { stage: 'external-javascript', microseconds: 34 },
      { stage: 'javascript', microseconds: 17 },
      { stage: 'wasm-transition', microseconds: 12 },
      { stage: 'render-plan', microseconds: 11 },
      { stage: 'gather', microseconds: 10 },
      { stage: 'other-wasm', microseconds: 10 },
      { stage: 'benchmark-harness', microseconds: 6 },
      { stage: 'host-runtime', microseconds: 4 },
    ]);
    expect(renderCpuProfileSummary(summary)).toContain('| wasm-transition | 12 |');
  });

  it('counts self and inclusive samples across recursive ancestors', async () => {
    const profile = await writeProfile({
      nodes: [
        node(1, '(root)', '', [2, 5]),
        node(2, 'paint', 'app.js', [3], 4, 2),
        node(3, 'paint', 'app.js', [4], 4, 2),
        node(4, 'draw', 'app.js', undefined, 5, 1),
        node(5, 'paint', 'app.js', [6], 20, 4),
        node(6, 'draw', 'app.js', undefined, 23, 8),
      ],
      samples: [4, 6],
      timeDeltas: [17, 19],
    });
    const summary = await summarizeCpuProfile(profile);
    expect(summary.totalMicroseconds).toBe(36);
    expect(summary.hotspots).toEqual([
      {
        functionName: '(root)',
        url: '',
        lineNumber: -1,
        columnNumber: -1,
        selfMicroseconds: 0,
        inclusiveMicroseconds: 36,
        selfSamples: 0,
      },
      {
        functionName: 'draw',
        url: 'app.js',
        lineNumber: 23,
        columnNumber: 8,
        selfMicroseconds: 19,
        inclusiveMicroseconds: 19,
        selfSamples: 1,
      },
      {
        functionName: 'paint',
        url: 'app.js',
        lineNumber: 20,
        columnNumber: 4,
        selfMicroseconds: 0,
        inclusiveMicroseconds: 19,
        selfSamples: 0,
      },
      {
        functionName: 'draw',
        url: 'app.js',
        lineNumber: 5,
        columnNumber: 1,
        selfMicroseconds: 17,
        inclusiveMicroseconds: 17,
        selfSamples: 1,
      },
      {
        functionName: 'paint',
        url: 'app.js',
        lineNumber: 4,
        columnNumber: 2,
        selfMicroseconds: 0,
        inclusiveMicroseconds: 17,
        selfSamples: 0,
      },
    ]);
    const markdown = renderCpuProfileSummary(summary);
    expect(markdown).toContain('Inclusive rows overlap');
    expect(markdown).toContain('not timed latency or FPS');
  });

  it('partitions a single capture by disjoint ancestry and leaves detached GC unattributed', async () => {
    const profile = await writeProfile({
      nodes: [
        node(1, '(root)', '', [2, 7]),
        node(2, 'updateBulk', 'file:///work/benches/labs/package/edit.mts', [3, 5]),
        node(3, 'prepare', 'file:///work/benches/labs/package/edit.mts', [4]),
        node(4, 'codec_gather', 'wasm://engine'),
        node(5, 'publish', 'file:///work/benches/labs/package/edit.mts', [6]),
        node(6, 'multiplyMatrices', 'file:///tmp/node_modules/three/build/three.core.js'),
        node(7, '(garbage collector)', 'node:internal/gc'),
      ],
      samples: [3, 4, 5, 6, 7, 2],
      timeDeltas: [2, 3, 5, 7, 11, 13],
    });
    const directory = await temporaryDirectory();
    const ancestry = resolve(directory, 'ancestry.json');
    await writeFile(
      ancestry,
      JSON.stringify([
        { label: 'preparation', nodeId: 3 },
        { label: 'publication', nodeId: 5 },
      ]),
    );
    const summary = await summarizeCpuProfile(profile, undefined, undefined, undefined, ancestry);
    expect(summary.totalMicroseconds).toBe(41);
    expect(summary.sampleCount).toBe(6);
    expect(
      summary.phases?.map(({ label, nodeId, microseconds, sampleCount }) => ({
        label,
        nodeId,
        microseconds,
        sampleCount,
      })),
    ).toEqual([
      { label: 'preparation', nodeId: 3, microseconds: 5, sampleCount: 2 },
      { label: 'publication', nodeId: 5, microseconds: 12, sampleCount: 2 },
      { label: 'unattributed', nodeId: undefined, microseconds: 24, sampleCount: 2 },
    ]);
    expect(summary.phases?.reduce((sum, phase) => sum + phase.microseconds, 0)).toBe(summary.totalMicroseconds);
    expect(summary.phases?.reduce((sum, phase) => sum + phase.sampleCount, 0)).toBe(summary.sampleCount);
    expect(summary.phases?.map((phase) => phase.stageTotals)).toEqual([
      [
        { stage: 'gather', microseconds: 3 },
        { stage: 'benchmark-harness', microseconds: 2 },
      ],
      [
        { stage: 'external-javascript', microseconds: 7 },
        { stage: 'benchmark-harness', microseconds: 5 },
      ],
      [
        { stage: 'benchmark-harness', microseconds: 13 },
        { stage: 'host-runtime', microseconds: 11 },
      ],
    ]);
    expect(
      summary.phases?.[0]?.hotspots.map(({ functionName, selfMicroseconds }) => [functionName, selfMicroseconds]),
    ).toEqual([
      ['codec_gather', 3],
      ['prepare', 2],
    ]);
    expect(
      summary.phases?.[1]?.hotspots.map(({ functionName, selfMicroseconds }) => [functionName, selfMicroseconds]),
    ).toEqual([
      ['multiplyMatrices', 7],
      ['publish', 5],
    ]);
    expect(summary.phases?.[2]?.hotspots.map(({ functionName }) => functionName)).toEqual([
      'updateBulk',
      '(garbage collector)',
    ]);
    expect(renderCpuProfileSummary(summary)).toContain('| preparation | 3 | 2 | 5 |');

    await writeFile(
      ancestry,
      JSON.stringify([
        { label: 'parent', nodeId: 2 },
        { label: 'child', nodeId: 3 },
      ]),
    );
    await expect(summarizeCpuProfile(profile, undefined, undefined, undefined, ancestry)).rejects.toThrow('overlap');
    await writeFile(ancestry, JSON.stringify([{ label: 'missing', nodeId: 99 }]));
    await expect(summarizeCpuProfile(profile, undefined, undefined, undefined, ancestry)).rejects.toThrow(
      'Invalid ancestry anchor',
    );
    await writeFile(
      ancestry,
      JSON.stringify([
        { label: 'same', nodeId: 3 },
        { label: 'same', nodeId: 5 },
      ]),
    );
    await expect(summarizeCpuProfile(profile, undefined, undefined, undefined, ancestry)).rejects.toThrow(
      'Duplicate ancestry label',
    );
    await writeFile(
      ancestry,
      JSON.stringify([
        { label: 'a', nodeId: 3 },
        { label: 'b', nodeId: 3 },
      ]),
    );
    await expect(summarizeCpuProfile(profile, undefined, undefined, undefined, ancestry)).rejects.toThrow(
      'Duplicate ancestry node ID',
    );
  });

  it('keeps identical function names from different Wasm URLs separate', async () => {
    const profile = await writeProfile({
      nodes: [node(1, '(root)', '', [2, 3]), node(2, 'work', 'wasm://first'), node(3, 'work', 'wasm://second')],
      samples: [2, 3],
      timeDeltas: [5, 7],
    });
    const summary = await summarizeCpuProfile(profile);
    expect(summary.hotspots.filter(({ functionName }) => functionName === 'work')).toHaveLength(2);
    expect(summary.hotspots.map(({ url }) => url)).toContain('wasm://first');
    expect(summary.hotspots.map(({ url }) => url)).toContain('wasm://second');
  });

  it('resolves generic Wasm names only for the explicitly associated URL and authenticated map', async () => {
    const directory = await temporaryDirectory();
    const wasmPath = resolve(directory, 'named.wasm');
    const manifestPath = resolve(directory, 'manifest.json');
    const wasm = namedWasmFixture('codec_gather');
    await writeFile(wasmPath, wasm);
    await writeFile(
      manifestPath,
      JSON.stringify({
        namedWasm: {
          file: wasmPath,
          sha256: sha256(wasm),
          executableSha256: executableSha256(wasm),
          functions: [{ functionIndex: 0, name: 'codec_gather' }],
        },
      }),
    );
    const profile = await writeProfile({
      nodes: [
        node(1, '(root)', '', [2, 3]),
        node(2, 'wasm-function[0]', 'wasm://selected'),
        node(3, 'wasm-function[0]', 'wasm://other'),
      ],
      samples: [2, 3],
      timeDeltas: [11, 13],
    });
    const summary = await summarizeCpuProfile(profile, manifestPath, 'wasm://selected');
    expect(summary.hotspots.map(({ functionName, url }) => [functionName, url])).toContainEqual([
      'codec_gather',
      'wasm://selected',
    ]);
    expect(summary.hotspots.map(({ functionName, url }) => [functionName, url])).toContainEqual([
      'wasm-function[0]',
      'wasm://other',
    ]);
    expect(summary.stageTotals).toEqual([
      { stage: 'other-wasm', microseconds: 13 },
      { stage: 'gather', microseconds: 11 },
    ]);

    const builderManifestPath = resolve(directory, 'builder-manifest.json');
    const builderWasmPath = resolve(directory, 'text-shaper.named.wasm');
    await writeFile(builderWasmPath, wasm);
    await writeFile(
      builderManifestPath,
      JSON.stringify({
        namedSha256: sha256(wasm),
        executableSha256: executableSha256(wasm),
        functions: [{ functionIndex: 0, name: 'codec_gather' }],
      }),
    );
    const builderSummary = await summarizeCpuProfile(profile, builderManifestPath, 'wasm://selected');
    expect(builderSummary.hotspots.map(({ functionName, url }) => [functionName, url])).toContainEqual([
      'codec_gather',
      'wasm://selected',
    ]);
    expect(builderSummary.hotspots.map(({ functionName, url }) => [functionName, url])).toContainEqual([
      'wasm-function[0]',
      'wasm://other',
    ]);
    expect(builderSummary.stageTotals).toEqual([
      { stage: 'other-wasm', microseconds: 13 },
      { stage: 'gather', microseconds: 11 },
    ]);
  });

  it('rejects malformed sample references and named-Wasm manifest mismatches', async () => {
    const badProfile = await writeProfile({ nodes: [node(1, '(root)', '')], samples: [99], timeDeltas: [1] });
    await expect(summarizeCpuProfile(badProfile)).rejects.toThrow('unknown profile node 99');

    const directory = await temporaryDirectory();
    const wasmPath = resolve(directory, 'named.wasm');
    const manifestPath = resolve(directory, 'manifest.json');
    await writeFile(wasmPath, 'not wasm');
    await writeFile(
      manifestPath,
      JSON.stringify({
        namedWasm: {
          file: wasmPath,
          sha256: '0'.repeat(64),
          executableSha256: '0'.repeat(64),
          functions: [],
        },
      }),
    );
    await expect(summarizeCpuProfile(badProfile, manifestPath)).rejects.toThrow('SHA-256 does not match');

    const wasm = namedWasmFixture();
    await writeFile(wasmPath, wasm);
    await writeFile(
      manifestPath,
      JSON.stringify({
        namedWasm: {
          file: wasmPath,
          sha256: sha256(wasm),
          executableSha256: executableSha256(wasm),
          functions: [{ functionIndex: 0, name: 'wrong_name' }],
        },
      }),
    );
    await expect(summarizeCpuProfile(badProfile, manifestPath)).rejects.toThrow('function map does not match manifest');
  });

  it('maps exact artifact source maps and preserves unmapped and Wasm frames', async () => {
    const directory = await temporaryDirectory();
    const { artifactPath, manifestPath } = await writeMappedArtifact(directory);
    const profile = await writeProfile({
      nodes: [
        node(1, '(root)', '', [2, 3, 4, 5]),
        node(2, 'a', 'file:///tmp/installed/node_modules/@pmndrs/glyph/dist/min.js', undefined, 0, 0),
        node(3, 'unknown', 'file:///tmp/installed/node_modules/@pmndrs/glyph/dist/missing.js', undefined, 0, 7),
        node(4, 'wasm-function[19]', 'wasm://engine', undefined, 0, 19),
        node(5, 'unrelated', 'file:///tmp/installed/node_modules/another-package/dist/min.js', undefined, 0, 0),
      ],
      samples: [2, 3, 4, 5],
      timeDeltas: [5, 7, 11, 13],
    });
    const summary = await summarizeCpuProfile(profile, manifestPath, undefined, artifactPath);
    await expect(summarizeCpuProfile(profile, manifestPath, 'wasm://engine', artifactPath)).rejects.toThrow(
      'Manifest has no namedWasm proof',
    );
    const mapped = summary.hotspots.find(({ functionName }) => functionName === 'a');
    expect(mapped).toMatchObject({
      functionName: 'a',
      url: 'file:///tmp/installed/node_modules/@pmndrs/glyph/dist/min.js',
      lineNumber: 0,
      columnNumber: 0,
      originalFile: 'packages/glyph/src/fixture.ts',
      originalLineNumber: 1,
      originalColumnNumber: 0,
    });
    expect(summary.sourceMapArtifactSha256).toBe(sha256(await readFile(artifactPath)));
    const unknown = summary.hotspots.find(({ functionName }) => functionName === 'unknown');
    expect(unknown).toMatchObject({
      functionName: 'unknown',
      url: 'file:///tmp/installed/node_modules/@pmndrs/glyph/dist/missing.js',
      lineNumber: 0,
      columnNumber: 7,
    });
    expect(unknown).not.toHaveProperty('originalFile');
    const unrelated = summary.hotspots.find(({ functionName }) => functionName === 'unrelated');
    expect(unrelated).toMatchObject({
      url: 'file:///tmp/installed/node_modules/another-package/dist/min.js',
      lineNumber: 0,
      columnNumber: 0,
    });
    expect(unrelated).not.toHaveProperty('originalFile');
    expect(summary.hotspots.find(({ url }) => url === 'wasm://engine')).toMatchObject({
      functionName: 'wasm-function[19]',
      lineNumber: 0,
      columnNumber: 19,
    });
    expect(renderCpuProfileSummary(summary)).toContain('packages/glyph/src/fixture.ts');
  });

  it('rejects artifact source maps unless the manifest SHA matches the tarball', async () => {
    const directory = await temporaryDirectory();
    const { artifactPath, manifestPath } = await writeMappedArtifact(directory);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.artifact.sha256 = '0'.repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest));
    const profile = await writeProfile({
      nodes: [
        node(1, '(root)', '', [2]),
        node(2, 'a', 'file:///tmp/installed/node_modules/@pmndrs/glyph/dist/min.js', undefined, 0, 0),
      ],
      samples: [2],
      timeDeltas: [1],
    });
    await expect(summarizeCpuProfile(profile, manifestPath, undefined, artifactPath)).rejects.toThrow(
      'artifact SHA-256 does not match manifest',
    );
  });
});

function node(
  id: number,
  functionName: string,
  url: string,
  children?: number[],
  lineNumber?: number,
  columnNumber?: number,
) {
  return {
    id,
    callFrame: {
      functionName,
      url,
      ...(lineNumber === undefined ? {} : { lineNumber }),
      ...(columnNumber === undefined ? {} : { columnNumber }),
    },
    ...(children === undefined ? {} : { children }),
  };
}

async function writeProfile(profile: unknown): Promise<string> {
  const directory = await temporaryDirectory();
  const path = resolve(directory, 'profile.json');
  await writeFile(path, JSON.stringify(profile));
  return path;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'glyph-cpu-profile-summary-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeMappedArtifact(directory: string): Promise<{ artifactPath: string; manifestPath: string }> {
  const packageRoot = resolve(directory, 'package');
  const mapDirectory = resolve(packageRoot, 'dist');
  await mkdir(mapDirectory, { recursive: true });
  const source = 'export function mapped() { return 1; }';
  await writeFile(
    resolve(mapDirectory, 'min.js.map'),
    JSON.stringify({
      version: 3,
      file: 'min.js',
      sourceRoot: '',
      sources: ['../src/fixture.ts'],
      sourcesContent: [source],
      names: [],
      mappings: 'AAAA',
    }),
  );
  const artifactPath = resolve(directory, 'fixture.tgz');
  execFileSync('tar', ['-czf', artifactPath, '-C', directory, 'package']);
  const manifestPath = resolve(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ artifact: { sha256: sha256(await readFile(artifactPath)) } }));
  return { artifactPath, manifestPath };
}

function namedWasmFixture(functionName = 'f'): Buffer {
  const encodedName = Buffer.from(functionName);
  const functionNames = Buffer.concat([Buffer.from([1, 0, encodedName.length]), encodedName]);
  const customSection = Buffer.concat([
    Buffer.from([0, 7 + functionNames.length, 4]),
    Buffer.from('name'),
    Buffer.from([1, functionNames.length]),
    functionNames,
  ]);
  return Buffer.from([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    1,
    4,
    1,
    96,
    0,
    0,
    3,
    2,
    1,
    0,
    10,
    4,
    1,
    2,
    0,
    11,
    ...customSection,
  ]);
}

function executableSha256(wasm: Buffer): string {
  const header = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  return sha256(
    Buffer.concat([
      header,
      ...wasmSections(wasm)
        .filter((section) => section.id !== 0)
        .map((section) => section.bytes),
    ]),
  );
}
