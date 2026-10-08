import { textShaperAbi } from '../generated/text-shaper-abi.js';
import { compileWasmResponse } from './compile-wasm-response.js';
import { textShaperWasmUrl } from './shaper-wasm-url.js';
import {
  emptyGlyphOutlineView,
  GlyphOutlineStoreBuilder,
  viewGlyphOutline,
  type GlyphOutlineStore,
} from '../glyph-outline.js';

/** @internal */
export interface ShaperExports {
  readonly memory: WebAssembly.Memory;
  readonly allocate: (length: number) => number;
  readonly deallocate: (pointer: number, length: number) => void;
  readonly registerFont: (
    handle: number,
    sfntPointer: number,
    sfntLength: number,
    extentsPointer: number,
    extentsLength: number,
    availabilityPointer: number,
    availabilityLength: number,
    underlinePacked: number,
    strikeoutPacked: number,
  ) => number;
  readonly disposeFont: (handle: number) => number;
  readonly fontCount: () => number;
  readonly retainedFontBytes: () => number;
  readonly shapePlanCount: () => number;
  readonly glyphOutline: (sfntPointer: number, sfntLength: number, glyphId: number) => number;
  readonly glyphOutlinePointer: () => number;
  readonly glyphOutlineLength: () => number;
  readonly registerFontBinding: (
    bindingHandle: number,
    shapingFontHandle: number,
    pointer: number,
    length: number,
  ) => number;
  readonly disposeFontBinding: (bindingHandle: number) => number;
  readonly fontBindingCount: () => number;
  readonly registerFontStack: (handle: number, pointer: number, count: number) => number;
  readonly disposeFontStack: (handle: number) => number;
  readonly registerCodec: (handle: number, pointer: number, length: number) => number;
  readonly disposeCodec: (handle: number) => number;
  readonly createRoot: (
    handle: number,
    requestCapacity: number,
    resultCapacity: number,
    textCapacity: number,
  ) => number;
  readonly reserveRoot: (
    handle: number,
    requestCapacity: number,
    resultCapacity: number,
    textCapacity: number,
  ) => number;
  readonly disposeRoot: (handle: number) => number;
  readonly requestPointer: (handle: number) => number;
  readonly requestCapacity: (handle: number) => number;
  readonly reserveUpdateBatch: (count: number) => number;
  readonly updateBatchPointer: () => number;
  readonly updateBatchCapacity: () => number;
  readonly textUpdate: (handle: number, pointer: number, length: number) => number;
  readonly textUpdateBatch: (entriesPointer: number, count: number) => number;
  readonly measureParagraph: (handle: number, pointer: number, length: number, paragraphId: number) => number;
  readonly borrowParagraphLayout: (handle: number, paragraphId: number) => number;
  readonly borrowParagraphGlyph: (
    handle: number,
    paragraphId: number,
    generation: number,
    glyphIndex: number,
  ) => number;
  readonly copyGlyphs: (
    handle: number,
    paragraphId: number,
    codecHandle: number,
    capabilitySet: number,
    maxOutputBytes: number,
    stableIdsPointer: number,
    stableIdsCount: number,
  ) => number;
  readonly copyDecorations: (
    handle: number,
    codecHandle: number,
    capabilitySet: number,
    paragraphId: number,
    maxOutputBytes: number,
  ) => number;
}

export interface ShaperModule {
  readonly exports: ShaperExports;
}

export async function compileDefaultWasm(): Promise<WebAssembly.Module> {
  const url = textShaperWasmUrl();
  if (url.protocol === 'file:' && typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function') {
    const fileSystem = process.getBuiltinModule('node:fs') as typeof import('node:fs');
    const bytes = fileSystem.readFileSync(url);
    return WebAssembly.compile(Uint8Array.from(bytes));
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`text shaper Wasm request failed with HTTP ${response.status}`);
  }
  return compileWasmResponse(response);
}

export function readModule(instance: WebAssembly.Instance): ShaperModule {
  const memory = instance.exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new TypeError('text shaper is missing memory');
  const functions = textShaperAbi.functions;
  const initialize = exportedFunction(instance, functions.initialize);
  const status = initialize();
  if (status !== 0) throw shaperStatusError(status, 'initialize');
  return {
    exports: {
      memory,
      allocate: exportedFunction(instance, functions.allocate),
      deallocate: exportedFunction(instance, functions.deallocate),
      registerFont: exportedFunction(instance, functions.registerFont),
      disposeFont: exportedFunction(instance, functions.disposeFont),
      fontCount: exportedFunction(instance, functions.fontCount),
      retainedFontBytes: exportedFunction(instance, functions.retainedFontBytes),
      shapePlanCount: exportedFunction(instance, functions.shapePlanCount),
      glyphOutline: exportedFunction(instance, functions.glyphOutline),
      glyphOutlinePointer: exportedFunction(instance, functions.glyphOutlinePointer),
      glyphOutlineLength: exportedFunction(instance, functions.glyphOutlineLength),
      registerFontBinding: exportedFunction(instance, functions.registerFontBinding),
      disposeFontBinding: exportedFunction(instance, functions.disposeFontBinding),
      fontBindingCount: exportedFunction(instance, functions.fontBindingCount),
      registerFontStack: exportedFunction(instance, functions.registerFontStack),
      disposeFontStack: exportedFunction(instance, functions.disposeFontStack),
      registerCodec: exportedFunction(instance, functions.registerCodec),
      disposeCodec: exportedFunction(instance, functions.disposeCodec),
      createRoot: exportedFunction(instance, functions.createRoot),
      reserveRoot: exportedFunction(instance, functions.reserveRoot),
      disposeRoot: exportedFunction(instance, functions.disposeRoot),
      requestPointer: exportedFunction(instance, functions.requestPointer),
      requestCapacity: exportedFunction(instance, functions.requestCapacity),
      reserveUpdateBatch: exportedFunction(instance, functions.reserveUpdateBatch),
      updateBatchPointer: exportedFunction(instance, functions.updateBatchPointer),
      updateBatchCapacity: exportedFunction(instance, functions.updateBatchCapacity),
      textUpdate: exportedFunction(instance, functions.textUpdate),
      textUpdateBatch: exportedFunction(instance, functions.textUpdateBatch),
      measureParagraph: exportedFunction(instance, functions.measureParagraph),
      borrowParagraphLayout: exportedFunction(instance, functions.borrowParagraphLayout),
      borrowParagraphGlyph: exportedFunction(instance, functions.borrowParagraphGlyph),
      copyGlyphs: exportedFunction(instance, functions.copyGlyphs),
      copyDecorations: exportedFunction(instance, functions.copyDecorations),
    },
  };
}

