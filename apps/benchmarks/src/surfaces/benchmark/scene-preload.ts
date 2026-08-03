import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { FontDelivery, HarnessLocation, RasterTechnique } from '../../benchmark/url-state';
import { benchmarkWorkloadDefinition, isBenchmarkWorkloadId } from '../../workloads/catalog';

let comparisonWorkloadModule: ReturnType<typeof importComparisonWorkload> | undefined;
const liveSceneAssetResources = new Map<string, Promise<void>>();

function importComparisonWorkload() {
  return import('./scenes/comparison-workload');
}

export function loadBenchmarkFontAssets() {
  return import('../../workloads/font-assets');
}

export function preloadComparisonWorkload(): ReturnType<typeof importComparisonWorkload> {
  comparisonWorkloadModule ??= importComparisonWorkload();
  return comparisonWorkloadModule;
}

export function scheduleComparisonWorkloadPreload(): () => void {
  if (globalThis.requestIdleCallback === undefined) return () => undefined;
  const request = globalThis.requestIdleCallback(() => {
    void preloadComparisonWorkload();
  });
  return () => globalThis.cancelIdleCallback(request);
}

export function liveSceneAssetResource(
  technique: RasterTechnique,
  delivery: FontDelivery,
  fontFixture: BenchmarkFontFixture,
  workload: HarnessLocation['workload'],
): Promise<void> {
  const definition = isBenchmarkWorkloadId(workload) ? benchmarkWorkloadDefinition(workload) : undefined;
  const fixtures =
    definition?.fontPolicy.kind === 'icon-grid' ? [fontFixture, definition.fontPolicy.iconFixture] : [fontFixture];
  const comparison = definition?.surface === 'comparison';
  const key = `${technique}:${delivery}:${fixtures.join(',')}:${String(comparison)}`;
  const existing = liveSceneAssetResources.get(key);
  if (existing !== undefined) return existing;
  const resource = (async () => {
    if (comparison) await preloadComparisonWorkload();
    if (delivery !== 'baked') return;
    const { preloadBenchmarkFontAssets } = await loadBenchmarkFontAssets();
    await preloadBenchmarkFontAssets({ technique, fixtures, bitmapDensity: 'live' });
  })();
  liveSceneAssetResources.set(key, resource);
  void resource.catch(() => liveSceneAssetResources.delete(key));
  return resource;
}
