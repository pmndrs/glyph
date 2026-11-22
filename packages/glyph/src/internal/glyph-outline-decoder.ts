import { fontBakerAbi } from '../font-baker/generated/font-baker-abi.js';
import {
  emptyGlyphOutlineView,
  GlyphOutlineStoreBuilder,
  viewGlyphOutline,
  type GlyphOutlineStore,
} from '../glyph-outline.js';
import { compileWasmResponse } from './compile-wasm-response.js';
import { fontBakerCoreWasmUrl } from './font-baker-core-wasm-url.js';
import { cacheSuccessfulPromise } from './successful-promise-cache.js';

/**
 * Outline decoding lives in the font baker, not the text shaper: only fonts baked with `outlines` need it, and it
 * links the glyf/CFF readers the shaper has no other use for. The baker's core build (no subsetting) is the module
 * fetched here, once, the first time such a font loads.
 */
interface OutlineDecoderExports {
  readonly memory: WebAssembly.Memory;
  readonly allocate: (length: number) => number;
  readonly glyphOutline: (sfntPointer: number, sfntLength: number, glyphId: number) => number;
  readonly glyphOutlinePointer: () => number;
  readonly glyphOutlineLength: () => number;
}

const loadDecoderModule = cacheSuccessfulPromise<WebAssembly.Module>(async () => {
  const url = fontBakerCoreWasmUrl();
  if (url.protocol === 'file:' && typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function') {
    const fileSystem = process.getBuiltinModule('node:fs') as typeof import('node:fs');
    return WebAssembly.compile(Uint8Array.from(fileSystem.readFileSync(url)));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`glyph outline decoder Wasm request failed with HTTP ${response.status}`);
  return compileWasmResponse(response);
});

function readDecoderExports(instance: WebAssembly.Instance): OutlineDecoderExports {
  const memory = instance.exports[fontBakerAbi.memory];
  if (!(memory instanceof WebAssembly.Memory)) throw new TypeError('glyph outline decoder is missing memory');
  const exported = (name: string): ((...args: number[]) => number) => {
    const value = instance.exports[name];
    if (typeof value !== 'function') throw new TypeError(`glyph outline decoder is missing export ${name}`);
    return value as (...args: number[]) => number;
  };
  const functions = fontBakerAbi.functions;
  return {
    memory,
    allocate: exported(functions.allocate.export),
    glyphOutline: exported(functions.glyphOutline.export),
    glyphOutlinePointer: exported(functions.glyphOutlinePointer.export),
    glyphOutlineLength: exported(functions.glyphOutlineLength.export),
  };
}

function memoryView(memory: WebAssembly.Memory, pointer: number, length: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(pointer) || pointer < 0 || !Number.isInteger(length) || length < 0) {
    throw new RangeError('glyph outline decoder returned an invalid memory range');
  }
  if (pointer + length > memory.buffer.byteLength) {
    throw new RangeError('glyph outline decoder memory range is out of bounds');
  }
  return new Uint8Array(memory.buffer as ArrayBuffer, pointer, length);
}

function outlineStatusError(status: number, glyphId: number): Error {
  const statuses = fontBakerAbi.glyphOutline;
  const labels: Record<number, string> = {
    [statuses.invalidFont]: 'its outline data is malformed',
    [statuses.outOfMemory]: 'its outline exceeds available memory',
  };
  return new Error(`glyph outline decoder could not decode glyph ${glyphId}: ${labels[status] ?? `status ${status}`}`);
}

/**
 * Decodes glyphs `0..glyphCount` of an outline SFNT in a fresh instance, handing each result to `visit`, and returns the
 * first decode failure.
 */
async function decodeGlyphOutlines(
  sfnt: Uint8Array,
  glyphCount: number,
  visit: (exports: OutlineDecoderExports, glyphId: number) => void,
): Promise<Error | undefined> {
  const exports = readDecoderExports(await WebAssembly.instantiate(await loadDecoderModule(), {}));
  const length = sfnt.byteLength;
  const pointer = exports.allocate(length);
  if (pointer === 0 && length !== 0) throw new RangeError('glyph outline decoder allocation failed');
  memoryView(exports.memory, pointer, length).set(sfnt);
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    const status = exports.glyphOutline(pointer, length, glyphId);
    if (status !== fontBakerAbi.glyphOutline.ok) return outlineStatusError(status, glyphId);
    visit(exports, glyphId);
  }
  return undefined;
}

/** @internal Returns the error of the first glyph of an outline SFNT that the runtime decoder refuses, if any. */
export function decodeEveryGlyphOutline(sfnt: Uint8Array, glyphCount: number): Promise<Error | undefined> {
  return decodeGlyphOutlines(sfnt, glyphCount, () => {});
}

/**
 * @internal Decodes every glyph of an outline SFNT into one store. The bake validated every glyph with the same
 * decoder, so a failure here means the artifact was corrupted after baking.
 */
export async function decodeGlyphOutlineStore(sfnt: Uint8Array, glyphCount: number): Promise<GlyphOutlineStore> {
  const builder = new GlyphOutlineStoreBuilder(glyphCount);
  const scratch = emptyGlyphOutlineView();
  const failure = await decodeGlyphOutlines(sfnt, glyphCount, (exports, glyphId) => {
    const result = memoryView(exports.memory, exports.glyphOutlinePointer(), exports.glyphOutlineLength());
    builder.append(viewGlyphOutline(result.buffer, result.byteOffset, 0, glyphId, scratch));
  });
  if (failure !== undefined) throw failure;
  return builder.finish();
}
