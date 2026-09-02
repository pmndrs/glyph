type BitmapShader = typeof import('../../tsl/bitmap-shader.js').bitmapShader;
type MsdfShader = typeof import('../../tsl/msdf-shader.js').msdfShader;
type SlugShader = typeof import('../../tsl/slug-shader.js').slugShader;

let bitmap: BitmapShader | undefined;
let msdf: MsdfShader | undefined;
let slug: SlugShader | undefined;

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

function registerShader<Shader>(name: string, current: Shader | undefined, shader: Shader): Shader {
  if (current !== undefined && current !== shader) throw new Error(`Three ${name} shader is already registered`);
  return shader;
}

function missingShader(name: string): Error {
  return new Error(`Three ${name} shader is not registered; import @pmndrs/glyph/three or @pmndrs/glyph/three/${name}`);
}
