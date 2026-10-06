/**
 * Compiles a fetched Wasm response. A response served exactly as `application/wasm` streams into the compiler, so
 * compilation overlaps the download and HTTP compression is decoded by the browser's network stack. Any other
 * content type, including that type with parameters or different case, is buffered first, because
 * `WebAssembly.compileStreaming` rejects it.
 */
export async function compileWasmResponse(response: Response): Promise<WebAssembly.Module> {
  if (
    response.headers.get('content-type')?.trim() === 'application/wasm' &&
    typeof WebAssembly.compileStreaming === 'function'
  ) {
    return WebAssembly.compileStreaming(response);
  }
  return WebAssembly.compile(await response.arrayBuffer());
}
