import { createRoot, flushSync, type RootStore } from '@react-three/fiber/webgpu';
import React, { createRef, StrictMode, useLayoutEffect } from 'react';
import * as THREE from 'three/webgpu';

import { Text as CoreText, defineFont, type ParagraphLayout } from '@pmndrs/text';
import { Text, useFont } from '@pmndrs/text/react';
import { bitmap } from '@pmndrs/text/raster/bitmap';

import canonicalParagraphLayout from '../../fixtures/contracts/paragraph-layout-v0.json';
import bitmapFontUrl from '../../fixtures/rendering/inter-bitmap-16.font.glb?url';
import type { BenchmarkTarget, TargetRunOutput } from '../benchmark/contracts';
import { hashParagraphLayout } from '../benchmark/paragraph-layout-digest';
import { createConfiguredRenderer, disposeConfiguredRenderer } from './webgpu-renderer';

const FRAME_WIDTH = 384;
const FRAME_HEIGHT = 128;
const TEXT_PREFIX = 'office ';
const TEXT_ACCENT = 'AVATAR';
const TEXT_SUFFIX = ' café — ffi, kerning, marks, and wrapping.';

interface ReactTextResources {
  readonly canvas: HTMLCanvasElement;
  readonly font: Awaited<ReturnType<typeof useFont.preload>>;
  readonly fontToken: ReturnType<typeof defineFont>;
  readonly reference: React.RefObject<CoreText | null>;
  readonly renderer: THREE.WebGPURenderer;
  readonly root: ReturnType<typeof createRoot>;
  readonly store: RootStore;
}

type ReactTextState = { readonly kind: 'empty' } | { readonly kind: 'ready'; readonly resources: ReactTextResources };

export function createReactTextTarget(): BenchmarkTarget {
  let state: ReactTextState = { kind: 'empty' };
  return {
    id: 'react-text-reconciliation',
    label: 'React Text reconciliation',
    detail: 'React 19 · R3F · WebGPURenderer · pinned paragraph oracle',
    color: 'violet',
    capabilities: new Set(['deterministic', 'loader', 'shaping', 'paragraph', 'raster']),
    status: () => 'ready',
    load: async (controls) => {
      if (state.kind === 'ready') return;
      state = { kind: 'ready', resources: await createResources(controls.dpr) };
    },
    run: async () => {
      if (state.kind !== 'ready') throw new Error('React Text target was not loaded');
      return runReconciliation(state.resources);
    },
    dispose: async () => {
      if (state.kind !== 'ready') return;
      const resources = state.resources;
      state = { kind: 'empty' };
      flushSync(() => resources.root.unmount());
      resources.font.font.dispose();
      useFont.clear(resources.fontToken);
      await disposeConfiguredRenderer(resources.renderer);
    },
  };
}

async function createResources(dpr: number): Promise<ReactTextResources> {
  const canvas = document.createElement('canvas');
  const renderer = await createConfiguredRenderer({
    backend: 'webgl2',
    canvas,
    dpr,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
  });
  const root = createRoot(canvas);
  const fontToken = defineFont(bitmapFontUrl, bitmap({ strikes: [16] as const }));
  let font: Awaited<ReturnType<typeof useFont.preload>> | undefined;
  try {
    await root.configure({
      camera: {
        bottom: FRAME_HEIGHT,
        far: 100,
        left: 0,
        near: -100,
        position: [0, 0, 10],
        right: FRAME_WIDTH,
        top: 0,
      },
      dpr,
      flat: true,
      frameloop: 'never',
      orthographic: true,
      renderer,
      size: { height: FRAME_HEIGHT, left: 0, top: 0, width: FRAME_WIDTH },
    });
    font = await useFont.preload(fontToken);
    const reference = createRef<CoreText>();
    const initial = await renderCommittedText(root, fontToken, reference);
    await initial.core.ready;
    return { canvas, font, fontToken, reference, renderer, root, store: initial.store };
  } catch (error) {
    flushSync(() => root.unmount());
    font?.font.dispose();
    useFont.clear(fontToken);
    await disposeConfiguredRenderer(renderer);
    throw error;
  }
}

