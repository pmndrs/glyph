import { bitmap } from '@pmndrs/glyph/raster/bitmap';

import { loadBenchmarkFont as loadFont } from '../../../workloads/font-assets/library';

import canonicalFontUrl from '../../../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url';
import canonicalFontManifest from '../../../../fixtures/fonts/inter-v4.1/manifest.json' with { type: 'json' };
import type { BenchmarkTarget } from '../../contracts';
import { sha256 } from '../shared';

let workerParityReady = false;

/** Proves the public missing-sibling Worker fallback against the authenticated core artifact. */
export function createFontLoaderWorkerConformanceTarget(): BenchmarkTarget {
  return {
    id: 'font-loader-worker',
    label: 'Font loader Worker fallback',
    detail: 'baked miss · module Worker · validated GLB',
    color: 'cyan',
    capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'loader']),
    status: () => 'ready',
    load: async () => {
      if (workerParityReady) return;
      const { bakeFontInWorker } = await import('@pmndrs/glyph/runtime-bake');
      const response = await fetch(canonicalFontUrl);
      if (!response.ok) throw new Error(`Unable to load canonical font fixture (${response.status})`);
      const source = new Uint8Array(await response.arrayBuffer());
      const artifact = await bakeFontInWorker({ source, sourceUrl: canonicalFontUrl });
      if ((await sha256(artifact)) !== canonicalFontManifest.bake.expectedCore.artifactSha256) {
        throw new Error('Browser Worker bytes differ from the canonical Node artifact');
      }
      workerParityReady = true;
    },
    run: async () => {
      let font;
      try {
        const { bakeFontInWorker } = await import('@pmndrs/glyph/runtime-bake');
        font = await loadFont(
          { source: canonicalFontUrl, runtimeBake: bakeFontInWorker },
          { raster: bitmap, options: { strikes: [16] } },
        );
      } catch (error) {
        const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
        throw new Error(
          `Worker fallback failed for ${canonicalFontUrl}: ${error instanceof Error ? error.message : String(error)}${cause === '' ? '' : ` (${cause})`}`,
          { cause: error },
        );
      }
      try {
        if (font.glyphCount !== canonicalFontManifest.bake.expectedCore.glyphCount) {
          throw new Error('Worker fallback loaded an unexpected glyph count');
        }
        return {
          bytes: canonicalFontManifest.bake.expectedCore.artifactBytes,
          hash: canonicalFontManifest.bake.expectedCore.shapingHash,
        };
      } finally {
        font.dispose();
      }
    },
    dispose: async () => undefined,
  };
}
