import { GlyphError } from '../glyph-error.js';
import { textShaperAbi } from '../generated/text-shaper-abi.js';
import { compileWasmResponse } from './compile-wasm-response.js';
import { textShaperWasmUrl } from './shaper-wasm-url.js';

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
  readonly resetRoot: (handle: number) => number;
  readonly disposeRoot: (handle: number) => number;
  readonly requestPointer: (handle: number) => number;
  readonly requestCapacity: (handle: number) => number;
  readonly reserveUpdateBatch: (count: number) => number;
  readonly updateBatchPointer: () => number;
  readonly updateBatchCapacity: () => number;
  readonly textUpdate: (handle: number, pointer: number, length: number) => number;
  readonly textUpdateBatch: (entriesPointer: number, count: number) => number;
  readonly measureParagraph: (handle: number, pointer: number, length: number, paragraphId: number) => number;
  readonly prepareBatch: (entriesPointer: number, count: number) => number;
  readonly borrowParagraphLayout: (handle: number, paragraphId: number) => number;
  readonly borrowParagraphGlyphs: (
    handle: number,
    paragraphId: number,
    generation: number,
    start: number,
    count: number,
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
  /** Where every editing query writes its fixed answer record. */
  readonly textQueryPointer: () => number;
  /** The rectangles the last range query wrote. */
  readonly textRectsPointer: () => number;
  readonly textCaret: (handle: number, paragraphId: number, offset: number, affinity: number) => number;
  readonly textHitTest: (handle: number, paragraphId: number, x: number, y: number) => number;
  readonly textMove: (
    handle: number,
    paragraphId: number,
    offset: number,
    affinity: number,
    direction: number,
    unit: number,
    goalX: number,
  ) => number;
  readonly textBoundary: (
    handle: number,
    paragraphId: number,
    offset: number,
    affinity: number,
    unit: number,
  ) => number;
  readonly textRangeRects: (handle: number, paragraphId: number, start: number, end: number) => number;
  readonly textCheckRange: (handle: number, paragraphId: number, start: number, end: number) => number;
}

export interface ShaperModule {
  /**
   * The one gateway to the engine. Every function traps through it: a `WebAssembly.RuntimeError` means the
   * instance stopped mid-mutation and nothing in it can be trusted, so the gateway replaces the instance, lets
   * each owner restate what it had registered, and throws {@link GlyphEngineRestartError} to the caller.
   */
  readonly exports: ShaperExports;
  /** Registers an owner that restates its engine registrations on a fresh instance. Owners run in order. */
  onRestart(listener: () => void): () => void;
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

function readExports(instance: WebAssembly.Instance): ShaperExports {
  const memory = instance.exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new TypeError('text shaper is missing memory');
  const functions = textShaperAbi.functions;
  const versionExport = instance.exports[functions.abiVersion];
  if (typeof versionExport !== 'function') {
    throw new TypeError(
      `incompatible text shaper Wasm ABI: expected ${textShaperAbi.version}; unversioned legacy modules are unsupported`,
    );
  }
  const version: unknown = versionExport();
  if (version !== textShaperAbi.version) {
    throw new TypeError(
      `incompatible text shaper Wasm ABI: expected ${textShaperAbi.version}, received ${String(version)}`,
    );
  }
  const initialize = exportedFunction(instance, functions.initialize);
  const status = initialize();
  if (status !== 0) throw shaperStatusError(status, 'initialize');
  return {
    memory,
    allocate: exportedFunction(instance, functions.allocate),
    deallocate: exportedFunction(instance, functions.deallocate),
    registerFont: exportedFunction(instance, functions.registerFont),
    disposeFont: exportedFunction(instance, functions.disposeFont),
    fontCount: exportedFunction(instance, functions.fontCount),
    retainedFontBytes: exportedFunction(instance, functions.retainedFontBytes),
    shapePlanCount: exportedFunction(instance, functions.shapePlanCount),
    registerFontBinding: exportedFunction(instance, functions.registerFontBinding),
    disposeFontBinding: exportedFunction(instance, functions.disposeFontBinding),
    fontBindingCount: exportedFunction(instance, functions.fontBindingCount),
    registerFontStack: exportedFunction(instance, functions.registerFontStack),
    disposeFontStack: exportedFunction(instance, functions.disposeFontStack),
    registerCodec: exportedFunction(instance, functions.registerCodec),
    disposeCodec: exportedFunction(instance, functions.disposeCodec),
    createRoot: exportedFunction(instance, functions.createRoot),
    reserveRoot: exportedFunction(instance, functions.reserveRoot),
    resetRoot: exportedFunction(instance, functions.resetRoot),
    disposeRoot: exportedFunction(instance, functions.disposeRoot),
    requestPointer: exportedFunction(instance, functions.requestPointer),
    requestCapacity: exportedFunction(instance, functions.requestCapacity),
    reserveUpdateBatch: exportedFunction(instance, functions.reserveUpdateBatch),
    updateBatchPointer: exportedFunction(instance, functions.updateBatchPointer),
    updateBatchCapacity: exportedFunction(instance, functions.updateBatchCapacity),
    textUpdate: exportedFunction(instance, functions.textUpdate),
    textUpdateBatch: exportedFunction(instance, functions.textUpdateBatch),
    measureParagraph: exportedFunction(instance, functions.measureParagraph),
    prepareBatch: exportedFunction(instance, functions.prepareBatch),
    borrowParagraphLayout: exportedFunction(instance, functions.borrowParagraphLayout),
    borrowParagraphGlyphs: exportedFunction(instance, functions.borrowParagraphGlyphs),
    copyGlyphs: exportedFunction(instance, functions.copyGlyphs),
    copyDecorations: exportedFunction(instance, functions.copyDecorations),
    textQueryPointer: exportedFunction(instance, functions.textQueryPointer),
    textRectsPointer: exportedFunction(instance, functions.textRectsPointer),
    textCaret: exportedFunction(instance, functions.textCaret),
    textHitTest: exportedFunction(instance, functions.textHitTest),
    textMove: exportedFunction(instance, functions.textMove),
    textBoundary: exportedFunction(instance, functions.textBoundary),
    textRangeRects: exportedFunction(instance, functions.textRangeRects),
    textCheckRange: exportedFunction(instance, functions.textCheckRange),
  };
}

/** Thrown by the call during which the engine trapped. The engine was replaced; the same call may be made again. */
export class GlyphEngineRestartError extends GlyphError<'engine-failed'> {
  /** Whether a fresh engine instance is already live, so the call that threw can simply be made again. */
  readonly restarted: boolean;

