import type { RegisteredFont } from '../font.js';
import type { JsonValue, RasterReference, RasterResourceResolver } from '../raster.js';

export interface RegisteredBufferView {
  readonly byteOffset: number;
  readonly byteLength: number;
}

export interface RegisteredRasterSourceData {
  reference: RasterReference;
  extensionData?: JsonValue;
  binaryBytes?: Uint8Array;
  bufferViews?: readonly RegisteredBufferView[];
  /** Complete authenticated external or runtime-generated raster artifact. Embedded rasters use the main artifact. */
  artifactBytes?: Uint8Array<ArrayBuffer>;
  artifactHash?: string;
  /** Content identities actually resolved while decoding this raster. */
  readonly resourceIdentities: Set<string>;
  readonly externalCandidates: RegisteredRasterExternalCandidate[];
  readonly resourceCandidates: RegisteredRasterResourceCandidate[];
}

export interface RegisteredRasterResourceData {
  readonly artifactHash: string;
  readonly byteLength: number;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface RegisteredRasterExternalCandidate {
  readonly source: Extract<RasterReference['source'], { readonly type: 'external' }>;
  readonly artifactUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface RegisteredRasterResourceCandidate {
  readonly artifactUrl?: string;
  readonly fetch?: typeof fetch;
  readonly resolveResource?: RasterResourceResolver;
}

export interface RegisteredFontData {
  /** Complete immutable GLB backing. Every embedded payload is a view into this allocation. */
  readonly artifactBytes: Uint8Array<ArrayBuffer>;
  /** Content identity of the complete main GLB, independent of its locator or shaping payload. */
  readonly artifactHash: string;
  readonly fontFaceIndex: number;
  readonly sourceHash: string;
  sourceBytes?: Uint8Array;
  readonly sourceCandidates: RegisteredFontSourceCandidate[];
  readonly shapingSfnt: Uint8Array;
  readonly glyphExtents: Uint8Array;
  readonly glyphExtentsAvailability: Uint8Array;
  readonly rasterSources: Map<string, RegisteredRasterSourceData>;
  /** Authenticated external resources shared by every raster through canonical content identity. */
  readonly resources: Map<string, RegisteredRasterResourceData>;
  readonly unicodeVersion: string;
}

export interface RegisteredFontSourceCandidate {
  /** Hash of the exact source bytes available at this candidate. */
  readonly sourceHash: string;
  readonly sourceUrl: string;
  readonly fetch?: typeof fetch;
}

const dataByFont = new WeakMap<RegisteredFont, RegisteredFontData>();

export function setRegisteredFontData(font: RegisteredFont, data: RegisteredFontData): void {
  dataByFont.set(font, data);
}

export function getRegisteredFontData(font: RegisteredFont): RegisteredFontData {
  const data = dataByFont.get(font);
  if (data === undefined) throw new TypeError('font is not registered by this package');
  return data;
}

export function deleteRegisteredFontData(font: RegisteredFont): void {
  dataByFont.delete(font);
}
