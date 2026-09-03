import { createFontLibrary } from '@pmndrs/glyph';

import { benchmarkFontArtifactByteLimit } from './limits';

/**
 * Application-lifetime cache for benchmark fonts.
 *
 * Technique scenes are intentionally short-lived; transport and decoded font backings are not.
 * The custom fetch presents checked-in gzip fixtures as their decoded GLB response, which lets the
 * library use the artifact URL as its stable cache identity without retaining a second byte cache.
 */
export const benchmarkFontLibrary = createFontLibrary({
  fetch: fetchBenchmarkFont,
  maxArtifactBytes: benchmarkFontArtifactByteLimit,
});

if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => benchmarkFontLibrary.dispose());
}

async function fetchBenchmarkFont(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (!response.ok || response.body === null || !isEncodedGzipFixture(input, response)) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip')), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function isEncodedGzipFixture(input: RequestInfo | URL, response: Response): boolean {
  if (response.headers.has('content-encoding')) return false;
  const url = input instanceof Request ? input.url : String(input);
  return /\.font\.glb\.gz(?:\?|$)/u.test(url);
}
