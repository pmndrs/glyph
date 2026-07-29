import type { ThreeElements } from '@react-three/fiber/webgpu';
import {
  createElement,
  isValidElement,
  use,
  useLayoutEffect,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import type { AnyFontToken, FontInput, FontToken, LoadedFont, RegisteredFont } from './font.js';
import { canonicalJson } from './internal/raster-identity.js';
import {
  isRegisteredFont,
  loadTextFont,
  sharedRasterRuntime,
  textRegistry,
  textShaper,
} from './internal/text-runtime.js';
import type { FontLoadOptions } from './loader.js';
import type { FontRegistry } from './loader.js';
import type { AnyRasterInput, AnyRasterModule, LoadedRaster, RasterRequest } from './raster.js';
import { Text as CoreText, type TextProperties, type TextSpan, type TextUpdateProperties } from './text.js';
import { sameFeatures, samePaintProperties } from './internal/text-properties.js';

export type ReactTextElement = ReactElement<ReactTextProps>;

export type TextChild = string | number | null | false | ReactTextElement;

type DistributiveOmit<Value, Keys extends PropertyKey> = Value extends unknown
  ? Omit<Value, Keys & keyof Value>
  : never;

type ReactTextCoreProps = DistributiveOmit<TextProperties, 'text' | 'spans'> & {
  readonly text?: never;
  readonly spans?: never;
  readonly children?: TextChild | readonly TextChild[];
};

export type ReactTextProps = Omit<ThreeElements['group'], keyof TextProperties | 'children' | 'ref'> &
  ReactTextCoreProps & { readonly ref?: Ref<CoreText> };

export interface UseFont {
  (input: FontInput, options?: FontLoadOptions): RegisteredFont;
  <Input extends FontInput, Module extends AnyRasterModule>(token: FontToken<Module, Input>): LoadedFont<Module, Input>;
  preload(input: FontInput, options?: FontLoadOptions): Promise<RegisteredFont>;
  preload<Input extends FontInput, Module extends AnyRasterModule>(
    token: FontToken<Module, Input>,
  ): Promise<LoadedFont<Module, Input>>;
  clear(input: FontInput | AnyFontToken): void;
}

export type LazyRaster = <Module extends AnyRasterModule>(
  load: () => Promise<Module | { readonly default: Module }>,
) => Module;

interface FlattenedText {
  readonly text: string;
  readonly spans: readonly TextSpan[];
}

type InlineTextProperties = Omit<TextSpan, 'start' | 'end'>;

interface CoreAndObjectProperties {
  readonly core: TextProperties;
  readonly object: Omit<ReactTextProps, keyof ReactTextCoreProps>;
  readonly ref: Ref<CoreText> | undefined;
}

const fontPreloads = new WeakMap<FontRegistry, Map<string, Promise<RegisteredFont>>>();
const tokenPreloads = new WeakMap<FontRegistry, WeakMap<object, Promise<LoadedFont<AnyRasterModule, FontInput>>>>();
const rasterPreloads = new WeakMap<
  RegisteredFont,
  WeakMap<AnyRasterModule, Map<string, Promise<LoadedRaster<AnyRasterModule>>>>
>();
const rawTextPreloads = new WeakMap<
  FontRegistry,
  Map<string, WeakMap<AnyRasterModule, Map<string, Promise<unknown>>>>
>();
const signalPromises = new WeakMap<AbortSignal, WeakMap<Promise<unknown>, Promise<unknown>>>();
const committedProperties = new WeakMap<CoreText, TextProperties>();
const lifecycles = new WeakMap<CoreText, number>();

export function Text(properties: ReactTextProps): ReactElement {
  const { core, object, ref } = splitProperties(properties);
  for (const dependency of textDependencies(core)) use(dependency);

  // Keep the Strict Mode double-invoked initializer resource-free. The committed layout effect
  // supplies the already-suspended properties to the retained object.
  const [text] = useState(() => new CoreText());

  useLayoutEffect(() => {
    const update = textPatch(committedProperties.get(text) ?? {}, core);
    committedProperties.set(text, core);
    if (update !== undefined) text.setProperties(update);
  }, [core, text]);

  useLayoutEffect(() => {
    const lifecycle = (lifecycles.get(text) ?? 0) + 1;
    lifecycles.set(text, lifecycle);
    return () => {
      queueMicrotask(() => {
        if (lifecycles.get(text) !== lifecycle) return;
        lifecycles.delete(text);
        committedProperties.delete(text);
        text.dispose();
      });
    };
  }, [text]);

  return createElement('primitive', { ...object, object: text, ref });
}

const useFontImplementation = ((
  input: FontInput | AnyFontToken,
  options?: FontLoadOptions,
): RegisteredFont | LoadedFont<AnyRasterModule, FontInput> => use(preloadFontValue(input, options))) as UseFont;

useFontImplementation.preload = preloadFont as UseFont['preload'];
useFontImplementation.clear = (input): void => {
  const registry = textRegistry();
  const fontCache = fontPreloads.get(registry);
  const inputKey = fontInputKey(isFontToken(input) ? input.input : input);
  const fontPromise = fontCache?.get(inputKey);
  fontCache?.delete(inputKey);
  rawTextPreloads.get(registry)?.delete(inputKey);
  let loadedPromise: Promise<RegisteredFont | LoadedFont<AnyRasterModule, FontInput>> | undefined = fontPromise;
  if (isFontToken(input)) {
    const tokenCache = tokenPreloads.get(registry);
    loadedPromise = tokenCache?.get(input) ?? loadedPromise;
    tokenCache?.delete(input);
  }
  void loadedPromise?.then(
    (loaded) => rasterPreloads.delete('font' in loaded ? loaded.font : loaded),
    () => undefined,
  );
};

export const useFont: UseFont = useFontImplementation;

export const lazyRaster: LazyRaster = <Module extends AnyRasterModule>(
  load: () => Promise<Module | { readonly default: Module }>,
): Module => {
  let pending: Promise<void> | undefined;
  let module: Module | undefined;
  let failure: unknown;

  const resolve = (): Module => {
    if (module !== undefined) return module;
    if (failure !== undefined) throw failure;
    pending ??= Promise.resolve()
      .then(load)
      .then((loaded) => {
        module = 'default' in loaded ? loaded.default : loaded;
      })
      .catch((error: unknown) => {
        failure = error;
        throw error;
      });
    throw pending;
  };

  return new Proxy(Object.create(null) as Module, {
    get(_target, property) {
      const loaded = resolve();
      return Reflect.get(loaded, property, loaded);
    },
    has(_target, property) {
      return Reflect.has(resolve(), property);
    },
    ownKeys() {
      return Reflect.ownKeys(resolve());
    },
  });
};

function preloadFont(input: FontInput, options?: FontLoadOptions): Promise<RegisteredFont>;
function preloadFont<Input extends FontInput, Module extends AnyRasterModule>(
  input: FontToken<Module, Input>,
  options?: FontLoadOptions,
): Promise<LoadedFont<Module, Input>>;
function preloadFont(
  input: FontInput | AnyFontToken,
  options: FontLoadOptions = {},
): Promise<RegisteredFont | LoadedFont<AnyRasterModule, FontInput>> {
  return preloadFontValue(input, options);
}

function preloadFontValue(
  input: FontInput | AnyFontToken,
  options: FontLoadOptions = {},
): Promise<RegisteredFont | LoadedFont<AnyRasterModule, FontInput>> {
  const registry = textRegistry();
  return isFontToken(input)
    ? withSignal(preloadToken(input, registry), options.signal)
    : withSignal(preloadInput(input, registry), options.signal);
}

function preloadInput(input: FontInput, registry: FontRegistry): Promise<RegisteredFont> {
  const key = fontInputKey(input);
  let cache = fontPreloads.get(registry);
  if (cache === undefined) {
    cache = new Map();
    fontPreloads.set(registry, cache);
  }
  let promise = cache.get(key);
  if (promise !== undefined) return promise;
  promise = loadTextFont(input, registry)
    .then(async (font) => {
      await textShaper(registry);
      return font;
    })
    .catch((error: unknown) => {
      if (cache?.get(key) === promise) cache.delete(key);
      throw error;
    });
  cache.set(key, promise);
  return promise;
}

function preloadToken(token: AnyFontToken, registry: FontRegistry): Promise<LoadedFont<AnyRasterModule, FontInput>> {
  let cache = tokenPreloads.get(registry);
  if (cache === undefined) {
    cache = new WeakMap();
    tokenPreloads.set(registry, cache);
  }
  let promise = cache.get(token);
  if (promise !== undefined) return promise;
  promise = preloadInput(token.input, registry)
    .then(async (font) => ({
      input: token.input,
      font,
      raster: await preloadRaster(font, token.raster),
    }))
    .catch((error: unknown) => {
      if (cache?.get(token) === promise) cache.delete(token);
      throw error;
    });
  cache.set(token, promise);
  return promise;
}

function textDependencies(properties: TextProperties): readonly Promise<unknown>[] {
  const rootFont = properties.font;
  if (rootFont === undefined) return [];
  const registry = isRegisteredFont(rootFont) ? textRegistry(rootFont) : textRegistry();
  const inheritedRaster = isFontToken(rootFont) ? rootFont.raster : properties.raster;
  const dependencies = [...textFontDependencies(rootFont, inheritedRaster, registry)];
  for (const span of properties.spans ?? []) {
    if (span.font !== undefined) {
      dependencies.push(...textFontDependencies(span.font, inheritedRaster, registry));
    }
  }
  return dependencies;
}

function textFontDependencies(
  font: AnyFontToken | FontInput | RegisteredFont,
  raster: AnyRasterInput | undefined,
  registry: FontRegistry,
): readonly Promise<unknown>[] {
  if (isFontToken(font)) return [preloadToken(font, registry)];
  if (isRegisteredFont(font)) {
    return [textShaper(textRegistry(font)), ...(raster === undefined ? [] : [preloadRaster(font, raster)])];
  }
  if (raster === undefined) return [preloadInput(font, registry)];
  return [preloadRawText(font, raster, registry)];
}

function preloadRawText(font: FontInput, raster: AnyRasterInput, registry: FontRegistry): Promise<unknown> {
  const request = rasterRequest(raster);
  let fonts = rawTextPreloads.get(registry);
  if (fonts === undefined) {
    fonts = new Map();
    rawTextPreloads.set(registry, fonts);
  }
  const inputKey = fontInputKey(font);
  let modules = fonts.get(inputKey);
  if (modules === undefined) {
    modules = new WeakMap();
    fonts.set(inputKey, modules);
  }
  let requests = modules.get(request.module);
  if (requests === undefined) {
    requests = new Map();
    modules.set(request.module, requests);
  }
  const key = canonicalJson(request.module.descriptor(request.options));
  let promise = requests.get(key);
  if (promise !== undefined) return promise;
  promise = preloadInput(font, registry)
    .then((loaded) => preloadRaster(loaded, raster))
    .catch((error: unknown) => {
      if (requests?.get(key) === promise) requests.delete(key);
      throw error;
    });
  requests.set(key, promise);
  return promise;
}

function preloadRaster(font: RegisteredFont, raster: AnyRasterInput): Promise<LoadedRaster<AnyRasterModule>> {
  const request = rasterRequest(raster);
  let modules = rasterPreloads.get(font);
  if (modules === undefined) {
    modules = new WeakMap();
    rasterPreloads.set(font, modules);
  }
  let requests = modules.get(request.module);
  if (requests === undefined) {
    requests = new Map();
    modules.set(request.module, requests);
  }
  const key = canonicalJson(request.module.descriptor(request.options));
  let promise = requests.get(key);
  if (promise !== undefined) return promise;
  promise = sharedRasterRuntime.load(font, request).catch((error: unknown) => {
    if (requests?.get(key) === promise) requests.delete(key);
    throw error;
  });
  requests.set(key, promise);
  return promise;
}

function withSignal<Value>(promise: Promise<Value>, signal: AbortSignal | undefined): Promise<Value> {
  if (signal === undefined) return promise;
  signal.throwIfAborted();
  let promises = signalPromises.get(signal);
  if (promises === undefined) {
    promises = new WeakMap();
    signalPromises.set(signal, promises);
  }
  const existing = promises.get(promise) as Promise<Value> | undefined;
  if (existing !== undefined) return existing;
  const detached = new Promise<Value>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
  promises.set(promise, detached);
  return detached;
}

function splitProperties(properties: ReactTextProps): CoreAndObjectProperties {
  const flattened = flattenText(properties.children);
  const core = {
    ...pickCoreProperties(properties),
    text: flattened.text,
    ...(flattened.spans.length === 0 ? {} : { spans: flattened.spans }),
  } as TextProperties;
  const object = { ...properties } as Record<string, unknown>;
  delete object.children;
  delete object.ref;
  for (const key of CORE_PROPERTY_KEYS) delete object[key];
  return { core, object: object as CoreAndObjectProperties['object'], ref: properties.ref };
}

function flattenText(children: ReactNode): FlattenedText {
  const chunks: string[] = [];
  const spans: TextSpan[] = [];
  let length = 0;

  const append = (child: ReactNode, inherited: InlineTextProperties): void => {
    if (child === null || child === undefined || child === false) return;
    if (typeof child === 'string' || typeof child === 'number') {
      const value = String(child);
      chunks.push(value);
      length += value.length;
      return;
    }
    if (Array.isArray(child)) {
      for (const entry of child) append(entry, inherited);
      return;
    }
    if (!isValidElement<ReactTextProps>(child) || child.type !== Text) {
      throw new TypeError('Text children must be strings, numbers, arrays, or nested Text elements');
    }
    for (const key of Object.keys(child.props)) {
      if (key !== 'children' && !INLINE_PROPERTY_KEY_SET.has(key)) {
        throw new TypeError(`nested Text does not accept ${key}`);
      }
    }
    if (child.props.raster !== undefined) {
      throw new TypeError('nested Text selects raster through a composed font token');
    }
    const style = { ...inherited, ...pickInlineProperties(child.props) };
    const start = length;
    const spanIndex = spans.length;
    const hasStyle = Object.keys(style).length !== 0;
    append(child.props.children, style);
    if (hasStyle && start < length) spans.splice(spanIndex, 0, { start, end: length, ...style });
  };

  append(children, {});
  return { text: chunks.join(''), spans };
}

function pickCoreProperties(properties: ReactTextProps): Omit<TextProperties, 'text' | 'spans'> {
  const result: Record<string, unknown> = {};
  for (const key of CORE_PROPERTY_KEYS) {
    if (key in properties) result[key] = Reflect.get(properties, key);
  }
  return result as Omit<TextProperties, 'text' | 'spans'>;
}

function pickInlineProperties(properties: ReactTextProps): InlineTextProperties {
  const result: Record<string, unknown> = {};
  for (const key of INLINE_PROPERTY_KEYS) {
    if (key in properties) result[key] = Reflect.get(properties, key);
  }
  return result as InlineTextProperties;
}

function textPatch(previous: TextProperties, next: TextProperties): TextUpdateProperties | undefined {
  const patch: Record<string, unknown> = {};
  if (previous.text !== next.text || !sameSpans(previous.spans ?? [], next.spans ?? [])) {
    patch.text = next.text ?? '';
    patch.spans = next.spans ?? [];
  }
  if (previous.font !== next.font || previous.raster !== next.raster) {
    patch.font = next.font;
    patch.raster = next.raster;
  }
  for (const key of UPDATE_PROPERTY_KEYS) {
    if (!sameUpdateProperty(key, previous, next)) patch[key] = next[key];
  }
  return Object.keys(patch).length === 0 ? undefined : (patch as TextUpdateProperties);
}

function sameSpans(left: readonly TextSpan[], right: readonly TextSpan[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((span, index) => {
    const other = right[index];
    if (other === undefined) return false;
    for (const key of INLINE_PROPERTY_KEYS) {
      if (key === 'features') {
        if (!sameFeatures(span.features ?? [], other.features ?? [])) return false;
      } else if (
        key !== 'color' &&
        key !== 'opacity' &&
        key !== 'outline' &&
        key !== 'shadow' &&
        span[key] !== other[key]
      ) {
        return false;
      }
    }
    return span.start === other.start && span.end === other.end && samePaintProperties(span, other);
  });
}

function sameUpdateProperty(
  key: (typeof UPDATE_PROPERTY_KEYS)[number],
  previous: TextProperties,
  next: TextProperties,
): boolean {
  if (key === 'features') return sameFeatures(previous.features ?? [], next.features ?? []);
  if (key === 'color' || key === 'opacity' || key === 'outline' || key === 'shadow') {
    return samePaintProperties(previous, next);
  }
  return previous[key] === next[key];
}

function rasterRequest(raster: AnyRasterInput): RasterRequest<AnyRasterModule> {
  return 'module' in raster
    ? { module: raster.module, options: raster.options }
    : { module: raster, options: undefined };
}

function isFontToken(value: FontInput | RegisteredFont | AnyFontToken): value is AnyFontToken {
  return typeof value === 'object' && value !== null && 'input' in value && 'raster' in value;
}

function fontInputKey(input: FontInput): string {
  if (typeof input === 'string' || input instanceof URL) return `input:${absoluteUrl(input)}`;
  return `source:${input.source === undefined ? '' : absoluteUrl(input.source)}|baked:${
    input.baked === undefined ? 'auto' : input.baked === null ? 'none' : absoluteUrl(input.baked)
  }`;
}

function absoluteUrl(value: string | URL): string {
  if (value instanceof URL) return value.href;
  const base = globalThis.location?.href;
  return base === undefined ? value : new URL(value, base).href;
}

const CORE_PROPERTY_KEYS = [
  'font',
  'raster',
  'width',
  'height',
  'maxLines',
  'wrap',
  'overflow',
  'textAlign',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'language',
  'direction',
  'features',
  'color',
  'opacity',
  'outline',
  'shadow',
  'rasterPixelRatio',
  'onLayout',
] as const satisfies readonly (keyof TextProperties)[];

const UPDATE_PROPERTY_KEYS = CORE_PROPERTY_KEYS.filter(
  (key): key is Exclude<(typeof CORE_PROPERTY_KEYS)[number], 'font' | 'raster'> => key !== 'font' && key !== 'raster',
);

const INLINE_PROPERTY_KEYS = [
  'font',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'language',
  'direction',
  'features',
  'color',
  'opacity',
  'outline',
  'shadow',
] as const satisfies readonly (keyof InlineTextProperties)[];

const INLINE_PROPERTY_KEY_SET: ReadonlySet<string> = new Set(INLINE_PROPERTY_KEYS);