  constructor(message: string, cause: unknown, restarted = false) {
    super('engine-failed', message, { cause });
    this.name = 'GlyphEngineRestartError';
    this.restarted = restarted;
  }
}

/**
 * Wraps one instance of the shaper module behind a facade that survives the instance. `module` is retained so a
 * trapped instance can be replaced; `instance` is its first instantiation.
 */
export function readModule(instance: WebAssembly.Instance, module?: WebAssembly.Module): ShaperModule {
  let current = readExports(instance);
  /** `replaying` admits the owners restating themselves; `dead` admits nothing until an instance lands. */
  let state: 'live' | 'replaying' | 'dead' = 'live';
  let failure: unknown;
  /** What every call throws while the engine is dead: one failure, however many frames try again. */
  let dead: GlyphEngineRestartError | undefined;
  const listeners = new Set<() => void>();
  const replay = (replacement: WebAssembly.Instance): void => {
    current = readExports(replacement);
    state = 'replaying';
    try {
      for (const listener of listeners) listener();
      state = 'live';
    } catch (error) {
      state = 'dead';
      failure = error;
      dead = undefined;
      throw error;
    }
  };
  const restart = (cause: unknown): never => {
    failure = cause;
    dead = undefined;
    // A trap while owners restate themselves, or without a module to instantiate, leaves nothing to restart from.
    if (state !== 'live' || module === undefined) {
      state = 'dead';
      throw new GlyphEngineRestartError('the text engine trapped and cannot be restarted', cause);
    }
    state = 'dead';
    let replacement: WebAssembly.Instance | undefined;
    try {
      replacement = new WebAssembly.Instance(module, {});
    } catch {
      // Some hosts refuse to instantiate a module of this size synchronously on the main thread.
    }
    if (replacement === undefined) {
      void WebAssembly.instantiate(module, {})
        .then(replay)
        .catch(() => undefined);
      throw new GlyphEngineRestartError('the text engine trapped and is restarting', cause);
    }
    try {
      replay(replacement);
    } catch (error) {
      throw new GlyphEngineRestartError('the text engine trapped and could not restate its registrations', error);
    }
    throw new GlyphEngineRestartError('the text engine trapped and was restarted', cause, true);
  };
  const facade: Record<string, unknown> = {};
  for (const name of Object.keys(current) as (keyof ShaperExports)[]) {
    if (name === 'memory') continue;
    facade[name] = (...parameters: number[]): number => {
      if (state === 'dead') throw (dead ??= new GlyphEngineRestartError('the text engine is restarting', failure));
      try {
        return (current[name] as (...parameters: number[]) => number)(...parameters);
      } catch (error) {
        if (error instanceof WebAssembly.RuntimeError) return restart(error);
        throw error;
      }
    };
  }
  Object.defineProperty(facade, 'memory', { enumerable: true, get: () => current.memory });
  return {
    exports: facade as unknown as ShaperExports,
    onRestart(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
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
