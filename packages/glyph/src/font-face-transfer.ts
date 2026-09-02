/** One content-addressed external resource carried with a serialized raster. */
export interface SerializedFontFaceResource {
  readonly artifactHash: string;
  readonly byteLength: number;
  readonly data: ArrayBuffer;
}

/** Content identity of one external resource used by a serialized raster. */
export interface SerializedFontFaceResourceIdentity {
  readonly artifactHash: string;
  readonly byteLength: number;
}

/** One exact raster selection and the data needed to reconstruct it without network access. */
export interface SerializedFontFaceRaster {
  readonly rasterKey: string;
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  /** Complete sidecar GLB. Omitted only when this raster is embedded in the main font GLB. */
  readonly data?: ArrayBuffer;
  readonly artifactHash?: string;
  /** Exact external resource dependencies resolved while loading this raster. */
  readonly resources: readonly SerializedFontFaceResourceIdentity[];
}

/** Versioned inert FontFace state accepted by `glyph.fontFace()` in another JavaScript realm. */
export interface SerializedFontFace {
  readonly kind: 'glyph-font-face';
  readonly version: 1;
  /** Complete main font GLB. This buffer is transferable. */
  readonly data: ArrayBuffer;
  readonly artifactHash: string;
  readonly rasters: readonly SerializedFontFaceRaster[];
  /** External resources deduplicated across every carried raster by content identity. */
  readonly resources: readonly SerializedFontFaceResource[];
}

/** A structured-clone payload paired with every buffer that should be transferred with it. */
export type FontFaceTransfer = readonly [fontFace: SerializedFontFace, transfer: Transferable[]];
