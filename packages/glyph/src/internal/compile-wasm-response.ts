/**
 * Compiles a fetched Wasm response, streaming it into the compiler when the engine accepts it, so compilation overlaps
 * the download and HTTP compression is decoded by the network stack. The engine decides what it streams: a response it
 * declines (its content type, origin, or status) rejects before the body is read, and is buffered and compiled
 * instead. A rejection after the body was read is a compile or network failure and propagates.
 */
export async function compileWasmResponse(response: Response): Promise<WebAssembly.Module> {
  if (typeof WebAssembly.compileStreaming === 'function') {
    try {
      return await WebAssembly.compileStreaming(response);
    } catch (error) {
      if (response.bodyUsed) throw error;
    }
  }
  return WebAssembly.compile(await response.arrayBuffer());
}
