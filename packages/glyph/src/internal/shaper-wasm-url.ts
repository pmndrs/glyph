export function textShaperWasmUrl(): URL {
  return new URL('../../dist/text-shaper.wasm.gz', import.meta.url);
}
