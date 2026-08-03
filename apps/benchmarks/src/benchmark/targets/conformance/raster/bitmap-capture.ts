import { conformanceText, type BenchmarkFontFixture, type SelectableFontFixture } from '../../../font-fixtures';
import {
  captureBitmapFiniteScene,
  BITMAP_FINITE_HEIGHT,
  BITMAP_FINITE_WIDTH,
  createBitmapFiniteScene,
  disposeBitmapFiniteScene,
  renderBitmapFiniteFrame,
  type BitmapFiniteSceneCapture,
} from '../../../low-level/raster/bitmap-finite-scene';
import {
  captureSourceOutlineFidelity,
  type SourceOutlineFidelityCapture,
} from '../../../low-level/raster/source-outline-reference';
import type { FontDelivery } from '../../../url-state';
import type { PersistentRenderSceneRenderer } from '../../../../renderer/persistent-render-host';
import type { RendererBackend } from '../../../../renderer/webgpu-renderer';

/** Bitmap finite conformance output, produced with a leased persistent renderer when supplied. */
export type BitmapTextConformanceCapture = BitmapFiniteSceneCapture;

export async function captureBitmapTextConformance(options: {
  readonly backend: RendererBackend;
  readonly delivery?: FontDelivery;
  readonly dpr: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<BitmapTextConformanceCapture> {
  options.signal?.throwIfAborted();
  const resources = await createBitmapFiniteScene(options);
  try {
    options.signal?.throwIfAborted();
    const capture = await captureBitmapFiniteScene(resources);
    options.signal?.throwIfAborted();
    return capture;
  } finally {
    await disposeBitmapFiniteScene(resources);
  }
}

export async function captureBitmapSourceOutlineFidelity(options: {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly fontFixture: SelectableFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<SourceOutlineFidelityCapture> {
  options.signal?.throwIfAborted();
  const resources = await createBitmapFiniteScene({ ...options, delivery: 'baked' });
  try {
    const width = Math.round(BITMAP_FINITE_WIDTH * options.dpr);
    const height = Math.round(BITMAP_FINITE_HEIGHT * options.dpr);
    const rendered = await renderBitmapFiniteFrame(resources, width, height);
    options.signal?.throwIfAborted();
    return await captureSourceOutlineFidelity({
      candidate: rendered.bytes,
      width,
      height,
      dpr: options.dpr,
      fontFixture: options.fontFixture,
      fontSize: resources.line.cssFontSize,
      direction: 'ltr',
      layout: resources.line.layout,
      originX: resources.line.object.position.x,
      originY: resources.line.object.position.y,
      text: conformanceText(),
      renderSubmitMs: rendered.renderMs,
    });
  } finally {
    await disposeBitmapFiniteScene(resources);
  }
}
