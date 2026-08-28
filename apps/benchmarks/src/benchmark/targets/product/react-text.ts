import { createRoot, flushSync, type RootStore } from '@react-three/fiber/webgpu';
import React, { createRef, StrictMode } from 'react';
import * as THREE from 'three/webgpu';

import { createFontLibrary, type FontRequest, type ParagraphLayout } from '@pmndrs/glyph';
import { bitmap, bitmapSchema } from '@pmndrs/glyph/three/bitmap';
import { createUseFont, Text, TextSpan, type BoundUseFont } from '@pmndrs/glyph/react';
import type { ParagraphContentBox, Text as CoreText } from '@pmndrs/glyph/three';

import canonicalParagraphLayout from '../../../../fixtures/contracts/paragraph-layout-v0.json' with { type: 'json' };
import bitmapFontUrl from '../../../../fixtures/rendering/inter-bitmap-16.font.glb?url';
import type { BenchmarkTarget, TargetRunOutput } from '../../contracts';
import { hashParagraphLayout } from '../../paragraph-layout-digest';
import { policyAttribute, policyAttributeName } from '../three-policy-buffer-evidence';
import { createConfiguredRenderer, disposeConfiguredRenderer } from '../../../renderer/webgpu-renderer';

type BitmapTechnique = typeof bitmap;
type BitmapTextObject = CoreText<BitmapTechnique>;

/** The paragraph and its inline run bind one technique, so both elements share one instantiation. */
const BitmapText = Text<BitmapTechnique>;
const BitmapTextSpan = TextSpan<BitmapTechnique>;

const FRAME_WIDTH = 384;
const FRAME_HEIGHT = 128;
const TEXT_PREFIX = 'office ';
const TEXT_ACCENT = 'AVATAR';
const TEXT_SUFFIX = ' café — ffi, kerning, marks, and wrapping.';
const NARROW_WIDTH = 360;
const BITMAP_COLOR_ATTRIBUTE = policyAttributeName(bitmapSchema.buffers.color.id);
/**
 * Target v1 merges a Text update into the state it already holds, so dropping the content box would keep the previous
 * constraint instead of restoring the natural measurement. The unconstrained axis has to be stated.
 */
const NATURAL_CONTENT_BOX: ParagraphContentBox = { width: { mode: 'unconstrained' } };
const fontRequest: FontRequest<BitmapTechnique> = {
  input: { baked: bitmapFontUrl },
  raster: { technique: bitmap, options: { strikes: [16] } },
};

/**
 * Target v1 reports batch failures through `onError` rather than a rejected readiness promise, so the run records the
 * first failure and fails on it instead of hashing whatever partial frame survived.
 */
interface ReactTextFailures {
  error: unknown;
}

interface ReactTextResources {
  readonly canvas: HTMLCanvasElement;
  readonly failures: ReactTextFailures;
  readonly fontHook: BoundUseFont;
  readonly library: ReturnType<typeof createFontLibrary>;
  readonly reference: React.RefObject<BitmapTextObject | null>;
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
      // R3F schedules host disposal at idle priority. Release the paragraph lease explicitly before the target-owned
      // font so teardown remains deterministic; the later host disposal is intentionally idempotent.
      resources.reference.current?.dispose();
      flushSync(() => resources.root.unmount());
      resources.library.dispose();
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
  const failures: ReactTextFailures = { error: undefined };
  const library = createFontLibrary();
  const fontHook = createUseFont(library);
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
      frameloop: 'never',
      orthographic: true,
      renderer,
      size: { height: FRAME_HEIGHT, left: 0, top: 0, width: FRAME_WIDTH },
    });
    await fontHook.preload(fontRequest);
    const reference = createRef<BitmapTextObject>();
    const initial = await renderCommittedText(root, reference, failures, fontHook);
    return { canvas, failures, fontHook, library, reference, renderer, root, store: initial.store };
  } catch (error) {
    flushSync(() => root.unmount());
    library.dispose();
    await disposeConfiguredRenderer(renderer);
    throw error;
  }
}