async function runReconciliation(resources: ReactTextResources): Promise<TargetRunOutput> {
  const core = requiredCoreText(resources.reference);
  const initialLayout = requiredLayout(core);
  assertOracleLayout(initialLayout, 'natural');

  const narrow = await renderCommittedText(resources.root, resources.fontToken, resources.reference, 360, '#31d7c5');
  await narrow.core.ready;
  const narrowLayout = requiredLayout(core);
  assertOracleLayout(narrowLayout, 'narrow');
  if (narrow.core !== core || narrowLayout === initialLayout) {
    throw new Error('React Text did not retain its core object across width reflow');
  }

  const restored = await renderCommittedText(resources.root, resources.fontToken, resources.reference);
  await restored.core.ready;
  const restoredLayout = requiredLayout(core);
  assertOracleLayout(restoredLayout, 'natural');
  if (restored.core !== core) throw new Error('React Text replaced its core object during restore');

  resources.renderer.setRenderTarget(null);
  resources.renderer.setClearColor(0x000000, 1);
  resources.renderer.clear();
  const drawCallsBeforeFrame = resources.renderer.info.render.drawCalls;
  resources.renderer.render(resources.store.getState().scene, resources.store.getState().camera);
  const r3fDrawCalls = resources.renderer.info.render.drawCalls - drawCallsBeforeFrame;
  if (r3fDrawCalls < 1) {
    throw new Error('R3F React Text frame did not submit a draw');
  }

  const drawCount = countDraws(core);
  const paintCount = countUniquePaints(core);
  if (drawCount !== 1 || paintCount !== 2) {
    throw new Error('React Text did not preserve its nested-span draw and paint contract');
  }
  const hash = hashParagraphLayout(restoredLayout);
  return {
    bytes: restoredLayout.glyphIds.byteLength,
    hash,
    metrics: {
      coreObjectRetained: 1,
      nestedSpanCount: 1,
      glyphCount: restoredLayout.glyphIds.length,
      drawCount,
      paintCount,
      widthReflowed: 1,
      layoutRestored: 1,
      oracleNaturalMatched: 1,
      oracleNarrowMatched: 1,
      r3fDrawCalls,
    },
  };
}

async function renderCommittedText(
  root: ReturnType<typeof createRoot>,
  font: ReturnType<typeof defineFont>,
  reference: React.RefObject<CoreText | null>,
  width?: number,
  accent = '#ff8a00',
): Promise<{ readonly core: CoreText; readonly store: RootStore }> {
  const committed = deferred<CoreText>();
  let store: RootStore | undefined;
  flushSync(() => {
    store = root.render(renderText(font, reference, committed.resolve, width, accent));
  });
  const core = await committed.promise;
  if (store === undefined) throw new Error('R3F did not publish its root store');
  return { core, store };
}

function renderText(
  font: ReturnType<typeof defineFont>,
  reference: React.RefObject<CoreText | null>,
  onCommit: (core: CoreText) => void,
  width?: number,
  accent = '#ff8a00',
): React.ReactElement {
  return React.createElement(
    StrictMode,
    null,
    React.createElement(
      CommittedText,
      { accent, font, onCommit, reference, ...(width === undefined ? {} : { width }) },
      null,
    ),
  );
}

function CommittedText({
  accent,
  font,
  onCommit,
  reference,
  width,
}: {
  readonly accent: string;
  readonly font: ReturnType<typeof defineFont>;
  readonly onCommit: (core: CoreText) => void;
  readonly reference: React.RefObject<CoreText | null>;
  readonly width?: number;
}): React.ReactElement {
  useLayoutEffect(() => {
    onCommit(requiredCoreText(reference));
  }, [onCommit, reference]);
  return React.createElement(
    Text,
    {
      font,
      fontSize: canonicalParagraphLayout.style.fontSize,
      lineHeight: canonicalParagraphLayout.style.lineHeight,
      ref: reference,
      ...(width === undefined ? {} : { width }),
    },
    TEXT_PREFIX,
    React.createElement(Text, { color: accent }, TEXT_ACCENT),
    TEXT_SUFFIX,
  );
}

function assertOracleLayout(layout: ParagraphLayout, state: 'natural' | 'narrow'): void {
  const oracle = canonicalParagraphLayout.goldens[state];
  const hash = hashParagraphLayout(layout);
  const expectedWidth = state === 'narrow' ? 360 : oracle.measurement.width;
  if (
    hash !== oracle.layout.hash ||
    layout.glyphIds.length !== oracle.layout.glyphCount ||
    layout.width !== expectedWidth ||
    layout.contentWidth !== oracle.measurement.contentWidth ||
    layout.height !== oracle.measurement.height
  ) {
    throw new Error(
      `React Text ${state} layout differs from the pinned paragraph oracle: ` +
        `hash ${hash}/${oracle.layout.hash}, glyphs ${layout.glyphIds.length}/${oracle.layout.glyphCount}, ` +
        `size ${layout.width}×${layout.height}/${expectedWidth}×${oracle.measurement.height}, ` +
        `content width ${layout.contentWidth}/${oracle.measurement.contentWidth}`,
    );
  }
}

function requiredCoreText(reference: React.RefObject<CoreText | null>): CoreText {
  if (reference.current === null) throw new Error('React Text core object is unavailable');
  return reference.current;
}

function requiredLayout(core: CoreText): NonNullable<CoreText['layout']> {
  if (core.layout === undefined) throw new Error('React Text layout is unavailable');
  return core.layout;
}

function countDraws(object: CoreText): number {
  let count = 0;
  object.traverse((child) => {
    if (child.type === 'Mesh') count += 1;
  });
  return count;
}

function countUniquePaints(object: CoreText): number {
  const paints = new Set<string>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const colors = child.geometry.getAttribute('bitmapColor');
    if (colors === undefined) return;
    for (let instance = 0; instance < colors.count; instance += 1) {
      paints.add(
        [colors.getX(instance), colors.getY(instance), colors.getZ(instance), colors.getW(instance)].join(','),
      );
    }
  });
  return paints.size;
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}
