import type { Font, RasterFormatInput, RasterFormatMetadata } from '@pmndrs/glyph';
import {
  createFontLibrary,
  type FontLoadOptions,
  type LoadFontInput,
  type RuntimeFontBake,
  type RuntimeFontBakeRequest,
} from '../../../../../packages/glyph/src/loader.js';

import { benchmarkFontArtifactByteLimit } from './limits';

/** Application-lifetime font cache; the custom fetch presents checked-in gzip fixtures as their decoded GLB response, so the artifact URL alone serves as stable cache identity. */
export const benchmarkFontLibrary = createFontLibrary({
  fetch: fetchBenchmarkFont,
  maxArtifactBytes: benchmarkFontArtifactByteLimit,
});

export type { RuntimeFontBake, RuntimeFontBakeRequest };

/** Benchmark-only access to the package-private loader with harness transport and limits applied. */
export function loadBenchmarkFont<Format extends RasterFormatMetadata>(
  input: LoadFontInput,
  raster: RasterFormatInput<Format>,
  options?: FontLoadOptions,
): Promise<Font<Format>> {
  return benchmarkFontLibrary.loadFont(input, raster, options);
}

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
