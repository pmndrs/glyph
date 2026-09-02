import { createGlyphEngine, type GlyphEngine, type GlyphEngineOptions } from './glyph-engine.js';
import type { AnyGlyphConfig, GlyphConfigHandle, GlyphHandle, GlyphHandleFactoryContext } from './core/glyph-config.js';
import {
  createFontFace,
  type FontFace,
  type FontFaceConfig,
  type FontFaceDeclaredFormat,
  type FontFaceFormat,
  type FontFaceFormatDeclaration,
  type FontFaceSource,
} from './font-face.js';
import { createFontLibrary, type FontLibrary } from './loader.js';

export interface Glyph {
  readonly initialized: boolean;
  init(options?: GlyphEngineOptions): Promise<void>;
  handle<Config extends AnyGlyphConfig>(name: string, config: Config): GlyphConfigHandle<Config>;
  fontFace<const Declaration extends FontFaceFormatDeclaration = FontFaceFormat>(
    source: FontFaceSource,
    config?: FontFaceConfig<Declaration>,
  ): FontFace<FontFaceDeclaredFormat<Declaration>>;
}

class GlyphRuntime implements Glyph {
  readonly #handles = new Map<string, GlyphHandle>();
  readonly fontLibrary: FontLibrary = createFontLibrary();
  #engine: GlyphEngine | undefined;
  #initializing: Promise<void> | undefined;

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

    let created = false;
    const context: GlyphHandleFactoryContext = Object.freeze({
      name,
      engine,
      config,
      create: <Root extends import('./core/glyph-config.js').GlyphRoot, Extension extends (name: string) => Root>(
        extension: Extension,
        release: () => void,
      ): GlyphHandle<Root> & Extension => {
        if (created) throw new Error('GlyphConfig.createHandle() may create only one handle');
        if (typeof extension !== 'function') {
          throw new TypeError('Glyph handle extension must be a callable root selector');
        }
        if (typeof release !== 'function') throw new TypeError('Glyph handle release must be a function');
        created = true;
        let disposed = false;
        const runtime = this;
        Object.defineProperties(extension, {
          name: { enumerable: true, configurable: false, value: name },
          disposed: { enumerable: true, configurable: false, get: () => disposed },
          dispose: {
            enumerable: true,
            configurable: false,
            value: (): void => {
              if (disposed) return;
              disposed = true;
              runtime.#handles.delete(name);
              release();
            },
          },
        });
        return Object.freeze(extension) as GlyphHandle<Root> & Extension;
      },
    });

    const handle = config.createHandle(context) as GlyphConfigHandle<Config>;
    if (!created || handle.name !== name || typeof handle.dispose !== 'function') {
      try {
        handle.dispose();
      } catch {
        // Preserve the invalid factory result as the primary failure.
      }
      throw new TypeError('GlyphConfig.createHandle() must return context.create(...)');
    }
    this.#handles.set(name, handle);
    return handle;
  }

  fontFace<const Declaration extends FontFaceFormatDeclaration = FontFaceFormat>(
    source: FontFaceSource,
    config: FontFaceConfig<Declaration> = {},
  ): FontFace<FontFaceDeclaredFormat<Declaration>> {
    return createFontFace(source, config);
  }
}

/** The process-local Glyph runtime. Successful initialization occurs at most once. */
export const glyph: Glyph = new GlyphRuntime();

/** @internal Shared semantic font cache used by every configured handle. */
export function glyphFontLibrary(): FontLibrary {
  return (glyph as GlyphRuntime).fontLibrary;
}
