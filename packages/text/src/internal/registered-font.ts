import type { RegisteredFont } from '../font.js'
import type { JsonValue, RasterReference } from '../raster.js'

export interface RegisteredBufferView {
  readonly byteOffset: number
  readonly byteLength: number
}

export interface RegisteredRasterSourceData {
  reference: RasterReference
  readonly extensionData?: JsonValue
  readonly binaryBytes?: Uint8Array
  readonly bufferViews?: readonly RegisteredBufferView[]
  readonly externalCandidates: RegisteredRasterExternalCandidate[]
}

export interface RegisteredRasterExternalCandidate {
  readonly source: Extract<RasterReference['source'], { readonly type: 'external' }>
  readonly artifactUrl?: string
  readonly fetch?: typeof fetch
}

export interface RegisteredFontData {
  readonly sourceHash: string
  sourceBytes?: Uint8Array
  readonly sourceCandidates: RegisteredFontSourceCandidate[]
  readonly shapingSfnt: Uint8Array
  readonly glyphExtents: Uint8Array
  readonly glyphExtentsAvailability: Uint8Array
  readonly rasterSources: Map<string, RegisteredRasterSourceData>
  readonly unicodeVersion: string
}

export interface RegisteredFontSourceCandidate {
  /** Hash of the exact source bytes available at this candidate. */
  readonly sourceHash: string
  readonly sourceUrl: string
  readonly fetch?: typeof fetch
}

const dataByFont = new WeakMap<RegisteredFont, RegisteredFontData>()

export function setRegisteredFontData(font: RegisteredFont, data: RegisteredFontData): void {
  dataByFont.set(font, data)
}

export function getRegisteredFontData(font: RegisteredFont): RegisteredFontData {
  const data = dataByFont.get(font)
  if (data === undefined) throw new TypeError('font is not registered by this package')
  return data
}

export function deleteRegisteredFontData(font: RegisteredFont): void {
  dataByFont.delete(font)
}
