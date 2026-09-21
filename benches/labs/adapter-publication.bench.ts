import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assert, bench, group } from '@pmndrs/labs';
import * as THREE from 'three/webgpu';

const packageRoot = process.env.GLYPH_LABS_PACKAGE_ROOT;
if (packageRoot === undefined) {
  throw new Error('GLYPH_LABS_PACKAGE_ROOT must identify an installed @pmndrs/glyph package');
}

const glyphPackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/index.js')).href
)) as typeof import('@pmndrs/glyph');
const threePackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/three.js')).href
)) as typeof import('@pmndrs/glyph/three');
const typeGpuPackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/typegpu.js')).href
)) as typeof import('@pmndrs/glyph/typegpu');
const corePackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/core.js')).href
)) as typeof import('@pmndrs/glyph/core');
interface ReactiveSnapshotPackage {
  snapshotReactivePropertyList<Value extends object>(value: unknown, label: string, previous?: Value): Value;
}

let reactiveSnapshotPackage: ReactiveSnapshotPackage;
const reactiveSnapshotPath = resolve(packageRoot, 'dist/vue/internal/property-snapshot.js');
if (existsSync(reactiveSnapshotPath)) {
  reactiveSnapshotPackage = (await import(pathToFileURL(reactiveSnapshotPath).href)) as ReactiveSnapshotPackage;
} else {
  const previous = (await import(pathToFileURL(resolve(packageRoot, 'dist/internal/desired-text.js')).href)) as {
    snapshotPropertyList<Value extends object>(value: unknown, label: string, prior?: Value): Value;
  };
  reactiveSnapshotPackage = { snapshotReactivePropertyList: previous.snapshotPropertyList };
}

