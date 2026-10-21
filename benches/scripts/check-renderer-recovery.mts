/* @workflow {
  "name": "benchmark:renderer-recovery",
  "summary": "Check warm Bitmap renderer rejection and explicit checkpoint recovery against one frozen installed Glyph archive.",
  "requirements": "Pass --artifact <frozen .tgz>, --expected-sha256 <64 hex digits>, and --output <new directory>; pinned pnpm, Node and authenticated Inter Bitmap fixture. No GPU, build, or timing run.",
  "writes": "Deterministic identity and correctness JSON in --output; temporary installed package removed afterward."
} */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { installedPackageDependencies } from './support/package-labs-dependencies.mts';

const args = process.argv.slice(2);
if (
  args.length !== 6 ||
  args[0] !== '--artifact' ||
  args[2] !== '--expected-sha256' ||
  args[4] !== '--output' ||
  !args[1] ||
  !args[3] ||
  !args[5] ||
  !/^[a-f0-9]{64}$/u.test(args[3])
) {
  throw new Error('Pass --artifact <frozen .tgz> --expected-sha256 <64 lowercase hex digits> --output <new directory>');
}
const archive = resolve(args[1]);
const expectedArchive = args[3]!;
const output = resolve(args[5]);
assert((await stat(archive)).isFile() && archive.endsWith('.tgz'));
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(archive)), expectedArchive, 'frozen package archive identity');
const pnpm = process.env.npm_execpath;
if (pnpm === undefined) throw new Error('Run through the pinned pnpm workflow');
const workspace = fileURLToPath(new URL('../..', import.meta.url));
const temporary = await mkdtemp(resolve(tmpdir(), 'glyph-renderer-recovery-'));
const packageRoot = resolve(temporary, 'node_modules/@pmndrs/glyph');
const unpacked = resolve(temporary, 'unpacked');
const fixturePath = resolve(workspace, 'benches/fixtures/rendering/inter-bitmap-16.font.glb');
const fixtureSource = resolve(workspace, 'benches/labs/package/fixture.ts');
const sourceIdentity = Object.fromEntries(
  await Promise.all(
    [
      fileURLToPath(import.meta.url),
      fixtureSource,
      fixturePath,
      fileURLToPath(new URL('./support/package-labs-dependencies.mts', import.meta.url)),
    ].map(async (path) => [relative(workspace, path), hash(await readFile(path))] as const),
  ),
);

