import type {
  PortableBufferPayload,
  PortableResource,
  PortableResourceGroupPayload,
  PortableTextureArrayPayload,
} from '../../index.js';
import { msdfBakedPages } from '../../raster/msdf.js';
import { SLUG_RESIDENT_BAND_CURVE_WIDTH, SlugBandResidency } from '../../raster/internal/slug-residency.js';
import { BufferImageSource, Texture } from 'pixi.js';
import type { BitmapFilter } from '../../raster/bitmap.js';

export class Pixi3DBitmapResource {
  readonly pages: readonly Texture[];
  #disposed = false;

  constructor(
    readonly payload: PortableTextureArrayPayload,
    filter: BitmapFilter = 'linear',
  ) {
    if (payload.format !== 'r8unorm') throw new TypeError(`Pixi3D Bitmap needs r8unorm, received ${payload.format}`);
    const pageBytes = payload.width * payload.height;
    this.pages = Object.freeze(
      Array.from({ length: payload.layers }, (_, layer) => {
        const start = layer * pageBytes;
        // Pixi's WebGL material batch samplers do not preserve an R8 upload when raster materials
        // share a View3D with RGBA textures. Keep the baked payload compact, then widen only the
        // renderer-owned upload so Bitmap remains visible in mixed WebGL2 scenes.
        const source = new BufferImageSource({
          resource: expandRedToRgba(payload.bytes.subarray(start, start + pageBytes)),
          width: payload.width,
          height: payload.height,
          format: 'rgba8unorm',
          scaleMode: filter,
          autoGenerateMipmaps: false,
          alphaMode: 'no-premultiply-alpha',
          label: `glyph-bitmap-page-${layer}`,
        });
        return new Texture({ source, label: `glyph-bitmap-page-${layer}` });
      }),
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const page of this.pages) page.destroy(true);
  }
}

function expandRedToRgba(red: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(red.length * 4);
  for (let source = 0, target = 0; source < red.length; source += 1, target += 4) {
    rgba[target] = red[source]!;
    rgba[target + 3] = 255;
  }
  return rgba;
}

/** One MSDF font: every baked page uploaded whole, and the glyph table the draws resolve their cells from. */
export class Pixi3DMsdfResource {
  readonly pages: readonly Texture[];
  readonly atlasSize: readonly [number, number];
  readonly pixelRange: number;
  readonly effectScale: readonly [number, number, number];
  /** `[left, top, width, height + layer * 4096]` in atlas texels, one row per baked glyph. */
  readonly glyphs: Float32Array;
  #disposed = false;

  constructor(payload: PortableResourceGroupPayload) {
    const pixelRange = member(payload, 'pixelRange');
    const effectScale = member(payload, 'effectScale');
    const glyphs = member(payload, 'glyphs');
    const pages = member(payload, 'pages');
    if (pixelRange.kind !== 'buffer' || effectScale.kind !== 'buffer' || glyphs.kind !== 'buffer') {
      throw new TypeError('Pixi3D MTSDF needs pixelRange, effectScale and glyphs buffers');
    }
    if (pages.kind !== 'buffer' || pages.bytes.byteLength !== 4) {
      throw new TypeError('Pixi3D MTSDF needs a baked-pages token member "pages"');
    }
    const baked = msdfBakedPages(pages);
    this.atlasSize = Object.freeze([baked.width, baked.height]);
    this.pixelRange = scalar(pixelRange, 0, 'pixelRange');
    this.effectScale = Object.freeze([
      scalar(effectScale, 0, 'effectScale.x'),
      scalar(effectScale, 1, 'effectScale.y'),
      scalar(effectScale, 2, 'effectScale.z'),
    ]);
    this.glyphs = new Float32Array(glyphs.bytes.slice().buffer);
    this.pages = Object.freeze(
      baked.pages.map((page, layer) => {
        const source = new BufferImageSource({
          resource: anchoredPage(page.bytes, page.width, page.height, baked.width, baked.height),
          width: baked.width,
          height: baked.height,
          format: 'rgba8unorm',
          scaleMode: 'linear',
          autoGenerateMipmaps: false,
          alphaMode: 'no-premultiply-alpha',
          label: `glyph-msdf-page-${layer}`,
        });
        return new Texture({ source, label: `glyph-msdf-page-${layer}` });
      }),
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const page of this.pages) page.destroy(true);
  }
}

/** A baked page smaller than the extent the glyph table addresses sits at the extent's origin. */
function anchoredPage(bytes: Uint8Array, width: number, height: number, extentX: number, extentY: number): Uint8Array {
  if (width === extentX && height === extentY) return bytes.slice();
  const anchored = new Uint8Array(extentX * extentY * 4);
  for (let row = 0; row < Math.min(height, extentY); row += 1) {
    const start = row * width * 4;
    anchored.set(bytes.subarray(start, start + Math.min(width, extentX) * 4), row * extentX * 4);
  }
  return anchored;
}

/** `rgba8unorm` texels per resident band entry: its three control-point words, one word per texel. */
export const SLUG_BAND_CURVE_TEXELS = 3;

/**
 * One Slug page. Its band headers are uploaded whole; its band curves become resident per glyph, the first time a
 * draw names that glyph, through core's `SlugBandResidency` (the rule the Three and TypeGPU renderers follow).
 *
 * PixiJS 3D samples material textures as floats, so each u32 word is uploaded as the four bytes of one nearest-sampled
 * `rgba8unorm` texel and the shader rebuilds it exactly. The band-curve texture is allocated once at the largest grid
 * the page can reach, so growth never replaces a texture a material has bound; only its contents change.
 */
