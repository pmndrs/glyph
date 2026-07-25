import type { RegisteredFont } from "./font.js";
import type { FontHandle } from "./identity.js";
import { getRegisteredFontData } from "./internal/registered-font.js";
import { FontRegistry } from "./loader.js";

export type TextShaperWasmSource = BufferSource | WebAssembly.Module;

export interface RuntimeShaperOptions {
  readonly registry?: FontRegistry;
  readonly wasm?: TextShaperWasmSource;
}

export interface RuntimeShaperMemoryReport {
  readonly fontCount: number;
  readonly retainedFontBytes: number;
  readonly planCount: number;
  readonly wasmMemoryBytes: number;
}

export interface RuntimeShaper {
  readonly registry: FontRegistry;
  registerFont(font: RegisteredFont): void;
  disposeFont(font: RegisteredFont): void;
  memoryReport(): RuntimeShaperMemoryReport;
  dispose(): void;
}

interface ShaperAbiV0 {
  readonly name: "pmndrs-text-shaper";
  readonly version: 0;
  readonly endianness: "little";
  readonly pointerWidth: 32;
  readonly memory: "memory";
  readonly versions: {
    readonly shaper: "0.0.0";
    readonly harfrust: "0.12.0";
    readonly harfrustCommit: "60b28ea22b5261710018d69c168a762bcb28794c";
    readonly unicode: "17.0.0";
    readonly fontFormat: 0;
  };
  readonly functions: {
    readonly allocate: string;
    readonly deallocate: string;
    readonly registerFont: string;
    readonly disposeFont: string;
    readonly fontCount: string;
    readonly retainedFontBytes: string;
    readonly planCount: string;
  };
  readonly status: { readonly ok: 0 };
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
  ) => number;
  readonly disposeFont: (handle: number) => number;
  readonly fontCount: () => number;
  readonly retainedFontBytes: () => number;
  readonly planCount: () => number;
}

const decoder = new TextDecoder();

export async function createRuntimeShaper(
  options: RuntimeShaperOptions = {},
): Promise<RuntimeShaper> {
  const source = options.wasm ?? (await fetchDefaultWasm());
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
  const instance = await WebAssembly.instantiate(module, {});
  return new RuntimeShaperImpl(options.registry ?? new FontRegistry(), readExports(instance));
}

class RuntimeShaperImpl implements RuntimeShaper {
  readonly registry: FontRegistry;
  readonly #exports: ShaperExports;
  readonly #registered = new Map<FontHandle, RegisteredFont>();
  readonly #unsubscribe: () => void;
  #disposed = false;

  constructor(registry: FontRegistry, exports: ShaperExports) {
    this.registry = registry;
    this.#exports = exports;
    this.#unsubscribe = registry._onFontDispose((font) => this.#disposeHandle(font.handle));
  }

  registerFont(font: RegisteredFont): void {
    this.#assertActive();
    if (this.registry.getByHandle(font.handle) !== font) {
      throw new TypeError("font is not active in this shaper's registry");
    }
    if (this.#registered.get(font.handle) === font) return;
    const data = getRegisteredFontData(font);
    const sfnt = copyIntoWasm(this.#exports, data.shapingSfnt);
    const extents = copyIntoWasm(this.#exports, data.glyphExtents);
    const availability = copyIntoWasm(this.#exports, data.glyphExtentsAvailability);
    try {
      const status = this.#exports.registerFont(
        font.handle,
        sfnt.pointer,
        sfnt.length,
        extents.pointer,
        extents.length,
        availability.pointer,
        availability.length,
      );
      if (status !== 0) throw shaperStatusError(status, "register font");
      this.#registered.set(font.handle, font);
    } finally {
      this.#exports.deallocate(sfnt.pointer, sfnt.length);
      this.#exports.deallocate(extents.pointer, extents.length);
      this.#exports.deallocate(availability.pointer, availability.length);
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

  #disposeHandle(handle: FontHandle): void {
    if (!this.#registered.delete(handle)) return;
    const status = this.#exports.disposeFont(handle);
    if (status !== 0 && status !== 5) throw shaperStatusError(status, "dispose font");
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("runtime shaper is disposed");
  }
}

async function fetchDefaultWasm(): Promise<ArrayBuffer> {
  const response = await fetch(new URL("./text_shaper.wasm", import.meta.url));
  if (!response.ok) {
    throw new Error(`text shaper Wasm request failed with HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

function readExports(instance: WebAssembly.Instance): ShaperExports {
  const memory = instance.exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new TypeError("text shaper is missing memory");
  const abiPointer = exportedFunction(instance, "pmndrs_text_shaper_abi_ptr")();
  const abiLength = exportedFunction(instance, "pmndrs_text_shaper_abi_len")();
  const abi = JSON.parse(
    decoder.decode(new Uint8Array(memory.buffer, abiPointer, abiLength)),
  ) as Partial<ShaperAbiV0>;
  if (
    abi.name !== "pmndrs-text-shaper" ||
    abi.version !== 0 ||
    abi.endianness !== "little" ||
    abi.pointerWidth !== 32 ||
    abi.memory !== "memory" ||
    abi.versions?.shaper !== "0.0.0" ||
    abi.versions.harfrust !== "0.12.0" ||
    abi.versions.harfrustCommit !== "60b28ea22b5261710018d69c168a762bcb28794c" ||
    abi.versions.unicode !== "17.0.0" ||
    abi.versions.fontFormat !== 0 ||
    abi.functions === undefined ||
    abi.status?.ok !== 0
  ) {
    throw new TypeError("unsupported text shaper ABI");
  }
  const functions = abi.functions;
  return {
    memory,
    allocate: exportedFunction(instance, functions.allocate),
    deallocate: exportedFunction(instance, functions.deallocate),
    registerFont: exportedFunction(instance, functions.registerFont),
    disposeFont: exportedFunction(instance, functions.disposeFont),
    fontCount: exportedFunction(instance, functions.fontCount),
    retainedFontBytes: exportedFunction(instance, functions.retainedFontBytes),
    planCount: exportedFunction(instance, functions.planCount),
  };
}

function exportedFunction(
  instance: WebAssembly.Instance,
  name: string,
): (...args: number[]) => number {
  const value = instance.exports[name];
  if (typeof value !== "function") throw new TypeError(`text shaper is missing export ${name}`);
  return value as (...args: number[]) => number;
}

function copyIntoWasm(
  exports: ShaperExports,
  bytes: Uint8Array,
): { readonly pointer: number; readonly length: number } {
  const length = bytes.byteLength;
  const pointer = exports.allocate(length);
  if (pointer === 0 && length !== 0) throw new RangeError("text shaper allocation failed");
  new Uint8Array(exports.memory.buffer, pointer, length).set(bytes);
  return { pointer, length };
}

function shaperStatusError(status: number, action: string): Error {
  const labels: Record<number, string> = {
    1: "invalid font handle",
    2: "invalid shaping SFNT",
    3: "invalid glyph extents",
    4: "font handle conflict",
    5: "font handle is not registered",
  };
  return new Error(`text shaper could not ${action}: ${labels[status] ?? `status ${status}`}`);
}
