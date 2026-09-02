import { createGlyphEngine, type GlyphEngine, type GlyphEngineOptions } from './glyph-engine.js';
import {
  invokeGlyphConfigHandleFactory,
  type AnyGlyphConfig,
  type GlyphConfigHandle,
  type GlyphHandle,
} from './core/glyph-config.js';
import {
  createFontFace,
  FontFaceHandleStore,
  registerFontFaceHandleStore,
  unregisterFontFaceHandleStore,
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
      config.fonts === undefined
        ? undefined
        : new FontFaceHandleStore(
            this.fontLibrary,
            config.fonts.techniques,
            config.fonts.default,
            config.fonts.loadTechnique,
          );
    let created = false;
    let createdHandle: GlyphHandle | undefined;
    let handle: GlyphConfigHandle<Config> | undefined;
    const context = Object.freeze({
      name,
      engine,
      fonts,
      create: <Extension extends (name: string) => import('./core/glyph-config.js').GlyphRoot>(
        extension: Extension,
        release: () => void,
      ): GlyphHandle<ReturnType<Extension>> & Extension => {
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
              const registeredHandle = handle ?? createdHandle;
              if (registeredHandle !== undefined) unregisterFontFaceHandleStore(registeredHandle);
              let failure: unknown;
              try {
                release();
              } catch (error) {
                failure = error;
              }
              try {
                fonts?.dispose();
              } catch (error) {
                failure ??= error;
              }
              if (failure !== undefined) throw failure;
            },
          },
        });
        const configured = Object.freeze(extension) as GlyphHandle<ReturnType<Extension>> & Extension;
        createdHandle = configured;
        return configured;
      },
    });

    try {
      handle = invokeGlyphConfigHandleFactory(config, context);
    } catch (error) {
      try {
        createdHandle?.dispose();
      } catch {
        // Preserve the config factory failure as the primary error.
      }
      fonts?.dispose();
      throw error;
    }
    if (!created || handle !== createdHandle || handle.name !== name || typeof handle.dispose !== 'function') {
      try {
        handle.dispose();
      } catch {
        // Preserve the invalid factory result as the primary failure.
      }
      if (createdHandle !== handle) {
        try {
          createdHandle?.dispose();
        } catch {
          // Preserve the invalid factory result as the primary failure.
        }
      }
      fonts?.dispose();
      throw new TypeError('GlyphConfig.createHandle() must return context.create(...)');
    }
    if (fonts !== undefined) registerFontFaceHandleStore(handle, fonts);
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
const sharedFontLibrary = createFontLibrary();
const glyphRuntime = new GlyphRuntime(sharedFontLibrary);
export const glyph: Glyph = glyphRuntime;

/** @internal Shared semantic font cache used by every configured handle. */
export function glyphFontLibrary(): FontLibrary {
  return sharedFontLibrary;
}
