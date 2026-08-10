import { FONT_BAKER_VERSION, FONT_FORMAT_VERSION } from '../font-baker/contract.js';
import type { JsonValue } from '../raster.js';

import { copyToOwnedArrayBuffer } from './owned-array-buffer.js';
import { canonicalJson } from './raster-identity.js';
import type { RuntimeBakeRequestV0 } from './runtime-bake-protocol.js';

const CACHE_NAME = `pmndrs-text-font-bakes-${FONT_FORMAT_VERSION}-${FONT_BAKER_VERSION}`;
const CACHE_PATH = '/.pmndrs-text/font-bakes/';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 24;
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const CREATED_HEADER = 'x-pmndrs-created-at';
const LENGTH_HEADER = 'x-pmndrs-byte-length';
const ARTIFACT_ID_HEADER = 'x-pmndrs-artifact-id';
const SHA256_HEADER = 'x-pmndrs-sha256';

interface CacheEntry {
  readonly request: Request;
  readonly createdAt: number;
  readonly byteLength: number;
}

export interface RuntimeFontCache {
  key(source: Uint8Array, request: RuntimeBakeRequestV0): Promise<string>;
  match(key: string): Promise<CachedFontArtifact | undefined>;
  put(key: string, artifact: CachedFontArtifact): Promise<void>;
}

export interface CachedFontArtifact {
  readonly bytes: Uint8Array;
  readonly id: string;
  readonly sha256: string;
}

/** CacheStorage has request matching and quota eviction, but owns neither TTL nor per-entry bounds. */
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
      } as unknown as JsonValue);
      return sha256(new TextEncoder().encode(identity));
    },
    async match(key) {
      try {
        const cache = await storage.open(CACHE_NAME);
        const request = requestFor(key);
        const response = await cache.match(request);
        if (response === undefined) return undefined;
        const createdAt = headerInteger(response, CREATED_HEADER);
        const byteLength = headerInteger(response, LENGTH_HEADER);
        const id = response.headers.get(ARTIFACT_ID_HEADER);
        const artifactHash = response.headers.get(SHA256_HEADER);
        if (
          createdAt === undefined ||
          byteLength === undefined ||
          byteLength <= 0 ||
          byteLength > MAX_ENTRY_BYTES ||
          id === null ||
          id.length === 0 ||
          artifactHash === null ||
          !/^[0-9a-f]{64}$/.test(artifactHash) ||
          now() - createdAt >= CACHE_TTL_MS
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
    async put(key, artifact) {
      const { bytes } = artifact;
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_ENTRY_BYTES) return;
      try {
        const cache = await storage.open(CACHE_NAME);
        await cache.put(
          requestFor(key),
          new Response(copyToOwnedArrayBuffer(bytes), {
            headers: {
              'content-type': 'model/gltf-binary',
              [CREATED_HEADER]: String(now()),
              [LENGTH_HEADER]: String(bytes.byteLength),
              [ARTIFACT_ID_HEADER]: artifact.id,
              [SHA256_HEADER]: artifact.sha256,
            },
          }),
        );
        await prune(cache, now());
      } catch {
        // CacheStorage is an optional acceleration. Quota, privacy-mode, and storage failures must not fail baking.
      }
    },
  };
}

async function prune(cache: Cache, now: number): Promise<void> {
  const entries: CacheEntry[] = [];
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (response === undefined) continue;
    const createdAt = headerInteger(response, CREATED_HEADER);
    const byteLength = headerInteger(response, LENGTH_HEADER);
    if (
      createdAt === undefined ||
      byteLength === undefined ||
      byteLength <= 0 ||
      byteLength > MAX_ENTRY_BYTES ||
      now - createdAt >= CACHE_TTL_MS
    ) {
      await cache.delete(request);
      continue;
    }
    entries.push({ request, createdAt, byteLength });
  }
  entries.sort((left, right) => left.createdAt - right.createdAt);
  let totalBytes = entries.reduce((total, entry) => total + entry.byteLength, 0);
  while (entries.length > MAX_CACHE_ENTRIES || totalBytes > MAX_CACHE_BYTES) {
    const entry = entries.shift();
    if (entry === undefined) break;
    await cache.delete(entry.request);
    totalBytes -= entry.byteLength;
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
