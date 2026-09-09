import { FONT_BAKER_VERSION, FONT_FORMAT_VERSION } from '../font-baker/contract.js';

import { copyToOwnedArrayBuffer } from './owned-array-buffer.js';
import { canonicalJson } from './raster-identity.js';
import type { RuntimeBakeRequest } from './runtime-bake-protocol.js';
import type { Fingerprint } from '../identity.js';
import { fingerprint128, fingerprintDomain, isFingerprint } from './fingerprint.js';

const textEncoder = new TextEncoder();

const CACHE_IDENTITY_VERSION = 1;
const CACHE_NAME = `pmndrs-glyph-font-bakes-${FONT_FORMAT_VERSION}-${FONT_BAKER_VERSION}-${CACHE_IDENTITY_VERSION}`;
const CACHE_PATH = '/.pmndrs-glyph/font-bakes/';
const EXPIRES_HEADER = 'x-pmndrs-expires-at';
const LENGTH_HEADER = 'x-pmndrs-byte-length';
const ARTIFACT_ID_HEADER = 'x-pmndrs-artifact-id';
const FINGERPRINT_HEADER = 'x-pmndrs-fingerprint';

export interface RuntimeFontCache {
  key(sourceFingerprint: Fingerprint, request: RuntimeBakeRequest): string;
  match(key: string): Promise<CachedFontArtifact | undefined>;
  put(key: string, artifact: CachedFontArtifact, expiresAt: number): Promise<void>;
}

export interface CachedFontArtifact {
  readonly bytes: Uint8Array;
  readonly id: string;
  readonly fingerprint: Fingerprint;
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
    key(sourceFingerprint, request) {
      const identity = canonicalJson({
        face: request.font.fontFaceIndex,
        rasters: request.rasters ?? [],
        sourceFingerprint,
        unicodeRanges: request.unicodeRanges ?? null,
      });
      return fingerprint128(textEncoder.encode(identity), fingerprintDomain.cache);
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
        const fingerprint = response.headers.get(FINGERPRINT_HEADER);
        if (
          expiresAt === undefined ||
          byteLength === undefined ||
          byteLength <= 0 ||
          id === null ||
          id.length === 0 ||
          !isFingerprint(fingerprint) ||
          now() >= expiresAt
        ) {
          await cache.delete(request);
          return undefined;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength !== byteLength) {
          await cache.delete(request);
          return undefined;
        }
        return { bytes, id, fingerprint };
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
              [FINGERPRINT_HEADER]: artifact.fingerprint,
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