function exportedFunction(instance: WebAssembly.Instance, name: string): (...args: number[]) => number {
  const value = instance.exports[name];
  if (typeof value !== 'function') throw new TypeError(`text shaper is missing export ${name}`);
  return value as (...args: number[]) => number;
}

export function copyIntoWasm(
  exports: ShaperExports,
  bytes: Uint8Array,
): { readonly pointer: number; readonly length: number } {
  const length = bytes.byteLength;
  const pointer = exports.allocate(length);
  if (pointer === 0 && length !== 0) throw new RangeError('text shaper allocation failed');
  checkedMemoryView(exports.memory, pointer, length).set(bytes);
  return { pointer, length };
}

function checkedMemoryView(memory: WebAssembly.Memory, pointer: number, length: number): Uint8Array<ArrayBuffer> {
  uint32(pointer, 'Wasm pointer');
  uint32(length, 'Wasm length');
  if (pointer + length > memory.buffer.byteLength) {
    throw new RangeError('text shaper memory range is out of bounds');
  }
  return new Uint8Array(memory.buffer as ArrayBuffer, pointer, length);
}

function uint32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${label} must be an unsigned 32-bit integer`);
  }
  return value;
}

/**
 * Decodes glyphs `0..glyphCount` of an outline SFNT in a fresh instance, handing each result to `visit`, and returns the
 * first decode failure.
 */
async function decodeGlyphOutlines(
  module: Promise<WebAssembly.Module>,
  sfnt: Uint8Array,
  glyphCount: number,
  visit: (exports: ShaperExports, glyphId: number) => void,
): Promise<Error | undefined> {
  const { exports } = readModule(await WebAssembly.instantiate(await module, {}));
  const copied = copyIntoWasm(exports, sfnt);
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    const status = exports.glyphOutline(copied.pointer, copied.length, glyphId);
    if (status !== 0) return outlineStatusError(status, glyphId);
    visit(exports, glyphId);
  }
  return undefined;
}

/** @internal Returns the error of the first glyph of an outline SFNT that the runtime decoder refuses, if any. */
export function decodeEveryGlyphOutline(sfnt: Uint8Array, glyphCount: number): Promise<Error | undefined> {
  return decodeGlyphOutlines(defaultModule(), sfnt, glyphCount, () => {});
}

/**
 * @internal Decodes every glyph of an outline SFNT into one store. It compiles from the module the engine shared, so a
 * caller-supplied `glyph.init({ wasm })` decodes too, or from the default module when a font loads before the engine
 * starts. The bake validated every glyph, so a failure here means the artifact was corrupted after baking.
 */
export async function decodeGlyphOutlineStore(sfnt: Uint8Array, glyphCount: number): Promise<GlyphOutlineStore> {
  const builder = new GlyphOutlineStoreBuilder(glyphCount);
  const scratch = emptyGlyphOutlineView();
  const failure = await decodeGlyphOutlines(
    sharedModulePromise ?? defaultModule(),
    sfnt,
    glyphCount,
    (exports, glyphId) => {
      const result = checkedMemoryView(exports.memory, exports.glyphOutlinePointer(), exports.glyphOutlineLength());
      builder.append(viewGlyphOutline(result.buffer, result.byteOffset, 0, glyphId, scratch));
    },
  );
  if (failure !== undefined) throw failure;
  return builder.finish();
}

let sharedModulePromise: Promise<WebAssembly.Module> | undefined;

/** @internal Records the module the engine compiled, so decoding at font load uses the same Wasm. */
export function shareShaperModule(module: WebAssembly.Module): void {
  sharedModulePromise ??= Promise.resolve(module);
}

let defaultModulePromise: Promise<WebAssembly.Module> | undefined;

function defaultModule(): Promise<WebAssembly.Module> {
  defaultModulePromise ??= compileDefaultWasm().catch((error: unknown) => {
    defaultModulePromise = undefined;
    throw error;
  });
  return defaultModulePromise;
}

function outlineStatusError(status: number, glyphId: number): Error {
  const labels: Record<number, string> = {
    2: 'its outline data is malformed',
    7: 'its outline exceeds available memory',
  };
  return new Error(`text shaper could not decode glyph ${glyphId}: ${labels[status] ?? `status ${status}`}`);
}

export function shaperStatusError(status: number, action: string): Error {
  const labels: Record<number, string> = {
    1: 'invalid font handle',
    2: 'invalid shaping SFNT',
    3: 'invalid glyph extents',
    4: 'font handle conflict',
    5: 'font handle is not registered',
    6: 'invalid batch request',
    7: 'result exceeds the V0 address space',
    13: 'font stack handle is not registered',
    14: 'font is retained by a registered font stack',
  };
  return new Error(`text shaper could not ${action}: ${labels[status] ?? `status ${status}`}`);
}
