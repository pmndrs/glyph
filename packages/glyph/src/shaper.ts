import type { RegisteredFont } from './font.js';
import { textShaperAbi } from './generated/text-shaper-abi.js';
import { textShaperWasmUrl } from './internal/shaper-wasm-url.js';
import type { FontHandle } from './identity.js';
import { getRegisteredFontData } from './internal/registered-font.js';
import { FontRegistry } from './loader.js';

export type TextShaperWasmSource = BufferSource | WebAssembly.Module;

/** @internal Minimal registry contract required by the Wasm shaper. */
export interface RuntimeShaperFontRegistry {
  getByHandle(handle: FontHandle): RegisteredFont | undefined;
  _onFontDispose(listener: (font: RegisteredFont) => void): () => void;
}

export interface RuntimeShaperOptions {
  readonly registry?: RuntimeShaperFontRegistry;
  readonly wasm?: TextShaperWasmSource;
}

export interface RuntimeShaperMemoryReport {
  readonly fontCount: number;
  readonly retainedFontBytes: number;
  readonly planCount: number;
  readonly wasmMemoryBytes: number;
}

export interface RuntimeShaper {
  readonly registry: RuntimeShaperFontRegistry;
  registerFont(font: RegisteredFont): void;
  disposeFont(font: RegisteredFont): void;
  memoryReport(): RuntimeShaperMemoryReport;
  dispose(): void;
}

/** @internal Shared direct-memory access for the retained text-engine host. */
export function runtimeShaperEngineExports(shaper: RuntimeShaper): ShaperExports {
  if (!(shaper instanceof RuntimeShaperImpl)) throw new TypeError('runtime shaper was not created by this package');
  shaper._assertEngineAccess();
  return shaper._engineExports();
}

interface ShaperExports {
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
  readonly planCount: () => number;
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
  readonly createPlanner: (
    handle: number,
    requestCapacity: number,
    resultCapacity: number,
    textCapacity: number,
  ) => number;
  readonly reservePlanner: (
    handle: number,
    requestCapacity: number,
    resultCapacity: number,
    textCapacity: number,
  ) => number;
  readonly disposePlanner: (handle: number) => number;
  readonly requestPointer: (handle: number) => number;
  readonly requestCapacity: (handle: number) => number;
  readonly reserveUpdateBatch: (count: number) => number;
  readonly updateBatchPointer: () => number;
  readonly updateBatchCapacity: () => number;
  readonly textUpdate: (handle: number, pointer: number, length: number) => number;
  readonly textUpdateBatch: (entriesPointer: number, count: number) => number;
  readonly measureParagraph: (handle: number, pointer: number, length: number, paragraphId: number) => number;
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

interface ShaperModule {
  readonly exports: ShaperExports;
}

export async function createRuntimeShaper(options: RuntimeShaperOptions = {}): Promise<RuntimeShaper> {
  const source = options.wasm ?? (await fetchDefaultWasm());
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
  const instance = await WebAssembly.instantiate(module, {});
  const resolved = readModule(instance);
  return new RuntimeShaperImpl(options.registry ?? new FontRegistry(), resolved);
}

class RuntimeShaperImpl implements RuntimeShaper {
  readonly registry: RuntimeShaperFontRegistry;
  readonly #exports: ShaperExports;
  readonly #registered = new Map<FontHandle, RegisteredFont | undefined>();
  readonly #unsubscribe: () => void;
  #disposed = false;

  constructor(registry: RuntimeShaperFontRegistry, module: ShaperModule) {
    this.registry = registry;
    this.#exports = module.exports;
    this.#unsubscribe = registry._onFontDispose((font) => this.#disposeHandle(font.handle));
  }

  registerFont(font: RegisteredFont): void {
    this.#assertActive();
    if (this.registry.getByHandle(font.handle) !== font) {
      throw new TypeError("font is not active in this shaper's registry");
    }
    if (this.#registered.get(font.handle) === font) return;
    const data = getRegisteredFontData(font);
    this.#registerFontBytes(
      font.handle,
      data.shapingSfnt,
      data.glyphExtents,
      data.glyphExtentsAvailability,
      packDecorationMetrics(font.metrics.underlinePosition, font.metrics.underlineThickness),
      packDecorationMetrics(font.metrics.strikeoutPosition, font.metrics.strikeoutSize),
    );
    this.#registered.set(font.handle, font);
  }