async function runReconciliation(resources: ReactTextResources): Promise<TargetRunOutput> {
  const core = requiredCoreText(resources.reference);
  const initialLayout = requiredLayout(core);
  assertOracleLayout(initialLayout, 'natural');

  const narrow = await renderCommittedText(
    resources.root,
    resources.reference,
    resources.failures,
    resources.fontHook,
    NARROW_WIDTH,
    '#31d7c5',
  );
  const narrowLayout = requiredLayout(core);
  assertOracleLayout(narrowLayout, 'narrow');
  if (narrow.core !== core || narrowLayout === initialLayout) {
    throw new Error('React Text did not retain its core object across width reflow');
  }

  const restored = await renderCommittedText(
    resources.root,
    resources.reference,
    resources.failures,
    resources.fontHook,
  );
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
    throw new Error(
      `React Text did not preserve its nested-span draw and paint contract: ${drawCount} draws, ${paintCount} paints`,
    );
  }
  const hash = hashParagraphLayout(restoredLayout);
  return {
    bytes: restoredLayout.glyphIds.byteLength,
    hash,
    metrics: {
      coreObjectRetained: 1,
      nestedSpanCount: core.spans.length,
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
  reference: React.RefObject<BitmapTextObject | null>,
  failures: ReactTextFailures,
  fontHook: BoundUseFont,
  width?: number,
  accent = '#ff8a00',
): Promise<{ readonly core: BitmapTextObject; readonly store: RootStore }> {
  const committed = deferred<void>();
  // The host ref is the causal signal that R3F committed the Three object. Compose it here rather than making the
  // component write through a ref prop while React may still replay the surrounding StrictMode commit.
  const publish = (object: BitmapTextObject | null): void => {
    reference.current = object;
    if (object !== null) committed.resolve();
  };
  let store: RootStore | undefined;
  flushSync(() => {
    store = root.render(renderText(publish, failures, fontHook, width, accent));
  });
  // StrictMode may remount after the first host ref callback, so always read the retained object back from the ref.
  await committed.promise;
  const core = requiredCoreText(reference);
  if (store === undefined) throw new Error('R3F did not publish its root store');
  const state = store.getState();
  state.gl.render(state.scene, state.camera);
  if (failures.error !== undefined) throw failures.error;
  return { core, store };
}

function renderText(
  textRef: React.RefCallback<BitmapTextObject>,
  failures: ReactTextFailures,
  fontHook: BoundUseFont,
  width?: number,
  accent = '#ff8a00',
): React.ReactElement {
  return React.createElement(
    StrictMode,
    null,
    React.createElement(
      CommittedText,
      { accent, failures, fontHook, textRef, ...(width === undefined ? {} : { width }) },
      null,
    ),
  );
}

function CommittedText({
  accent,
  failures,
  fontHook,
  textRef,
  width,
}: {
  readonly accent: string;
  readonly failures: ReactTextFailures;
  readonly fontHook: BoundUseFont;
  readonly textRef: React.RefCallback<BitmapTextObject>;
  readonly width?: number;
}): React.ReactElement {
  const font = fontHook(fontRequest);
  return React.createElement(
    BitmapText,
    {
      font,
      onError: (error: unknown) => {
        failures.error ??= error;
      },
      ref: textRef,
      style: {
        fontSize: canonicalParagraphLayout.style.fontSize,
        lineHeight: canonicalParagraphLayout.style.lineHeight,
      },
      contentBox: width === undefined ? NATURAL_CONTENT_BOX : exactContentBox(width),
    },
    TEXT_PREFIX,
    React.createElement(BitmapTextSpan, { paint: { color: accent } }, TEXT_ACCENT),
    TEXT_SUFFIX,
  );
}

/** The oracle pins the narrow measurement to an exact box rather than an upper bound. */
function exactContentBox(size: number): ParagraphContentBox {
  return { width: { mode: 'exact', size } };
}

function matchesFrameFloat(actual: number, oracle: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(oracle)) return actual === oracle;
  return float32UlpDistance(actual, oracle) <= 1;
}

const float32Scratch = new Float32Array(1);
const float32Bits = new Uint32Array(float32Scratch.buffer);