export class Pixi3DSlugResource {
  readonly headers: Texture;
  readonly bandCurves: Texture;
  readonly headerSize: readonly [number, number];
  readonly bandCurveSize: readonly [number, number];
  readonly #residency: SlugBandResidency;
  readonly #bandCurveBytes: Uint8Array;
  #disposed = false;

  constructor(payload: PortableResourceGroupPayload) {
    const headers = member(payload, 'headers', 'Slug');
    const curves = member(payload, 'curves', 'Slug');
    const references = member(payload, 'references', 'Slug');
    const glyphs = member(payload, 'glyphs', 'Slug');
    if (headers.kind !== 'texture' || headers.format !== 'r32uint') {
      throw new TypeError('Pixi3D Slug needs an r32uint headers texture');
    }
    if (curves.kind !== 'buffer' || references.kind !== 'buffer' || glyphs.kind !== 'buffer') {
      throw new TypeError('Pixi3D Slug needs curves, references and glyphs buffers');
    }
    this.#residency = new SlugBandResidency(curves.bytes, references.bytes, glyphs.bytes);
    // Every reference becomes at most one resident entry, so this many lines hold the whole page.
    const capacity = Math.max(1, Math.ceil(references.bytes.byteLength / 2 / SLUG_RESIDENT_BAND_CURVE_WIDTH));
    let lines = 1;
    while (lines < capacity) lines *= 2;
    this.headerSize = Object.freeze([headers.width, headers.height]);
    this.bandCurveSize = Object.freeze([SLUG_RESIDENT_BAND_CURVE_WIDTH * SLUG_BAND_CURVE_TEXELS, lines]);
    this.headers = texture(headers.bytes.slice(), headers.width, headers.height, 'glyph-slug-headers');
    this.#bandCurveBytes = new Uint8Array(this.bandCurveSize[0] * lines * 4);
    this.bandCurves = texture(this.#bandCurveBytes, this.bandCurveSize[0], lines, 'glyph-slug-band-curves');
  }

  /** The page's glyph table, sixteen words a row, with `referenceBase` pointing at resident entries once used. */
  get table(): Uint32Array {
    return this.#residency.table;
  }

  /** Makes resident every glyph named by instances `[start, end)` of a `[row, unused]` glyph lane. */
  use(lane: Uint32Array, start: number, end: number): void {
    const admission = this.#residency.use(lane, start, end, 2);
    if (admission === undefined) return;
    const entries = this.#residency.entries;
    const firstEntry = (admission.grew ? 0 : admission.firstLine) * SLUG_RESIDENT_BAND_CURVE_WIDTH;
    const endEntry = admission.endLine * SLUG_RESIDENT_BAND_CURVE_WIDTH;
    const words = new Uint32Array(this.#bandCurveBytes.buffer);
    for (let entry = firstEntry; entry < endEntry; entry += 1) {
      words.set(entries.subarray(entry * 4, entry * 4 + SLUG_BAND_CURVE_TEXELS), entry * SLUG_BAND_CURVE_TEXELS);
    }
    this.bandCurves.source.update();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.headers.destroy(true);
    this.bandCurves.destroy(true);
  }
}

export interface Pixi3DBitmapResolvedResource {
  readonly format: 'pmndrs.bitmap';
  readonly name: string;
  readonly bitmap: Pixi3DBitmapResource;
}

export interface Pixi3DMsdfResolvedResource {
  readonly format: 'pmndrs.msdf';
  readonly name: string;
  readonly msdf: Pixi3DMsdfResource;
}

export interface Pixi3DSlugResolvedResource {
  readonly format: 'pmndrs.slug';
  readonly name: string;
  readonly slug: Pixi3DSlugResource;
}

export type Pixi3DResolvedResource =
  | Pixi3DBitmapResolvedResource
  | Pixi3DMsdfResolvedResource
  | Pixi3DSlugResolvedResource;

export function resolveRasterResource(
  format: string,
  name: string,
  payload: PortableResource,
  bitmapFilter: BitmapFilter = 'linear',
): Pixi3DResolvedResource {
  if (format === 'pmndrs.bitmap' && payload.kind === 'texture-array') {
    return Object.freeze({ format, name, bitmap: new Pixi3DBitmapResource(payload, bitmapFilter) });
  }
  if (format === 'pmndrs.msdf' && payload.kind === 'group') {
    return Object.freeze({ format, name, msdf: new Pixi3DMsdfResource(payload) });
  }
  if (format === 'pmndrs.slug' && payload.kind === 'group') {
    return Object.freeze({ format, name, slug: new Pixi3DSlugResource(payload) });
  }
  throw new TypeError(`Pixi3D renderer cannot resolve ${format}/${payload.kind}`);
}

function member(payload: PortableResourceGroupPayload, name: string, technique = 'MTSDF') {
  const value = payload.members[name];
  if (value === undefined) throw new TypeError(`Pixi3D ${technique} resource is missing ${name}`);
  return value;
}

function texture(bytes: Uint8Array, width: number, height: number, label: string): Texture {
  const source = new BufferImageSource({
    resource: bytes,
    width,
    height,
    format: 'rgba8unorm',
    scaleMode: 'nearest',
    autoGenerateMipmaps: false,
    alphaMode: 'no-premultiply-alpha',
    label,
  });
  return new Texture({ source, label });
}

function scalar(payload: PortableBufferPayload, index: number, name: string): number {
  const offset = index * 4;
  if (offset + 4 > payload.bytes.byteLength) throw new RangeError(`Pixi3D MTSDF ${name} is missing`);
  const value = new DataView(payload.bytes.buffer, payload.bytes.byteOffset, payload.bytes.byteLength).getFloat32(
    offset,
    true,
  );
  if (!Number.isFinite(value)) throw new RangeError(`Pixi3D MTSDF ${name} must be finite`);
  return value;
}
