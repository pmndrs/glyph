import type { RasterKey } from '../identity.js';
import type { JsonValue } from '../raster.js';
import { deriveRasterKey } from './raster-identity.js';

export const SLUG_KIND = 'slug' as const;
export const SLUG_EXTENSION = 'PMNDRS_font_slug' as const;
export const SLUG_FORMAT_VERSION = 0 as const;
export const SLUG_GENERATOR_VERSION = '0.0.0' as const;
export const SLUG_PLANE_UNITS_PER_EM = 2048 as const;
export const SLUG_DEFAULT_BAND_COUNT = 16 as const;
export const SLUG_GLYPH_RECORD_STRIDE = 40 as const;

/** Quadratics fitted per CFF cubic. TrueType outlines are already quadratic. */
export const SLUG_CUBIC_SUBDIVISIONS = 4 as const;
/** Most quadratics one cubic may become. */
export const SLUG_MAX_CUBIC_SUBDIVISIONS = 16 as const;

export interface SlugOptions {
  /**
   * Quadratics fitted per cubic when the source has CFF outlines. Defaults to 4.
   *
   * Straight accuracy for cost: Slug ships these curves to the GPU and the
   * shader walks every curve in a pixel's band, so raising this grows both the
   * payload and the per-pixel loop in proportion. TrueType sources ignore it.
   */
  readonly cubicSubdivisions?: number;
}

export interface SlugDescriptor {
  readonly [key: string]: JsonValue;
  readonly generatorVersion: typeof SLUG_GENERATOR_VERSION;
}

const descriptor = Object.freeze({
  generatorVersion: SLUG_GENERATOR_VERSION,
}) satisfies SlugDescriptor;

/**
 * Return the payload-changing Slug V0 descriptor.
 *
 * The default rate is omitted rather than written out, so the descriptor — and
 * the raster key derived from it — is unchanged for every caller who does not
 * ask for a different one.
 */
export function slugDescriptor(options?: SlugOptions): SlugDescriptor {
  const cubicSubdivisions = normalizeSlugOptions(options)?.cubicSubdivisions;
  if (cubicSubdivisions === undefined || cubicSubdivisions === SLUG_CUBIC_SUBDIVISIONS) {
    return descriptor;
  }
  return Object.freeze({ cubicSubdivisions, generatorVersion: SLUG_GENERATOR_VERSION });
}

/** Derive the key shared by the baker and runtime module. */
export function slugDescriptorRasterKey(options?: SlugOptions): RasterKey {
  return deriveRasterKey({
    descriptor: slugDescriptor(options),
    extension: SLUG_EXTENSION,
    kind: SLUG_KIND,
    version: SLUG_FORMAT_VERSION,
  });
}

/** Reject a rate the format cannot carry, naming the axis that is wrong. */
export function normalizeSlugOptions(value: unknown): SlugOptions | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') {
    throw new TypeError('Slug options must be an object');
  }
  const { cubicSubdivisions } = value as SlugOptions;
  if (cubicSubdivisions === undefined) return undefined;
  if (
    !Number.isSafeInteger(cubicSubdivisions) ||
    cubicSubdivisions < 1 ||
    cubicSubdivisions > SLUG_MAX_CUBIC_SUBDIVISIONS
  ) {
    throw new TypeError(
      `Slug cubicSubdivisions must be an integer from 1 to ${SLUG_MAX_CUBIC_SUBDIVISIONS}: ${String(cubicSubdivisions)}`,
    );
  }
  return { cubicSubdivisions };
}
