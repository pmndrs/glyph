/**
 * Compiles a fetched Wasm response, streaming it into the compiler when the engine accepts it, so compilation overlaps
 * the download and HTTP compression is decoded by the network stack. A streaming rejection falls back to buffered
 * compilation only for a readable response with a non-Wasm MIME type; other streaming errors propagate.
 */
export async function compileWasmResponse(response: Response): Promise<WebAssembly.Module> {
  if (typeof WebAssembly.compileStreaming === 'function') {
    try {
      return await WebAssembly.compileStreaming(response);
    } catch (error) {
      const readable = response.type === 'basic' || response.type === 'cors' || response.type === 'default';
      if (!readable || response.headers.get('Content-Type') === 'application/wasm') throw error;
    }
  }
  return WebAssembly.compile(await response.arrayBuffer());
}
