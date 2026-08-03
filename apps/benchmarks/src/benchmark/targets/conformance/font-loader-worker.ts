import { FontLoader, FontRegistry } from '@pmndrs/text';

import canonicalFontUrl from '../../../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url';
import canonicalFontManifest from '../../../../fixtures/fonts/inter-v4.1/manifest.json';
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
      const { bakeFontInWorker } = await import('@pmndrs/text/runtime-bake');
      const response = await fetch(canonicalFontUrl);
      if (!response.ok) throw new Error(`Unable to load canonical font fixture (${response.status})`);
      const source = new Uint8Array(await response.arrayBuffer());
      const artifact = await bakeFontInWorker({ source, sourceUrl: canonicalFontUrl });
      if ((await sha256(artifact)) !== canonicalFontManifest.bake.expectedCore.artifactSha256) {
        throw new Error('Browser Worker bytes differ from the canonical Node artifact');
      }
      const font = await new FontRegistry().registerAsset(artifact);
      try {
        if (font.shapingHash !== canonicalFontManifest.bake.expectedCore.shapingHash) {
          throw new Error('Browser Worker artifact retained an unexpected shaping identity');
        }
      } finally {
        font.dispose();
      }
      workerParityReady = true;
    },
    run: async () => {
      let font;
      try {
        font = await new FontLoader({ development: false }).load(canonicalFontUrl);
      } catch (error) {
        const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
        throw new Error(
          `Worker fallback failed for ${canonicalFontUrl}: ${error instanceof Error ? error.message : String(error)}${cause === '' ? '' : ` (${cause})`}`,
          { cause: error },
        );
      }
      try {
        if (font.shapingHash !== canonicalFontManifest.bake.expectedCore.shapingHash) {
          throw new Error('Worker fallback registered an unexpected shaping identity');
        }
        return { bytes: canonicalFontManifest.bake.expectedCore.artifactBytes, hash: font.shapingHash };
      } finally {
        font.dispose();
      }
    },
    dispose: async () => undefined,
  };
}
