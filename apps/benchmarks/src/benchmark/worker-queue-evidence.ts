import { bakeFontInWorker } from '@pmndrs/text/runtime-bake';

import canonicalFontUrl from '../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url';
import canonicalFontManifest from '../../fixtures/fonts/inter-v4.1/manifest.json' with { type: 'json' };

export interface WorkerQueueEvidence {
  readonly artifactHash: string;
  readonly batchSize: number;
  readonly queuedMs: number;
  readonly sequentialMs: number;
}

export async function measureWorkerQueue(): Promise<WorkerQueueEvidence> {
  const response = await fetch(canonicalFontUrl);
  if (!response.ok) throw new Error(`Unable to load canonical font fixture (${response.status})`);
  const source = new Uint8Array(await response.arrayBuffer());
  const expectedHash = canonicalFontManifest.bake.expectedCore.artifactSha256;

  async function bake(): Promise<void> {
    const artifact = await bakeFontInWorker({ source, sourceUrl: canonicalFontUrl });
    const owned = new Uint8Array(artifact.byteLength);
    owned.set(new Uint8Array(artifact.buffer, artifact.byteOffset, artifact.byteLength));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer))]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    if (hash !== expectedHash) throw new Error('Queued Worker bake changed canonical artifact bytes');
  }

  async function measure(operation: () => Promise<void>): Promise<number> {
    const started = performance.now();
    await operation();
    return performance.now() - started;
  }

  await bake();
  const sequentialMs = await measure(async () => {
    for (let index = 0; index < 3; index += 1) await bake();
  });
  const queuedMs = await measure(async () => {
    await Promise.all([bake(), bake(), bake()]);
  });

  return { artifactHash: expectedHash, batchSize: 3, queuedMs, sequentialMs };
}
