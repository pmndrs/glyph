import { createGlyphEngine, type GlyphEngine, type GlyphEngineOptions } from './glyph-engine.js';
import type { AnyGlyphConfig, GlyphConfigHandle, GlyphHandle, GlyphHandleFactoryContext } from './core/glyph-config.js';

export interface Glyph {
  readonly initialized: boolean;
  init(options?: GlyphEngineOptions): Promise<void>;
  handle<Config extends AnyGlyphConfig>(name: string, config: Config): GlyphConfigHandle<Config>;
}

class GlyphRuntime implements Glyph {
  readonly #handles = new Map<string, GlyphHandle>();
  #engine: GlyphEngine | undefined;
  #initializing: Promise<void> | undefined;

  get initialized(): boolean {
    return this.#engine !== undefined;
  }

  init(options: GlyphEngineOptions = {}): Promise<void> {
    if (this.#engine !== undefined) return Promise.resolve();
    if (this.#initializing !== undefined) return this.#initializing;
    const initializing = createGlyphEngine(options).then(
      (engine) => {
        this.#engine = engine;
        this.#initializing = undefined;
      },
      (error: unknown) => {
        this.#initializing = undefined;
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
      create: <Extension extends object>(extension: Extension, release: () => void): GlyphHandle & Extension => {
        if (created) throw new Error('GlyphConfig.createHandle() may create only one handle');
        if (typeof extension !== 'object' || extension === null || Array.isArray(extension)) {
          throw new TypeError('Glyph handle extension must be an object');
        }
        if (typeof release !== 'function') throw new TypeError('Glyph handle release must be a function');
        created = true;
        let disposed = false;
        const runtime = this;
        return Object.freeze({
          ...extension,
          name,
          get disposed(): boolean {
            return disposed;
          },
          dispose(): void {
            if (disposed) return;
            disposed = true;
            runtime.#handles.delete(name);
            release();
          },
        });
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
}

/** The process-local Glyph runtime. Successful initialization occurs at most once. */
export const glyph: Glyph = new GlyphRuntime();