try {
  await mkdir(output);
  await mkdir(unpacked);
  await run('tar', ['-xzf', archive, '-C', unpacked], temporary);
  const archiveMembers = await inventoryDist(resolve(unpacked, 'package/dist'));
  await writeFile(
    resolve(temporary, 'package.json'),
    `${JSON.stringify(
      {
        name: 'glyph-renderer-recovery',
        private: true,
        type: 'module',
        dependencies: installedPackageDependencies(`file:${archive}`),
      },
      null,
      2,
    )}\n`,
  );
  await run(pnpm, ['install', '--ignore-scripts', '--config.confirmModulesPurge=false'], temporary);
  const installedBefore = await inventoryDist(resolve(packageRoot, 'dist'));
  assert.deepEqual(installedBefore, archiveMembers, 'all installed dist JS/Wasm members match archive');
  const packageRequire = createRequire(resolve(packageRoot, 'package.json'));
  const THREE = (await import(
    pathToFileURL(packageRequire.resolve('three/webgpu')).href
  )) as typeof import('three/webgpu');
  const three = (await import(
    pathToFileURL(resolve(packageRoot, 'dist/three.js')).href
  )) as typeof import('@pmndrs/glyph/three');
  const { threeSystemBuffers } = (await import(pathToFileURL(resolve(packageRoot, 'dist/three/codec.js')).href)) as {
    threeSystemBuffers: {
      placementSlot: { id: number };
      stableGlyphId: { id: number };
      transformIndex: { id: number };
    };
  };
  process.env.GLYPH_LABS_PACKAGE_ROOT = packageRoot;
  const fixture = (await import(pathToFileURL(fixtureSource).href)) as typeof import('../labs/package/fixture.ts');
  const { glyph, font } = fixture;
  const count = 1_024;
  const initial = (index: number): string => `alpha ${String(index).padStart(4, '0')}`;
  const updated = (index: number): string => `bravo ${String(index).padStart(4, '0')}`;
  const rejection = { source: 'renderer-recovery', code: 1 };
  let rejectNext = false;
  let decodeCount = 0;
  type ResourceProbe = { readonly length: number; at(index: number): unknown };
  const decoded: Array<{ checkpoint: boolean; resources: ResourceProbe }> = [];
  function unreadBatchResources(
    frame: Parameters<ReturnType<typeof three.ThreeConfig.renderer>['decode']>[0],
  ): ResourceProbe {
    if (frame.displayList.kind !== 'replace') throw new Error('Lease probe requires a replace display-list phase');
    const children = frame.displayList.value.children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children.at(index);
      if (child?.kind === 'batch' && child.value.input.resources.length > 0) {
        return child.value.input.resources;
      }
    }
    throw new Error('Lease probe requires a batch with an unread resource');
  }
  const config = {
    ...three.defineThreeConfig({ capacity: { size: count * 16, policy: 'grow' } }),
    renderer(context: Parameters<typeof three.ThreeConfig.renderer>[0]) {
      const renderer = three.ThreeConfig.renderer(context);
      return {
        decode(frame: Parameters<typeof renderer.decode>[0]) {
          decodeCount += 1;
          assert.equal(frame.delivery, 'borrowed-command-buffer');
          const resources = unreadBatchResources(frame);
          assert(resources.length > 0);
          if (decodeCount === 1)
            assert.notEqual(resources.at(0), undefined, 'resource resolves while initial lease is active');
          decoded.push({ checkpoint: frame.checkpoint, resources });
          const prepared = renderer.decode(frame);
          if (rejectNext) {
            rejectNext = false;
            prepared.discard();
            throw rejection;
          }
          return prepared;
        },
        syncTransforms(updates: Parameters<typeof renderer.syncTransforms>[0]) {
          renderer.syncTransforms(updates);
        },
        dispose() {
          renderer.dispose();
        },
      };
    },
  };
  const warmRoot = glyph.handle('renderer-recovery:warm', config);
  const coldRoot = glyph.handle(
    'renderer-recovery:cold',
    three.defineThreeConfig({ capacity: { size: count * 16, policy: 'grow' } }),
  );
  const warmGroup = warmRoot.createTextGroup();
  const coldGroup = coldRoot.createTextGroup();
  const warm = Array.from({ length: count }, (_, index) =>
    warmRoot.createText({
      font,
      text: initial(index),
      style: { fontSize: 16 },
      constraints: { width: { mode: 'exact', size: 160 } },
    }),
  );
  const cold = Array.from({ length: count }, (_, index) =>
    coldRoot.createText({
      font,
      text: updated(index),
      style: { fontSize: 16 },
      constraints: { width: { mode: 'exact', size: 160 } },
    }),
  );
  const warmScene = new THREE.Scene();
  const coldScene = new THREE.Scene();
  const lifecycleAttributes = new Set([
    '_pmndrsGlyphInstanceTransforms',
    '_pmndrsGlyphTransforms',
    ...[threeSystemBuffers.placementSlot, threeSystemBuffers.stableGlyphId, threeSystemBuffers.transformIndex].map(
      (buffer) => `_pmndrsGlyph_${String(buffer.id)}`,
    ),
  ]);
  function assertExpired(resources: ResourceProbe): void {
    assert(resources.length > 0, 'the selected unread lazy sequence has at least one resource');
    assert.throws(() => resources.at(0), /borrowed text render plan has expired/u);
  }
  function hostSnapshot(scene: InstanceType<typeof THREE.Scene>, comparable = false): readonly unknown[] {
    const root = scene.getObjectByName('@pmndrs/glyph:anonymous');
    const draws =
      root?.children.filter((child): child is InstanceType<typeof THREE.Mesh> => child instanceof THREE.Mesh) ?? [];
    return draws.map((draw) => ({
      count: draw.geometry instanceof THREE.InstancedBufferGeometry ? draw.geometry.instanceCount : 0,
      attributes: Object.fromEntries(
        Object.entries(draw.geometry.attributes)
          .filter(([name]) => !comparable || !lifecycleAttributes.has(name))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, attribute]) => [
            name,
            {
              byteLength: attribute.array.byteLength,
              sha256: hash(
                new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength),
              ),
            },
          ]),
      ),
    }));
  }
  function assertSemanticEqual(actual: (typeof warm)[number], expected: (typeof cold)[number]): void {
    assert.deepEqual(actual.measure(), expected.measure());
    const a = actual.glyphs();
    const b = expected.glyphs();
    for (const field of [
      'glyphIds',
      'clusters',
      'glyphFontSizes',
      'x',
      'y',
      'glyphAdvances',
      'glyphInkX',
      'glyphInkY',
      'glyphInkWidths',
      'glyphInkHeights',
      'lineBaselines',
      'lineAdvances',
    ] as const) {
      assert.deepEqual(Array.from(a[field]), Array.from(b[field]), field);
    }
  }
  warmGroup.add(...warm);
  coldGroup.add(...cold);
  warmScene.add(warmGroup);
  coldScene.add(coldGroup);
  let behavioralResult: Record<string, unknown> | undefined;
  try {
    warmScene.updateMatrixWorld(true);
    assert(warm.every((label) => label.commitState().status === 'committed'));
    assert.equal(decoded.length, 1);
    assert.equal(decoded[0]!.checkpoint, true, 'initial publication is a checkpoint');
    const accepted = hostSnapshot(warmScene);
    assert(accepted.length > 0, 'initial host has real Bitmap draws');
    for (const [index, label] of warm.entries()) label.text = updated(index);
    const preparedMeasure = warm[0]!.measure();
    const preparedGlyphCount = warm[0]!.readGlyphs((layout) => layout.glyphCount);
    assert.equal(preparedGlyphCount, updated(0).length);
    rejectNext = true;
    let caught: unknown;
    let didThrow = false;
    try {
      glyph.shape();
    } catch (error) {
      didThrow = true;
      caught = error;
    }
    assert(didThrow && Object.is(caught, rejection), 'public shape preserves raw renderer rejection identity');
    assert.equal(decoded.at(-1)!.checkpoint, false, 'the rejected warm publication was retained');
    assert.equal(warmGroup.error, rejection);
    assert.deepEqual(hostSnapshot(warmScene), accepted, 'rejected target leaves accepted host bytes unchanged');
    assert.deepEqual(warm[0]!.measure(), preparedMeasure, 'prepared measurement survives target rejection');
    assert.equal(
      warm[0]!.readGlyphs((layout) => layout.glyphCount),
      preparedGlyphCount,
    );
    assert.equal(warm[0]!.text, updated(0), 'authored text remains at the rejected semantic revision');
    assertSemanticEqual(warm[0]!, cold[0]!);
    assertExpired(decoded.at(-1)!.resources);
    const afterReject = decodeCount;
    glyph.shape();
    assert.equal(decodeCount, afterReject, 'no implicit retry without another authored setter');
    coldScene.updateMatrixWorld(true);
    assert.equal(decodeCount, afterReject, 'publishing a different root does not retry the rejected root');
    const retryText = `${updated(0)}!`;
    warm[0]!.set({ text: retryText });
    assert.equal(warm[0]!.text, retryText, 'first explicit setter changes the authored semantic revision');
    assert.equal(
      warm[0]!.readGlyphs((layout) => layout.glyphCount),
      preparedGlyphCount + 1,
    );
    warm[0]!.set({ text: updated(0) });
    assert.equal(warm[0]!.text, updated(0), 'second explicit setter restores the independent cold revision');
    assert.equal(
      warm[0]!.readGlyphs((layout) => layout.glyphCount),
      preparedGlyphCount,
    );
    glyph.shape();
    assert.equal(decodeCount, afterReject + 1, 'two meaningful public setters trigger one warm decode');
    assert.equal(decoded.at(-1)!.checkpoint, true, 'explicit retry supplies a cold renderer checkpoint');
    assertExpired(decoded.at(-1)!.resources);
    coldScene.updateMatrixWorld(true);
    assert(warm.every((label) => label.commitState().status === 'committed'));
    assert(hostSnapshot(warmScene).length > 0);
    assert.notDeepEqual(hostSnapshot(warmScene), accepted, 'retry publishes changed host bytes');
    for (const [index, label] of warm.entries()) assertSemanticEqual(label, cold[index]!);
    assert.deepEqual(
      hostSnapshot(warmScene, true),
      hostSnapshot(coldScene, true),
      'recovered public host attributes match independent cold output after omitting lifecycle-only columns',
    );
    behavioralResult = {
      count,
      initialDecodeCount: 1,
      rejectedDecodeCount: afterReject,
      finalDecodeCount: decodeCount,
      preparedGlyphCount,
      acceptedHostSha256: hash(new TextEncoder().encode(JSON.stringify(accepted))),
      recoveredHostSha256: hash(new TextEncoder().encode(JSON.stringify(hostSnapshot(warmScene)))),
    };
  } finally {
    warmGroup.dispose();
    coldGroup.dispose();
    for (const label of warm) label.dispose();
    for (const label of cold) label.dispose();
    warmRoot.dispose();
    coldRoot.dispose();
  }
  assert.deepEqual(
    await inventoryDist(resolve(packageRoot, 'dist')),
    installedBefore,
    'all installed dist JS/Wasm members unchanged',
  );
  assert.equal(hash(await readFile(archive)), expectedArchive, 'archive unchanged');
  assert.deepEqual(
    Object.fromEntries(
      await Promise.all(
        Object.keys(sourceIdentity).map(
          async (path) => [path, hash(await readFile(resolve(workspace, path)))] as const,
        ),
      ),
    ),
    sourceIdentity,
    'gate source and fixture identities unchanged',
  );
  assert(behavioralResult !== undefined);
  await writeFile(
    resolve(output, 'result.json'),
    `${JSON.stringify(
      {
        result: 'renderer-recovery-pass',
        identityScope: 'authenticated archive SHA-256; installed dist JavaScript and Wasm members only',
        ...behavioralResult,
        archiveSha256: expectedArchive,
        archiveDistMembers: archiveMembers,
        installedDistMembersBefore: installedBefore,
        installedDistMembersAfter: await inventoryDist(resolve(packageRoot, 'dist')),
        inputHashes: sourceIdentity,
        lockSha256: hash(await readFile(resolve(temporary, 'pnpm-lock.yaml'))),
        node: process.version,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`Renderer recovery gate passed for ${String(count)} warm Bitmap labels.\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function inventoryDist(root: string): Promise<Record<string, string>> {
  const found: Array<readonly [string, string]> = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.wasm'))) {
        found.push([relative(root, path), hash(await readFile(path))]);
      }
    }
  }
  await visit(root);
  found.sort(([a], [b]) => a.localeCompare(b));
  assert(found.length > 0, 'installed package contains JS/Wasm members');
  return Object.fromEntries(found);
}

async function run(command: string, values: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, values, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`${basename(command)} exited with ${String(code)}`)),
    );
  });
}
