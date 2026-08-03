import {
  createComparisonWorkloadPersistentScene,
  type ComparisonWorkloadConfiguration,
  type ComparisonWorkloadId,
  type ComparisonWorkloadPersistentSceneOptions,
  type ComparisonWorkloadStats,
} from '../../surfaces/benchmark/scenes/comparison-workload';
import { createPersistentRenderHost } from '../../renderer/persistent-render-host';

/**
 * Measurement-only adapter for probes that need an isolated canvas. The retained
 * workload scene remains renderer-agnostic; this adapter owns the host lifecycle.
 */
export interface ComparisonWorkloadPreview {
  dispose(): Promise<void>;
  panBy(deltaX: number, deltaY: number): { readonly deltaX: number; readonly deltaY: number } | void;
  resetView(): void;
  resize(width: number, height: number): void;
  update(configuration: ComparisonWorkloadConfiguration): Promise<void>;
  zoomBy(factor: number): void;
}

export interface ComparisonWorkloadPreviewOptions extends ComparisonWorkloadPersistentSceneOptions {
  readonly canvas: HTMLCanvasElement;
  readonly dpr: number;
  readonly height: number;
  readonly signal?: AbortSignal;
  readonly width: number;
}

export type { ComparisonWorkloadConfiguration, ComparisonWorkloadId, ComparisonWorkloadStats };

export async function createComparisonWorkloadPreview(
  options: ComparisonWorkloadPreviewOptions,
): Promise<ComparisonWorkloadPreview> {
  const { canvas, dpr, height, signal, width, ...sceneOptions } = options;
  const host = await createPersistentRenderHost({
    backend: options.backend,
    canvas,
    dpr,
    height,
    onError: options.onError,
    width,
  });
  const scene = createComparisonWorkloadPersistentScene(sceneOptions);
  try {
    const lease = await host.replaceScene(scene, signal);
    let disposal: Promise<void> | undefined;
    return {
      panBy(deltaX, deltaY) {
        return scene.panBy(deltaX, deltaY);
      },
      resetView() {
        scene.resetView();
      },
      resize(nextWidth, nextHeight) {
        host.resize(nextWidth, nextHeight);
      },
      update(configuration) {
        return scene.update(configuration);
      },
      zoomBy(factor) {
        scene.zoomBy(factor);
      },
      dispose() {
        disposal ??= (async () => {
          try {
            await lease.release();
          } finally {
            await host.dispose();
          }
        })();
        return disposal;
      },
    };
  } catch (error) {
    await host.dispose();
    throw error;
  }
}
