/**
 * Direct Wasm ABI dependencies are intentionally isolated from the application entry graph.
 *
 * Product demos use the public @pmndrs/text loader. Measurement targets opt into these
 * module and asset imports only after the operator selects an ABI-level benchmark.
 */
export interface DirectWasmDependencies {
  readonly createFontBaker: typeof import('@pmndrs/text-font-baker').createFontBaker;
  readonly bakerWasmUrl: string;
  readonly shaperWasmUrl: string;
}

export type DirectFontBaker = Awaited<ReturnType<DirectWasmDependencies['createFontBaker']>>;

export async function loadDirectWasmDependencies(): Promise<DirectWasmDependencies> {
  const [bakerModule, bakerWasmModule, shaperWasmModule] = await Promise.all([
    import('@pmndrs/text-font-baker'),
    import('@pmndrs/text-font-baker/font-baker.wasm?url'),
    import('@pmndrs/text/text-shaper.wasm?url'),
  ]);
  return {
    createFontBaker: bakerModule.createFontBaker,
    bakerWasmUrl: bakerWasmModule.default,
    shaperWasmUrl: shaperWasmModule.default,
  };
}