const { bitmap, glyph, span, txt } = glyphPackage;
const { defineThreeConfig } = threePackage;
const { defineTypeGpuConfig } = typeGpuPackage;
const { resourceLease } = corePackage;
const { snapshotReactivePropertyList } = reactiveSnapshotPackage;
const fontBytes = await readFile(new URL('../fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url));

await glyph.init();
const font = glyph.fontFace(new Blob([new Uint8Array(fontBytes)], { type: 'model/gltf-binary' }), {
  format: bitmap({ strikes: [16] }),
});
await font.load();

let nextHandle = 1;

function formattedLabel(text: string) {
  return txt`${span({ color: '#ffffff', decoration: { underline: true } })`${text.slice(0, 5)}`}${text.slice(5)}`;
}

function createLabels(count: number, content: 'plain' | 'styled-flow' = 'plain') {
  const root = glyph.handle(
    `labs:adapter-publication:${String(nextHandle++)}`,
    defineThreeConfig({ capacity: { size: count * 16, policy: 'grow' } }),
  );
  const textGroup = root.createTextGroup();
  const scene = new THREE.Scene();
  const labels = Array.from({ length: count }, (_, index) => {
    const text = `label ${String(index).padStart(4, '0')}`;
    return root.createText({
      font,
      text: content === 'plain' ? text : formattedLabel(text),
      style: { fontSize: 16 },
      layout: { wrap: 'word' },
      constraints: { width: { mode: 'exact', size: 160 } },
      ...(content === 'plain'
        ? {}
        : {
            flow: {
              regions: [{ key: 'main', shape: { kind: 'rectangle' as const, bounds: [0, 0, 160, 64] as const } }],
            },
          }),
    });
  });
  textGroup.add(...labels);
  scene.add(textGroup);
  scene.updateMatrixWorld(true);
  if (textGroup.error !== undefined) throw textGroup.error;
  return { labels, root, scene, textGroup };
}

function disposeLabels(created: ReturnType<typeof createLabels>): void {
  created.textGroup.dispose();
  for (const label of created.labels) label.dispose();
  created.root.dispose();
}

function createTypeGpuLabels(count: number) {
  const gpuGlobals = globalThis as typeof globalThis & {
    GPUBufferUsage?: Readonly<{ COPY_DST: number; STORAGE: number; VERTEX: number }>;
  };
  gpuGlobals.GPUBufferUsage ??= { COPY_DST: 8, STORAGE: 128, VERTEX: 32 };
  const stats = { publications: 0, uniformWrites: 0 };
  const root = {
    createUniform() {
      return {
        buffer: { destroy() {} },
        value: [0, 0],
        write(value: readonly [number, number]) {
          stats.uniformWrites++;
          this.value = [...value];
        },
      };
    },
    device: {
      createBuffer({ size, usage }: { readonly size: number; readonly usage: number }) {
        return { bytes: new Uint8Array(size), destroy() {}, size, usage };
      },
      queue: {
        writeBuffer(target: { readonly bytes: Uint8Array }, offset: number, bytes: Uint8Array) {
          target.bytes.set(bytes, offset);
        },
      },
    },
  };
  const base = defineTypeGpuConfig({ root: root as never, format: 'rgba8unorm' });
  const config = {
    ...base,
    renderer: (context: Parameters<typeof base.renderer>[0]) => {
      const renderer = base.renderer(context);
      return {
        decode(frame: Parameters<typeof renderer.decode>[0]) {
          stats.publications++;
          return renderer.decode(frame);
        },
        syncTransforms(updates: Parameters<typeof renderer.syncTransforms>[0]) {
          renderer.syncTransforms(updates);
        },
        dispose: () => renderer.dispose(),
      };
    },
    resolve: () =>
      resourceLease(
        {
          prepare(..._arguments: unknown[]) {
            return { draw() {} };
          },
          dispose() {},
        },
        () => {},
      ),
  };
  const handle = glyph.handle(`labs:typegpu-position:${String(nextHandle++)}`, config);
  const labels = Array.from({ length: count }, (_, index) =>
    handle.createText({
      font,
      position: [index, 0],
      text: `label ${String(index).padStart(4, '0')}`,
      style: { fontSize: 16 },
    }),
  );
  glyph.shape();
  stats.publications = 0;
  stats.uniformWrites = 0;
  return { handle, labels, stats };
}

group('allocation-light adapter publication @publication', () => {
  bench('normalize 1000 equivalent retained label updates @cached', function* () {
    const count = 1_000;
    const created = createLabels(count);

    const textCount = yield () => {
      for (const label of created.labels) {
        label.style = { fontSize: 16 };
        label.layout = { wrap: 'word' };
        label.constraints = { width: { mode: 'exact', size: 160 } };
      }
      created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, count);

    disposeLabels(created);
  });

  bench('reuse 1000 unchanged Vue property snapshots @vue', function* () {
    const count = 1_000;
    const inputs = Array.from({ length: count }, (_, index) => [
      { fontSize: 16 },
      false,
      { color: index % 2 === 0 ? '#ffffff' : '#eeeeee', decoration: { underline: true } },
    ]);
    const snapshots = inputs.map((input) => snapshotReactivePropertyList(input, 'Labs text style'));

    const reused = yield () => {
      let reusedCount = 0;
      for (let index = 0; index < inputs.length; index++) {
        const previous = snapshots[index]!;
        const next = snapshotReactivePropertyList(inputs[index], 'Labs text style', previous);
        if (next === previous) reusedCount++;
        snapshots[index] = next;
      }
      return reusedCount;
    };
    if (process.env.GLYPH_LABS_ARTIFACT_ROLE === 'candidate') assert.equal(reused, count);
    else assert.equal(reused === 0 || reused === count, true);
  });

  bench('normalize 1000 equivalent formatted flow updates @normalization', function* () {
    const count = 1_000;
    const created = createLabels(count);
    const desired = [0, 1].map(() =>
      created.labels.map((label) => ({
        text: formattedLabel(label.text),
        style: { fontSize: 16 },
        layout: { wrap: 'word' as const },
        constraints: { width: { mode: 'exact' as const, size: 160 } },
        flow: {
          regions: [{ key: 'main', shape: { kind: 'rectangle' as const, bounds: [0, 0, 160, 64] as const } }],
        },
      })),
    );
    let selected = 0;

    const textCount = yield () => {
      selected = selected === 0 ? 1 : 0;
      const next = desired[selected]!;
      for (let index = 0; index < created.labels.length; index++) {
        created.labels[index]!.set(next[index]!);
      }
      created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, count);

    disposeLabels(created);
  });

  bench('create, first-publish, and dispose 1000-label root @cold', function* () {
    const count = 1_000;
    const textCount = yield () => {
      const created = createLabels(count);
      const published = created.textGroup.textCount;
      disposeLabels(created);
      return published;
    };
    assert.equal(textCount, count);
  });

  bench('create, first-publish, and dispose 1000 styled-flow labels @cold-spans', function* () {
    const count = 1_000;
    const textCount = yield () => {
      const created = createLabels(count, 'styled-flow');
      const published = created.textGroup.textCount;
      disposeLabels(created);
      return published;
    };
    assert.equal(textCount, count);
  });

  bench('move 1000 retained TypeGPU labels @position', function* () {
    const count = 1_000;
    const created = createTypeGpuLabels(count);
    let y = 0;

    const result = yield () => {
      const publicationCount = created.stats.publications;
      const uniformWriteCount = created.stats.uniformWrites;
      y = y === 1 ? 2 : 1;
      for (let index = 0; index < created.labels.length; index++) {
        created.labels[index]!.update({ position: [index, y] });
      }
      glyph.shape();
      return {
        publications: created.stats.publications - publicationCount,
        uniformWrites: created.stats.uniformWrites - uniformWriteCount,
      };
    };
    try {
      if (process.env.GLYPH_LABS_ARTIFACT_ROLE === 'baseline') assert.equal(result.publications <= 1, true);
      else assert.equal(result.publications, 0);
      assert.equal(result.uniformWrites, count);
    } finally {
      created.handle.dispose();
    }
  });
});
