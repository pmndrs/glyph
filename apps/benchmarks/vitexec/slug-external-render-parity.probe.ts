export {};

const slugCapturePath = '/src/benchmark/targets/conformance/raster/slug-capture.ts';
const environmentPath = '/src/benchmark/environment.ts';
const [{ captureSlugExternalRenderParity }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ slugCapturePath),
  import(/* @vite-ignore */ environmentPath),
]);

const parameters = new URLSearchParams(location.search);
const externalArtifactUrl = parameters.get('slugExternalArtifact');
const expectedUrlsValue = parameters.get('slugExternalExpected');
const artifactsValue = parameters.get('slugExternalArtifacts');
if (externalArtifactUrl === null || expectedUrlsValue === null || artifactsValue === null) {
  throw new Error('Slug external parity probe requires artifact and expected URL parameters');
}
const expectedUrls: unknown = JSON.parse(expectedUrlsValue);
const artifacts: unknown = JSON.parse(artifactsValue);
if (!Array.isArray(expectedUrls) || expectedUrls.length !== 5 || expectedUrls.some((url) => typeof url !== 'string')) {
  throw new TypeError('Slug external parity probe requires exactly five expected URLs');
}
if (!Array.isArray(artifacts) || artifacts.length !== 5) {
  throw new TypeError('Slug external parity probe requires exactly five baked artifacts');
}
const canonicalExpectedUrls = expectedUrls.map((url) => new URL(url, location.href).href).sort();
const cases: Array<Record<string, unknown>> = [];

for (const backend of ['webgpu', 'webgl2'] as const) {
  console.log('slug-external-render-parity-start', backend);
  const fetchedUrls: string[] = [];
  const observedFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    fetchedUrls.push(new URL(url, location.href).href);
    return fetch(input, init);
  };
  const capture = await captureSlugExternalRenderParity({
    backend,
    externalArtifactUrl: new URL(externalArtifactUrl, location.href).href,
    fetch: observedFetch,
  });
  if (!equalBytes(capture.embedded, capture.external)) {
    throw new Error(`${backend} external Slug pixels differ from embedded pixels`);
  }
  const [embeddedHash, externalHash] = await Promise.all([sha256(capture.embedded), sha256(capture.external)]);
  if (embeddedHash !== externalHash) {
    throw new Error(`${backend} external Slug hash differs from the embedded hash`);
  }
  const uniqueFetchedUrls = [...new Set(fetchedUrls)].sort();
  if (!equalStrings(uniqueFetchedUrls, canonicalExpectedUrls)) {
    throw new Error(
      `${backend} fetched the wrong external Slug resources: ${JSON.stringify({ expected: canonicalExpectedUrls, observed: uniqueFetchedUrls })}`,
    );
  }
  if (Object.values(capture.externalSourceTypes).some((type) => type !== 'external')) {
    throw new Error(`${backend} did not load every Slug resource from an external source`);
  }
  if (
    capture.embeddedGlyphCount <= 0 ||
    capture.embeddedGlyphCount !== capture.externalGlyphCount ||
    capture.embeddedEvaluatedCurves <= 0 ||
    capture.embeddedEvaluatedCurves !== capture.externalEvaluatedCurves
  ) {
    throw new Error(`${backend} embedded/external Slug work did not match`);
  }
  const fetches = canonicalExpectedUrls.map((url) => {
    const count = fetchedUrls.filter((fetched) => fetched === url).length;
    if (count !== 1) {
      throw new Error(`${backend} fetched ${stableTransientUrl(url)} ${String(count)} times instead of once`);
    }
    return { url: stableTransientUrl(url), count };
  });
  cases.push({
    backend,
    dpr: 1,
    width: capture.width,
    height: capture.height,
    framebufferHashes: { embedded: embeddedHash, external: externalHash },
    sourceTypes: capture.externalSourceTypes,
    glyphCounts: {
      embedded: capture.embeddedGlyphCount,
      external: capture.externalGlyphCount,
    },
    evaluatedCurves: {
      embedded: capture.embeddedEvaluatedCurves,
      external: capture.externalEvaluatedCurves,
    },
    fetches,
    fetchContract:
      'core, companion, and every page resource exactly once; one target-v1 load feeds both Text and the CPU reference',
    embeddedRenderSubmitMs: capture.embeddedRenderSubmitMs,
    externalRenderSubmitMs: capture.externalRenderSubmitMs,
  });
  console.log('slug-external-render-parity-complete', backend);
}

const gpuAdapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
const gpuAdapterInfo = gpuAdapter?.info;
console.log(
  'slug-external-render-parity-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-external-render-parity-observation',
    capturedAt: new Date().toISOString(),
    authority: 'public-font-loader-and-text-framebuffer',
    environment: await environmentResource(),
    gpuAdapter:
      gpuAdapterInfo === undefined
        ? undefined
        : {
            architecture: gpuAdapterInfo.architecture,
            description: gpuAdapterInfo.description,
            device: gpuAdapterInfo.device,
            vendor: gpuAdapterInfo.vendor,
          },
    artifacts,
    cases,
  }),
);

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stableTransientUrl(value: string): string {
  const file = new URL(value).pathname.split('/').at(-1);
  if (file === undefined || file.length === 0) throw new Error('Fetched Slug URL has no file name');
  return `transient:///${file}`;
}
