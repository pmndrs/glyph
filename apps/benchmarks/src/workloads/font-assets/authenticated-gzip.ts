import type { AuthenticatedArtifactSize } from './contracts';

export async function fetchAuthenticatedGzipAsset(
  url: string,
  manifest: { readonly compressed: AuthenticatedArtifactSize; readonly uncompressed: AuthenticatedArtifactSize },
  label: string,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, signal === undefined ? undefined : { signal });
  if (!response.ok) throw new Error(`Unable to load ${label} (${response.status})`);
  const received = new Uint8Array(await response.arrayBuffer());
  signal?.throwIfAborted();
  const artifact =
    received.byteLength === manifest.uncompressed.bytes ? received : await decompressFixture(received, manifest, label);
  await assertFixtureBytes(artifact, manifest.uncompressed, label, 'uncompressed');
  signal?.throwIfAborted();
  return artifact;
}

export async function preloadFontAssetUrls(
  urls: readonly string[],
  label: string,
  signal?: AbortSignal,
): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url, signal === undefined ? undefined : { signal });
      if (!response.ok) throw new Error(`Unable to preload ${label} (${response.status})`);
      await response.arrayBuffer();
      signal?.throwIfAborted();
    }),
  );
}

async function decompressFixture(
  compressed: Uint8Array<ArrayBuffer>,
  manifest: { readonly compressed: AuthenticatedArtifactSize },
  label: string,
): Promise<Uint8Array<ArrayBuffer>> {
  await assertFixtureBytes(compressed, manifest.compressed, label, 'compressed');
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function assertFixtureBytes(
  bytes: Uint8Array<ArrayBuffer>,
  expected: AuthenticatedArtifactSize,
  label: string,
  stage: 'compressed' | 'uncompressed',
): Promise<void> {
  if (bytes.byteLength !== expected.bytes) {
    throw new Error(
      `${label} ${stage} fixture has ${String(bytes.byteLength)} bytes; expected ${String(expected.bytes)}`,
    );
  }
  const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
  if (hash !== expected.sha256) throw new Error(`${label} ${stage} fixture failed SHA-256`);
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0')).join('');
}
