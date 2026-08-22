import { FONT_BAKER_VERSION, FONT_FORMAT_VERSION } from '../font-baker/contract.js';

import { copyToOwnedArrayBuffer } from './owned-array-buffer.js';
import { canonicalJson } from './raster-identity.js';
import type { RuntimeBakeRequest } from './runtime-bake-protocol.js';

const CACHE_NAME = `pmndrs-glyph-font-bakes-${FONT_FORMAT_VERSION}-${FONT_BAKER_VERSION}`;
const CACHE_PATH = '/.pmndrs-glyph/font-bakes/';
const EXPIRES_HEADER = 'x-pmndrs-expires-at';
const LENGTH_HEADER = 'x-pmndrs-byte-length';
const ARTIFACT_ID_HEADER = 'x-pmndrs-artifact-id';
const SHA256_HEADER = 'x-pmndrs-sha256';

export interface RuntimeFontCache {
  key(source: Uint8Array, request: RuntimeBakeRequest): Promise<string>;
  match(key: string): Promise<CachedFontArtifact | undefined>;
  put(key: string, artifact: CachedFontArtifact, expiresAt: number): Promise<void>;
}

export interface CachedFontArtifact {
  readonly bytes: Uint8Array;
  readonly id: string;
  readonly sha256: string;
}

/** CacheStorage owns quota eviction; the source response owns whether and how long the derived artifact persists. */
export function createRuntimeFontCache(): RuntimeFontCache | undefined {
  const storage = (globalThis as { readonly caches?: CacheStorage }).caches;
  const origin = (globalThis as { readonly location?: Location }).location?.origin;
  if (storage === undefined || origin === undefined || origin === 'null' || !/^https?:\/\//.test(origin)) {
    return undefined;
  }
  return createCache(storage, origin, () => Date.now());
}

/** @internal Deterministic environment injection for cache policy tests. */
export function createCache(storage: CacheStorage, origin: string, now: () => number): RuntimeFontCache {
  const requestFor = (key: string): Request => new Request(new URL(`${CACHE_PATH}${key}`, origin));
  return {
    async key(source, request) {
      const sourceHash = await sha256(source);
      const identity = canonicalJson({
        face: request.font.fontFaceIndex,
        rasters: request.rasters ?? [],
        sourceHash,
        unicodeRanges: request.unicodeRanges ?? null,
      });
      return sha256(new TextEncoder().encode(identity));
    },
    async match(key) {
      try {
        const cache = await storage.open(CACHE_NAME);
        const request = requestFor(key);
        const response = await cache.match(request);
        if (response === undefined) return undefined;
        const expiresAt = headerInteger(response, EXPIRES_HEADER);
        const byteLength = headerInteger(response, LENGTH_HEADER);
        const id = response.headers.get(ARTIFACT_ID_HEADER);
        const artifactHash = response.headers.get(SHA256_HEADER);
        if (
          expiresAt === undefined ||
          byteLength === undefined ||
          byteLength <= 0 ||
          id === null ||
          id.length === 0 ||
          artifactHash === null ||
          !/^[0-9a-f]{64}$/.test(artifactHash) ||
          now() >= expiresAt
        ) {
          await cache.delete(request);
          return undefined;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength !== byteLength || (await sha256(bytes)) !== artifactHash) {
          await cache.delete(request);
          return undefined;
        }
        return { bytes, id, sha256: artifactHash };
      } catch {
        return undefined;
      }
    },
    async put(key, artifact, expiresAt) {
      const { bytes } = artifact;
      if (bytes.byteLength === 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= now()) return;
      try {
        const cache = await storage.open(CACHE_NAME);
        await cache.put(
          requestFor(key),
          new Response(copyToOwnedArrayBuffer(bytes), {
            headers: {
              'content-type': 'model/gltf-binary',
              [EXPIRES_HEADER]: String(expiresAt),
              [LENGTH_HEADER]: String(bytes.byteLength),
              [ARTIFACT_ID_HEADER]: artifact.id,
              [SHA256_HEADER]: artifact.sha256,
            },
          }),
        );
        await pruneExpired(cache, now());
      } catch {
        // CacheStorage is an optional acceleration. Quota, privacy-mode, and storage failures must not fail baking.
      }
    },
  };
}

async function pruneExpired(cache: Cache, now: number): Promise<void> {
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (response === undefined) continue;
    const expiresAt = headerInteger(response, EXPIRES_HEADER);
    if (expiresAt === undefined || now >= expiresAt) await cache.delete(request);
  }
}

function headerInteger(response: Response, name: string): number | undefined {
  const value = response.headers.get(name);
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copyToOwnedArrayBuffer(bytes)));
  let output = '';
  for (const byte of digest) output += byte.toString(16).padStart(2, '0');
  return output;
}
