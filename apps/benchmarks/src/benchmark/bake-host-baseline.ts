import { bakeFontInWorker } from '@pmndrs/glyph/runtime-bake';
import canonicalFontUrl from '../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url';
import canonicalFontManifest from '../../fixtures/fonts/inter-v4.1/manifest.json' with { type: 'json' };

export interface WorkerBakeHostSample {
  readonly coldMs: number;
  readonly warmMs: number;
  readonly artifactBytes: number;
  readonly artifactSha256: string;
}

export async function measureWorkerBakeHost(): Promise<WorkerBakeHostSample> {
  const response = await fetch(canonicalFontUrl);
  if (!response.ok) throw new Error(`Unable to load canonical font fixture (${response.status})`);
  const source = new Uint8Array(await response.arrayBuffer());
  const started = performance.now();
  const coldPromise = bakeFontInWorker({ source, sourceUrl: canonicalFontUrl });
  const warmPromise = bakeFontInWorker({ source, sourceUrl: canonicalFontUrl });
  const coldArtifact = await coldPromise;
  const coldFinished = performance.now();
  const warmArtifact = await warmPromise;
  const warmFinished = performance.now();
  const [coldHash, warmHash] = await Promise.all([sha256(coldArtifact), sha256(warmArtifact)]);
  const expected = canonicalFontManifest.bake.expectedCore;
  if (
    coldHash !== expected.artifactSha256 ||
    warmHash !== expected.artifactSha256 ||
    coldArtifact.byteLength !== expected.artifactBytes ||
    warmArtifact.byteLength !== expected.artifactBytes
  ) {
    throw new Error('Worker cold/warm artifacts differ from the canonical font bake');
  }
  return {
    coldMs: coldFinished - started,
    warmMs: warmFinished - coldFinished,
    artifactBytes: coldArtifact.byteLength,
    artifactSha256: coldHash,
  };
}

async function sha256(bytes: ArrayBufferView): Promise<string> {
  const owned = Uint8Array.from(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const digest = await crypto.subtle.digest('SHA-256', owned);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