  #registerFontBytes(
    handle: FontHandle,
    shapingSfnt: Uint8Array,
    glyphExtents: Uint8Array,
    glyphExtentsAvailability: Uint8Array,
    underlinePacked: number,
    strikeoutPacked: number,
  ): void {
    let sfnt: { readonly pointer: number; readonly length: number } | undefined;
    let extents: { readonly pointer: number; readonly length: number } | undefined;
    let availability: { readonly pointer: number; readonly length: number } | undefined;
    try {
      sfnt = copyIntoWasm(this.#exports, shapingSfnt);
      extents = copyIntoWasm(this.#exports, glyphExtents);
      availability = copyIntoWasm(this.#exports, glyphExtentsAvailability);
      const status = this.#exports.registerFont(
        handle,
        sfnt.pointer,
        sfnt.length,
        extents.pointer,
        extents.length,
        availability.pointer,
        availability.length,
        underlinePacked,
        strikeoutPacked,
      );
      if (status !== 0) throw shaperStatusError(status, 'register font');
    } finally {
      if (availability !== undefined) {
        this.#exports.deallocate(availability.pointer, availability.length);
      }
      if (extents !== undefined) this.#exports.deallocate(extents.pointer, extents.length);
      if (sfnt !== undefined) this.#exports.deallocate(sfnt.pointer, sfnt.length);
    }
  }

  disposeFont(font: RegisteredFont): void {
    this.#assertActive();
    if (this.#registered.get(font.handle) === font) this.#disposeHandle(font.handle);
  }

  memoryReport(): RuntimeShaperMemoryReport {
    this.#assertActive();
    return {
      fontCount: this.#exports.fontCount(),
      retainedFontBytes: this.#exports.retainedFontBytes(),
      planCount: this.#exports.planCount(),
      wasmMemoryBytes: this.#exports.memory.buffer.byteLength,
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#unsubscribe();
    for (const handle of [...this.#registered.keys()]) this.#disposeHandle(handle);
    this.#disposed = true;
  }

  /** @internal */
  _engineExports(): ShaperExports {
    return this.#exports;
  }

  /** @internal */
  _assertEngineAccess(): void {
    this.#assertActive();
  }

  #disposeHandle(handle: FontHandle): void {
    if (!this.#registered.has(handle)) return;
    const status = this.#exports.disposeFont(handle);
    if (status !== 0 && status !== 5) throw shaperStatusError(status, 'dispose font');
    this.#registered.delete(handle);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('runtime shaper is disposed');
  }
}

async function fetchDefaultWasm(): Promise<ArrayBuffer> {
  const url = textShaperWasmUrl();
  if (url.protocol === 'file:' && typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function') {
    const fileSystem = process.getBuiltinModule('node:fs') as typeof import('node:fs');
    const bytes = fileSystem.readFileSync(url);
    return Uint8Array.from(bytes).buffer;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`text shaper Wasm request failed with HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

function readModule(instance: WebAssembly.Instance): ShaperModule {
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
      planCount: exportedFunction(instance, functions.planCount),
      registerFontBinding: exportedFunction(instance, functions.registerFontBinding),
      disposeFontBinding: exportedFunction(instance, functions.disposeFontBinding),
      fontBindingCount: exportedFunction(instance, functions.fontBindingCount),
      registerFontStack: exportedFunction(instance, functions.registerFontStack),
      disposeFontStack: exportedFunction(instance, functions.disposeFontStack),
      registerCodec: exportedFunction(instance, functions.registerCodec),
      disposeCodec: exportedFunction(instance, functions.disposeCodec),
      createPlanner: exportedFunction(instance, functions.createPlanner),
      reservePlanner: exportedFunction(instance, functions.reservePlanner),
      disposePlanner: exportedFunction(instance, functions.disposePlanner),
      requestPointer: exportedFunction(instance, functions.requestPointer),
      requestCapacity: exportedFunction(instance, functions.requestCapacity),
      reserveUpdateBatch: exportedFunction(instance, functions.reserveUpdateBatch),
      updateBatchPointer: exportedFunction(instance, functions.updateBatchPointer),
      updateBatchCapacity: exportedFunction(instance, functions.updateBatchCapacity),
      textUpdate: exportedFunction(instance, functions.textUpdate),
      textUpdateBatch: exportedFunction(instance, functions.textUpdateBatch),
      measureParagraph: exportedFunction(instance, functions.measureParagraph),
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

function copyIntoWasm(
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

/** Packs a decoration metric pair as `(position << 16) | value`, both i16 bit patterns, matching the Wasm ABI. */
function packDecorationMetrics(position: number, value: number): number {
  return (((position & 0xffff) << 16) | (value & 0xffff)) >>> 0;
}

function shaperStatusError(status: number, action: string): Error {
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
