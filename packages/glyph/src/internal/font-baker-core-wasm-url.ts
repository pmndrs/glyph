/** The font baker built without subsetting: bake and glyph-outline decoding only. */
export function fontBakerCoreWasmUrl(): URL {
  return new URL('../../dist/font-baker-core.wasm', import.meta.url);
}