function float32UlpDistance(left: number, right: number): number {
  float32Scratch[0] = left;
  const leftBits = orderedFloat32Bits(float32Bits[0] ?? 0);
  float32Scratch[0] = right;
  const rightBits = orderedFloat32Bits(float32Bits[0] ?? 0);
  return Math.abs(leftBits - rightBits);
}

function orderedFloat32Bits(bits: number): number {
  return (bits & 0x8000_0000) === 0 ? (bits ^ 0x8000_0000) >>> 0 : ~bits >>> 0;
}

function hashWithOracleLineOrigins(layout: ParagraphLayout, oracleBaselines: readonly number[]): string | undefined {
  if (layout.lineBaselines.length !== oracleBaselines.length) return undefined;
  const y = layout.y.slice();
  const lineBaselines = layout.lineBaselines.slice();
  for (let line = 0; line < lineBaselines.length; line += 1) {
    const actual = lineBaselines[line];
    const expected = oracleBaselines[line];
    if (actual === undefined || expected === undefined || !matchesFrameFloat(actual, expected)) return undefined;
    const delta = expected - actual;
    const glyphStart = layout.lineGlyphStarts[line] ?? 0;
    const glyphEnd = glyphStart + (layout.lineGlyphCounts[line] ?? 0);
    for (let glyph = glyphStart; glyph < glyphEnd; glyph += 1) {
      const position = y[glyph];
      if (position === undefined) return undefined;
      y[glyph] = Math.fround(position + delta);
    }
    lineBaselines[line] = Math.fround(expected);
  }
  return hashParagraphLayout({ ...layout, y, lineBaselines });
}

function assertOracleLayout(layout: ParagraphLayout, state: 'natural' | 'narrow'): void {
  const oracle = canonicalParagraphLayout.goldens[state];
  const hash = hashParagraphLayout(layout);
  const compatibleHash = hashWithOracleLineOrigins(layout, oracle.layout.lineBaselines);
  const expectedWidth = state === 'narrow' ? NARROW_WIDTH : oracle.measurement.width;
  if (
    (hash !== oracle.layout.hash && compatibleHash !== oracle.layout.hash) ||
    layout.glyphIds.length !== oracle.layout.glyphCount ||
    !matchesFrameFloat(layout.width, expectedWidth) ||
    !matchesFrameFloat(layout.contentWidth, oracle.measurement.contentWidth) ||
    !matchesFrameFloat(layout.height, oracle.measurement.height)
  ) {
    throw new Error(
      `React Text ${state} layout differs from the pinned paragraph oracle: ` +
        `hash ${hash}/${oracle.layout.hash}, glyphs ${layout.glyphIds.length}/${oracle.layout.glyphCount}, ` +
        `size ${layout.width}×${layout.height}/${expectedWidth}×${oracle.measurement.height}, ` +
        `content width ${layout.contentWidth}/${oracle.measurement.contentWidth}`,
    );
  }
}

function requiredCoreText(reference: React.RefObject<BitmapTextObject | null>): BitmapTextObject {
  if (reference.current === null) throw new Error('React Text core object is unavailable');
  return reference.current;
}

function requiredLayout(core: BitmapTextObject): ParagraphLayout {
  const layout = core.glyphs();
  if (layout === undefined) throw new Error('React Text layout inspection is unavailable');
  return layout;
}

function countDraws(object: BitmapTextObject): number {
  let count = 0;
  object.traverse((child) => {
    if (child.type === 'Mesh') count += 1;
  });
  return count;
}

function countUniquePaints(object: BitmapTextObject): number {
  const paints = new Set<string>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const colors = policyAttribute(child.geometry, BITMAP_COLOR_ATTRIBUTE);
    if (colors === undefined) return;
    // One physical batch backs every run of a paragraph, so a draw reads its own window of the shared paint buffer.
    const start = (child.userData.pmndrsGlyphRunStart as number | undefined) ?? 0;
    const instanceCount =
      child.geometry instanceof THREE.InstancedBufferGeometry ? child.geometry.instanceCount : colors.count;
    if (start + instanceCount > colors.count) {
      throw new Error(
        `React Text submits instances ${start}..${start + instanceCount} from a ${colors.count}-entry paint buffer`,
      );
    }
    for (let instance = start; instance < start + instanceCount; instance += 1) {
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
