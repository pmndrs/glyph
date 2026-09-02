import type { AnyRasterTechnique } from '../../raster-technique.js';

type BitmapShader = typeof import('../../tsl/bitmap-shader.js').bitmapShader;
type MsdfShader = typeof import('../../tsl/msdf-shader.js').msdfShader;
type SlugShader = typeof import('../../tsl/slug-shader.js').slugShader;

let bitmap: BitmapShader | undefined;
let msdf: MsdfShader | undefined;
let slug: SlugShader | undefined;
const loading = new Map<string, Promise<void>>();

export function registerThreeBitmapShader(shader: BitmapShader): void {
  bitmap = registerShader('bitmap', bitmap, shader);
}

export function registerThreeMsdfShader(shader: MsdfShader): void {
  msdf = registerShader('msdf', msdf, shader);
}

export function registerThreeSlugShader(shader: SlugShader): void {
  slug = registerShader('slug', slug, shader);
}

export function threeBitmapShader(): BitmapShader {
  if (bitmap === undefined) throw missingShader('bitmap');
  return bitmap;
}

export function threeMsdfShader(): MsdfShader {
  if (msdf === undefined) throw missingShader('msdf');
  return msdf;
}

export function threeSlugShader(): SlugShader {
  if (slug === undefined) throw missingShader('slug');
  return slug;
}

/** Load the renderer half selected by FontFace.load(handle); module promises are stable after success. */
export function loadThreeTechnique(technique: AnyRasterTechnique): Promise<void> {
  const existing = loading.get(technique.id);
  if (existing !== undefined) return existing;
  const pending = loadBuiltin(technique.id).catch((error: unknown) => {
    if (loading.get(technique.id) === pending) loading.delete(technique.id);
    throw error;
  });
  loading.set(technique.id, pending);
  return pending;
}

function loadBuiltin(id: string): Promise<void> {
  switch (id) {
    case 'pmndrs.bitmap':
      return import('./load-bitmap-shader.js').then(() => undefined);
    case 'pmndrs.msdf':
      return import('./load-msdf-shader.js').then(() => undefined);
    case 'pmndrs.slug':
      return import('./load-slug-shader.js').then(() => undefined);
    default:
      return Promise.resolve();
  }
}

function registerShader<Shader>(name: string, current: Shader | undefined, shader: Shader): Shader {
  if (current !== undefined && current !== shader) throw new Error(`Three ${name} shader is already registered`);
  return shader;
}

function missingShader(name: string): Error {
  return new Error(
    `Three ${name} shader is not loaded; await FontFace.load(handle) or import @pmndrs/glyph/three/${name}`,
  );
}
