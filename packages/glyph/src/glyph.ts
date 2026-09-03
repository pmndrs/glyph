import { createGlyphEngine, shapeGlyphEngine, type GlyphEngine, type GlyphEngineOptions } from './glyph-engine.js';
import {
  invokeGlyphConfigHandleFactory,
  type AnyGlyphConfig,
  type GlyphConfigHandle,
  type GlyphHandle,
} from './config/glyph.js';
import {
  createFontFace,
  FontFaceHandleStore,
  type FontFace,
  type FontFaceConfig,
  type FontFaceDeclaredFormat,
  type FontFaceFormatDeclaration,
  type FontFaceSource,
} from './font-face.js';
import { createFontLibrary, type FontLibrary } from './loader.js';

export interface Glyph {
  readonly initialized: boolean;
  init(options?: GlyphEngineOptions): Promise<void>;
  shape(): void;
  handle<Config extends AnyGlyphConfig>(name: string, config: Config): GlyphConfigHandle<Config>;
  fontFace<const Declaration extends FontFaceFormatDeclaration = never>(
    source: FontFaceSource,
    config?: FontFaceConfig<Declaration>,
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
    const initializing = createGlyphEngine(options).then(
      (engine) => {
        this.#engine = engine;
      },
      (error: unknown) => {
        if (this.#initializing === initializing) this.#initializing = undefined;
        throw error;
      },
    );
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
        return invokeGlyphConfigHandleFactory(config, context);
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

  fontFace<const Declaration extends FontFaceFormatDeclaration = never>(
    source: FontFaceSource,
    config: FontFaceConfig<Declaration> = {},
  ): FontFace<FontFaceDeclaredFormat<Declaration>> {
    return createFontFace(this.fontLibrary, source, config);
  }
}

/** The process-local Glyph runtime. Successful initialization occurs at most once. */
const sharedFontLibrary = createFontLibrary();
const glyphRuntime = new GlyphRuntime(sharedFontLibrary);
export const glyph: Glyph = glyphRuntime;

/** @internal Shared semantic font cache used by every configured handle. */
export function glyphFontLibrary(): FontLibrary {
  return sharedFontLibrary;
}
