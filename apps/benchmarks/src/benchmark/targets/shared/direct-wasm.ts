/** Isolated from the application entry graph; only ABI-level benchmark targets opt into these imports, while product demos use public loader surfaces. */
export interface DirectWasmDependencies {
  readonly createFontBaker: typeof import('../../../../../../packages/glyph/src/font-baker/index').createFontBaker;
  readonly bakerWasmUrl: string;
  readonly shaperWasmUrl: string;
}

export type DirectFontBaker = Awaited<ReturnType<DirectWasmDependencies['createFontBaker']>>;

export async function loadDirectWasmDependencies(): Promise<DirectWasmDependencies> {
  const [bakerModule, bakerWasmModule, shaperWasmModule] = await Promise.all([
    import('../../../../../../packages/glyph/src/font-baker/index'),
    import('@pmndrs/glyph/font-baker.wasm?url'),
    import('@pmndrs/glyph/text-shaper.wasm?url'),
  ]);
  return {
    createFontBaker: bakerModule.createFontBaker,
    bakerWasmUrl: bakerWasmModule.default,
    shaperWasmUrl: shaperWasmModule.default,
  };
}
