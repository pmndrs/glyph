import type { FontInput, LoadedFont, RegisteredFont } from '../font.js';
import { FontLoader, FontRegistry, isPackageRegisteredFont, registeredFontRegistry } from '../loader.js';
import { RasterRuntime } from '../raster-runtime.js';
import type { AnyRasterModule, LoadedRaster, RasterRequest } from '../raster.js';
import { createRuntimeShaper, type RuntimeShaper } from '../shaper.js';

const loaders = new WeakMap<FontRegistry, FontLoader>();
const shapers = new WeakMap<FontRegistry, Promise<RuntimeShaper>>();
const resolvedShapers = new WeakMap<FontRegistry, RuntimeShaper>();
let defaultRegistry: FontRegistry | undefined;

export const sharedRasterRuntime: RasterRuntime = new RasterRuntime();

export function textRegistry(font?: RegisteredFont): FontRegistry {
  if (font !== undefined) return registeredFontRegistry(font);
  defaultRegistry ??= new FontRegistry();
  return defaultRegistry;
}

export function loadTextFont(input: FontInput, registry: FontRegistry, signal?: AbortSignal): Promise<RegisteredFont> {
  return textLoader(registry).load(input, signal === undefined ? undefined : { signal });
}

export function loadedTextFont(input: FontInput, registry: FontRegistry): RegisteredFont | undefined {
  return textLoader(registry)._peek(input);
}

export function textShaper(registry: FontRegistry): Promise<RuntimeShaper> {
  let promise = shapers.get(registry);
  if (promise === undefined) {
    promise = createRuntimeShaper({ registry }).then(
      (shaper) => {
        resolvedShapers.set(registry, shaper);
        return shaper;
      },
      (error: unknown) => {
        shapers.delete(registry);
        throw error;
      },
    );
    shapers.set(registry, promise);
  }
  return promise;
}

export function loadedTextShaper(registry: FontRegistry): RuntimeShaper | undefined {
  return resolvedShapers.get(registry);
}

function textLoader(registry: FontRegistry): FontLoader {
  let loader = loaders.get(registry);
  if (loader === undefined) {
    loader = new FontLoader({ registry });
    loaders.set(registry, loader);
  }
  return loader;
}

export async function loadTextToken<Module extends AnyRasterModule, Input extends FontInput>(
  token: { readonly input: Input; readonly raster: RasterRequest<Module> },
  registry: FontRegistry,
  signal?: AbortSignal,
): Promise<LoadedFont<Module, Input>> {
  const font = await loadTextFont(token.input, registry, signal);
  const raster = await sharedRasterRuntime.load(font, token.raster, signal === undefined ? undefined : { signal });
  await textShaper(registry);
  signal?.throwIfAborted();
  return { input: token.input, font, raster };
}

export function isRegisteredFont(value: unknown): value is RegisteredFont {
  return isPackageRegisteredFont(value);
}

export type LoadedAnyRaster = LoadedRaster<AnyRasterModule>;
