export function textShaperWasmUrl(): URL {
  return new URL('../../dist/text-shaper.wasm', import.meta.url);
}
