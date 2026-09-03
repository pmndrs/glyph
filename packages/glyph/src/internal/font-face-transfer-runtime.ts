import type { Font, RegisteredFont } from '../font.js';
import type { SerializedFontFace, SerializedFontFaceRaster } from '../font-face-transfer.js';
import { FontRegistry } from '../loader.js';
import { immutableFontResources } from '../loaded-font.js';
import type { AnyRasterFormat } from '../config/raster-format.js';
import { freezeSerializedFontFace } from './font-face-transfer.js';
import { getRegisteredFontData } from './registered-font.js';

export interface SerializedFontFaceLoadOptions {
  readonly maxArtifactBytes?: number;
  readonly maxBufferViews?: number;
  readonly maxRasters?: number;
}

/** Copy loaded variants into inert cross-realm data only when clone() explicitly asks for it. */
export function snapshotSerializedFontFace(
  expectedFont: RegisteredFont,
  fonts: readonly Font<AnyRasterFormat>[],
): SerializedFontFace {
  const registered = getRegisteredFontData(expectedFont);
  const rasters: SerializedFontFaceRaster[] = [];
  const seen = new Set<string>();
  const resourceIdentities = new Set<string>();
  for (const font of fonts) {
    const fontResources = immutableFontResources(font);
    if (fontResources.font !== expectedFont) {
      throw new TypeError('FontFace snapshot received a font from another source');
    }
    const rasterKey = fontResources.raster.rasterKey;
    if (seen.has(rasterKey)) continue;
    seen.add(rasterKey);
    const source = registered.rasterSources.get(rasterKey);
    if (source === undefined) throw new Error('loaded FontFace raster has no retained source data');
    if (source.reference.source.type === 'external' && source.artifactBytes === undefined) {
      throw new Error('loaded external FontFace raster has no retained artifact data');
    }
    for (const identity of source.resourceIdentities) resourceIdentities.add(identity);
    const resources = Object.freeze(
      [...source.resourceIdentities].map((identity) => {
        const resource = registered.resources.get(identity);
        if (resource === undefined) throw new Error('loaded FontFace raster has no retained resource data');
        return Object.freeze({
          artifactHash: resource.artifactHash,
          byteLength: resource.byteLength,
        });
      }),
    );
    rasters.push(
      Object.freeze({
        rasterKey,
        kind: source.reference.kind,
        extension: source.reference.extension,
        version: source.reference.version,
        ...(source.artifactBytes === undefined
          ? {}
          : {
              data: copyBuffer(source.artifactBytes),
              artifactHash: source.artifactHash!,
            }),
        resources,
      }),
    );
  }
  return freezeSerializedFontFace({
    kind: 'glyph-font-face',
    version: 1,
    data: copyBuffer(registered.artifactBytes),
    artifactHash: registered.artifactHash,
    rasters: Object.freeze(rasters),
    resources: Object.freeze(
      [...resourceIdentities].map((identity) => {
        const resource = registered.resources.get(identity);
        if (resource === undefined) throw new Error('loaded FontFace raster has no retained resource data');
        return Object.freeze({
          artifactHash: resource.artifactHash,
          byteLength: resource.byteLength,
          data: copyBuffer(resource.bytes),
        });
      }),
    ),
  });
}

/** Reconstruct a transferred source only when a receiving FontFace is actually loaded. */
export async function loadSerializedFontFaceSource(
  serialized: SerializedFontFace,
  options: SerializedFontFaceLoadOptions,
  signal: AbortSignal | undefined,
): Promise<RegisteredFont> {
  const registry = new FontRegistry(options);
  let font: RegisteredFont | undefined;
  try {
    font = await registry._registerAsset(new Uint8Array(serialized.data), {}, 'adopt');
    signal?.throwIfAborted();
    const registered = getRegisteredFontData(font);
    for (const raster of serialized.rasters) {
      const source = registered.rasterSources.get(raster.rasterKey);
      if (source === undefined) throw new Error('serialized FontFace raster is absent from its main font');
      if (raster.data !== undefined) {
        await registry._attachRaster(font, new Uint8Array(raster.data), {}, 'adopt');
      }
      signal?.throwIfAborted();
    }
    signal?.throwIfAborted();
    for (const resource of serialized.resources) {
      registered.resources.set(
        `${resource.artifactHash}:${resource.byteLength}`,
        Object.freeze({
          artifactHash: resource.artifactHash,
          byteLength: resource.byteLength,
          bytes: new Uint8Array(resource.data),
        }),
      );
    }
    return font;
  } catch (error) {
    font?.dispose();
    throw error;
  }
}

function copyBuffer(value: ArrayBufferView): ArrayBuffer {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
}
