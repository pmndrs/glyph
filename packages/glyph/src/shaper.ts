import type { RegisteredFont } from './font.js';
import type { FontHandle } from './identity.js';
import { getRegisteredFontData } from './internal/registered-font.js';
import { readGlyphOutline, type GlyphOutlineContour } from './glyph-outline.js';
import type { BorrowedGlyph } from './layout.js';
import { FontRegistry } from './loader.js';
import {
  checkedMemoryView,
  copyIntoWasm,
  fetchDefaultWasm,
  outlineStatusError,
  readModule,
  shaperStatusError,
  type ShaperExports,
  type ShaperModule,
} from './internal/text-shaper-module.js';

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
  readonly shapePlanCount: number;
  readonly wasmMemoryBytes: number;
}

export interface RuntimeShaper {
  readonly registry: RuntimeShaperFontRegistry;
  registerFont(font: RegisteredFont): void;
  disposeFont(font: RegisteredFont): void;
  /** @internal */
  glyphOutline(glyph: BorrowedGlyph): GlyphOutlineContour[];
  memoryReport(): RuntimeShaperMemoryReport;
  dispose(): void;
}

/** @internal Shared direct-memory access for the retained text-engine host. */
export function runtimeShaperEngineExports(shaper: RuntimeShaper): ShaperExports {
  if (!(shaper instanceof RuntimeShaperImpl)) throw new TypeError('runtime shaper was not created by this package');
  shaper._assertEngineAccess();
  return shaper._engineExports();
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
  readonly #outlineSfnts = new Map<FontHandle, { readonly pointer: number; readonly length: number }>();
  readonly #unsubscribe: () => void;
  #disposed = false;

  constructor(registry: RuntimeShaperFontRegistry, module: ShaperModule) {
    this.registry = registry;
    this.#exports = module.exports;
    this.#unsubscribe = registry._onFontDispose((font) => {
      this.#releaseOutlineSfnt(font.handle);
      this.#disposeHandle(font.handle);
    });
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

  glyphOutline(glyph: BorrowedGlyph): GlyphOutlineContour[] {
    this.#assertActive();
    const font = this.registry.getByHandle(glyph.fontHandle as FontHandle);
    if (font === undefined) throw new Error('laid-out glyph font is not registered with this shaper');
    let sfnt = this.#outlineSfnts.get(font.handle);
    if (sfnt === undefined) {
      const bytes = getRegisteredFontData(font).glyphOutlines;
      if (bytes === undefined) throw new TypeError('font was baked without outlines; bake it with --outlines');
      sfnt = copyIntoWasm(this.#exports, bytes);
      this.#outlineSfnts.set(font.handle, sfnt);
    }
    const status = this.#exports.glyphOutline(sfnt.pointer, sfnt.length, glyph.glyphId);
    if (status !== 0) throw outlineStatusError(status, glyph.glyphId);
    const encoded = checkedMemoryView(
      this.#exports.memory,
      this.#exports.glyphOutlinePointer(),
      this.#exports.glyphOutlineLength(),
    );
    return readGlyphOutline(encoded, font.metrics.unitsPerEm, glyph);
  }

  #releaseOutlineSfnt(handle: FontHandle): void {
    const sfnt = this.#outlineSfnts.get(handle);
    if (sfnt === undefined) return;
    this.#outlineSfnts.delete(handle);
    this.#exports.deallocate(sfnt.pointer, sfnt.length);
  }

  memoryReport(): RuntimeShaperMemoryReport {
    this.#assertActive();
    return {
      fontCount: this.#exports.fontCount(),
      retainedFontBytes: this.#exports.retainedFontBytes(),
      shapePlanCount: this.#exports.shapePlanCount(),
      wasmMemoryBytes: this.#exports.memory.buffer.byteLength,
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#unsubscribe();
    for (const handle of [...this.#outlineSfnts.keys()]) this.#releaseOutlineSfnt(handle);
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

/** Packs a decoration metric pair as `(position << 16) | value`, both i16 bit patterns, matching the Wasm ABI. */
function packDecorationMetrics(position: number, value: number): number {
  return (((position & 0xffff) << 16) | (value & 0xffff)) >>> 0;
}
