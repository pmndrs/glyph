import type { Text } from '@pmndrs/text';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';

import type { ComparisonWorkloadConfiguration } from './comparison/contracts';
import type { ComparisonWorkloadEntry } from './shared/scene-entry';
import {
  createIconGridWorkloadInstance,
  iconGridContent,
  type IconGridEntryPool,
  type IconGridVirtualWindow,
} from './icon-grid/scene';

const viewport = { height: 360, width: 720 };
const configuration: ComparisonWorkloadConfiguration = {
  amount: 50,
  animationEnabled: true,
  animationSpeed: 50,
  fontFixture: 'inter',
  fontSize: 48,
  iconGridView: 'origin',
  layoutWidthRatio: 0.8,
  paintOpacity: 1,
  paintShadowEnabled: true,
  paintStrokeWidth: 0.5,
  showGrid: true,
  showLayoutBounds: true,
  textLadderExitEnabled: false,
  workload: 'icon-grid',
};

describe('retained Icon Grid workload instance', () => {
  it('keeps virtual-window state isolated between independently mounted scenes', () => {
    const left = createFixture();
    const alternateConfiguration = { ...configuration, iconGridView: 'alternate' } as const;
    const right = createFixture({ configuration: alternateConfiguration });
    const leftWindow = left.instance.activate(configuration, viewport);
    const rightWindow = right.instance.activate(alternateConfiguration, viewport);
    left.scene.position.set(-leftWindow.scrollX, leftWindow.scrollY, 0);
    right.scene.position.set(-rightWindow.scrollX, rightWindow.scrollY, 0);
    left.instance.settle(configuration, viewport, left.scene);
    right.instance.settle(alternateConfiguration, viewport, right.scene);
    const rightBefore = right.instance.metrics(viewport, right.scene);

    left.scene.position.x -= leftWindow.layout.cellWidth + leftWindow.layout.gap;
    left.instance.requestRefresh(configuration, viewport, left.scene, fail);

    expect(left.instance.metrics(viewport, left.scene).assignmentSignature).not.toBe('[]');
    expect(right.instance.metrics(viewport, right.scene)).toEqual(rightBefore);
  });

  it('keeps the committed window when cold pool growth fails', async () => {
    const fixture = createFixture({ resize: async () => Promise.reject(new Error('cold pool failure')) });
    const initial = fixture.instance.activate(configuration, viewport);
    fixture.scene.position.set(-initial.scrollX, initial.scrollY, 0);
    fixture.instance.settle(configuration, viewport, fixture.scene);
    const before = fixture.instance.metrics(viewport, fixture.scene);

    await expect(
      fixture.instance.reconfigure(configuration, { ...configuration, fontSize: 64 }, viewport, fixture.scene),
    ).rejects.toThrow('cold pool failure');

    expect(fixture.instance.metrics(viewport, fixture.scene)).toEqual(before);
    expect(fixture.scene.position.toArray()).toEqual([-initial.scrollX, initial.scrollY, 0]);
  });

  it('does not publish a refresh after its mount is no longer current', async () => {
    let current = true;
    let releaseResize: (() => void) | undefined;
    const fixture = createFixture({
      isCurrent: () => current,
      resize: async () => new Promise<void>((resolve) => (releaseResize = resolve)),
    });
    const initial = fixture.instance.activate(configuration, viewport);
    fixture.scene.position.set(-initial.scrollX, initial.scrollY, 0);
    fixture.instance.settle(configuration, viewport, fixture.scene);
    const before = fixture.instance.metrics(viewport, fixture.scene);

    const reconfigure = fixture.instance.reconfigure(
      configuration,
      { ...configuration, fontSize: 64 },
      viewport,
      fixture.scene,
    );
    current = false;
    releaseResize?.();
    await reconfigure;

    expect(fixture.instance.metrics(viewport, fixture.scene)).toEqual(before);
  });
});

function createFixture({
  configuration: fixtureConfiguration = configuration,
  isCurrent = () => true,
  resize,
}: {
  readonly configuration?: ComparisonWorkloadConfiguration;
  readonly isCurrent?: () => boolean;
  readonly resize?: IconGridEntryPool['resize'];
} = {}) {
  const scene = new THREE.Scene();
  const initialWindow = createWindow(fixtureConfiguration);
  let entries = Array.from({ length: initialWindow.poolCapacity }, (_, poolIndex) =>
    createEntry(initialWindow.indices[poolIndex] ?? 0, initialWindow.indices[poolIndex]),
  );
  const pool: IconGridEntryPool = {
    entries: () => entries,
    resize:
      resize ??
      (async (poolCapacity) => {
        entries = entries.slice(0, poolCapacity);
      }),
  };
  return { instance: createIconGridWorkloadInstance(pool, isCurrent), scene };
}

function createEntry(index: number, virtualIconIndex = index): ComparisonWorkloadEntry {
  const text = createText();
  const labelText = createText();
  const node = new THREE.Group();
  const { content } = iconGridContent(index);
  return {
    labelText,
    node,
    role: 'primary',
    sourceText: content,
    text,
    ...(virtualIconIndex === undefined ? {} : { virtualIconIndex }),
  };
}

function createText(): Text {
  const text = new THREE.Object3D() as unknown as Text;
  Object.assign(text, {
    layout: { width: 48 },
    setProperties: vi.fn<(properties: { readonly text?: string }) => void>(),
  });
  return text;
}

function createWindow(fixtureConfiguration: ComparisonWorkloadConfiguration): IconGridVirtualWindow {
  const instance = createIconGridWorkloadInstance({ entries: () => [], resize: async () => undefined }, () => true);
  return instance.activate(fixtureConfiguration, viewport);
}

function fail(error: unknown): never {
  throw error;
}
