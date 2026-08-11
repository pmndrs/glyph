/**
 * Direct Wasm ABI dependencies are intentionally isolated from the application entry graph.
 *
 * Selected measurement and conformance targets opt into these module and asset imports only
 * after an operator chooses an ABI-level benchmark. Product demos use public loader surfaces.
 */
export interface DirectWasmDependencies {
  readonly createFontBaker: typeof import('../../../../../../packages/text/src/font-baker/index').createFontBaker;
  readonly bakerWasmUrl: string;
  readonly shaperWasmUrl: string;
}

export type DirectFontBaker = Awaited<ReturnType<DirectWasmDependencies['createFontBaker']>>;

export async function loadDirectWasmDependencies(): Promise<DirectWasmDependencies> {
  const [bakerModule, bakerWasmModule, shaperWasmModule] = await Promise.all([
    import('../../../../../../packages/text/src/font-baker/index'),
    import('@pmndrs/text/font-baker.wasm?url'),
    import('@pmndrs/text/text-shaper.wasm?url'),
  ]);
  return {
    createFontBaker: bakerModule.createFontBaker,
    bakerWasmUrl: bakerWasmModule.default,
    shaperWasmUrl: shaperWasmModule.default,
  };
}
