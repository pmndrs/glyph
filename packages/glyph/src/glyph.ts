import { createGlyphEngine, shapeGlyphEngine, type GlyphEngine, type GlyphEngineOptions } from './glyph-engine.js';
import type { AnyGlyphConfig, GlyphConfigHandle, GlyphHandle } from './config/glyph.js';
import { createConfiguredGlyphHandleForConfig } from './internal/configured-handle.js';
import {
  createFontFace,
  FontFaceHandleStore,
  type AnyFontFace,
  type FontFace,
  type FontFaceConfig,
  type FontFaceDeclaredFormat,
  type FontFaceSource,
} from './font-face.js';
import { glyphFontLibrary as processFontLibrary, type FontLibrary } from './loader.js';

export interface Glyph {
  readonly initialized: boolean;
  init(options?: GlyphEngineOptions): Promise<void>;
  shape(): void;
  handle<Config extends AnyGlyphConfig>(name: string, config: Config): GlyphConfigHandle<Config>;
  fontFace(source: FontFaceSource): FontFace<never>;
  fontFace(source: FontFaceSource, config: FontFaceConfig<never>): FontFace<never>;
  fontFace<const Declaration>(
    source: FontFaceSource,
    config: FontFaceConfig<Declaration> & { readonly format: Declaration },
  ): FontFace<FontFaceDeclaredFormat<Declaration>>;
}

class GlyphRuntime implements Glyph {
  readonly #handles = new Map<string, GlyphHandle>();
  readonly fontLibrary: FontLibrary;
  #engine: GlyphEngine | undefined;
  #initializing: Promise<void> | undefined;

  constructor(fontLibrary: FontLibrary) {
    this.fontLibrary = fontLibrary;
  }

  get initialized(): boolean {
    return this.#engine !== undefined;
  }

  init(options: GlyphEngineOptions = {}): Promise<void> {
    if (this.#initializing !== undefined) return this.#initializing;
    const initializing = createGlyphEngine(options).then((engine) => {
      this.#engine = engine;
    });
    this.#initializing = initializing;
    return initializing;
  }

  handle<Config extends AnyGlyphConfig>(name: string, config: Config): GlyphConfigHandle<Config> {
    const engine = this.#engine;
    if (engine === undefined) throw new Error('await glyph.init() before creating a Glyph handle');
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new TypeError('Glyph handle name must be a nonempty string');
    }
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      throw new TypeError('Glyph handle config must be a GlyphConfig object');
    }
    if (this.#handles.has(name)) throw new Error(`Glyph handle ${JSON.stringify(name)} already exists`);

    const fonts =
      config.fonts === undefined ? undefined : new FontFaceHandleStore(config.fonts.formats, config.fonts.default);
    const context = Object.freeze({
      name,
      engine,
      fonts,
      released: (released: GlyphHandle): void => {
        if (this.#handles.get(name) === released) this.#handles.delete(name);
        fonts?.dispose();
      },
    });

    const handle = (() => {
      try {
        return createConfiguredGlyphHandleForConfig(context, config);
      } catch (error) {
        fonts?.dispose();
        throw error;
      }
    })();
    this.#handles.set(name, handle);
    return handle;
  }

  shape(): void {
    const engine = this.#engine;
    if (engine === undefined) throw new Error('await glyph.init() before calling glyph.shape()');
    shapeGlyphEngine(engine);
  }

  fontFace(source: FontFaceSource): FontFace<never>;
  fontFace(source: FontFaceSource, config: FontFaceConfig<never>): FontFace<never>;
  fontFace<const Declaration>(
    source: FontFaceSource,
    config: FontFaceConfig<Declaration> & { readonly format: Declaration },
  ): FontFace<FontFaceDeclaredFormat<Declaration>>;
  fontFace(source: FontFaceSource, config: FontFaceConfig = {}): AnyFontFace {
    return createFontFace(this.fontLibrary, source, config);
  }
}

interface GlyphHotData {
  glyphRuntime?: GlyphRuntime;
}

interface GlyphHotContext {
  readonly data: GlyphHotData;
  dispose(callback: (data: GlyphHotData) => void): void;
}

/** The process-local Glyph runtime. Initialization is attempted at most once per module lifetime. */
const hot = (import.meta as ImportMeta & { readonly hot?: GlyphHotContext }).hot;
const glyphRuntime = hot?.data.glyphRuntime ?? new GlyphRuntime(processFontLibrary());
const sharedFontLibrary = glyphRuntime.fontLibrary;
hot?.dispose((data) => {
  data.glyphRuntime = glyphRuntime;
});
export const glyph: Glyph = glyphRuntime;

/** @internal Shared semantic font cache used by every configured handle. */
export function glyphFontLibrary(): FontLibrary {
  return sharedFontLibrary;
}
