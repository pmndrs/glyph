import { DEV } from './internal/dev.js';

import type { Font, FontMetrics, RegisteredFont } from './font.js';
import type { RegisteredRaster, RasterKindOf } from './raster.js';
import type { RasterDataOf, RasterFormatMetadata } from './config/raster-format.js';
import type { CompiledRasterFont } from './config/raster.js';
import {
  bindRasterFormatCompiler,
  type BoundRasterFontCompiler,
  type RasterFontCompileInput,
  type RasterFormatCompilerWitness,
} from './internal/raster-format-compiler.js';

/** Portable application selection accepted by renderer-neutral text APIs. */
export type FontSelection<Technique extends RasterFormatMetadata> =
  | Font<Technique>
  | FontStack<Technique, Font<Technique>>;

/** Ordered immutable fonts used for shaping fallback within one text instance. */
export interface FontStack<Technique extends RasterFormatMetadata, Member extends Font<Technique> = Font<Technique>> {
  readonly fonts: readonly [Member, ...Member[]];
}

interface ImmutableFontBacking {
  readonly font: RegisteredFont;
  leases: number;
  released: boolean;
}

export interface ImmutableFontVariant<Format extends RasterFormatMetadata> {
  readonly backing: ImmutableFontBacking;
  readonly format: Format;
  readonly raster: RegisteredRaster<RasterKindOf<Format>>;
  readonly data: RasterDataOf<Format>;
  readonly compileRaster: BoundRasterFontCompiler;
  readonly releaseData: () => void;
  readonly releaseListeners: Set<() => void>;
  leases: number;
  released: boolean;
}

interface ImmutableFontState {
  readonly release: () => void;
  readonly disposeListeners: Set<() => void>;
  disposed: boolean;
}

const immutableFontStacks = new WeakSet<object>();
const immutableFontFinalizer = new FinalizationRegistry<ImmutableFontState>((state) => {
  disposeImmutableFontState(state);
});

/** Creates and authenticates an ordered, duplicate-free immutable font stack. */
export function createFontStack<Primary extends Font<RasterFormatMetadata>>(
  primary: Primary,
): FontStack<Primary['raster'], Primary>;

export function createFontStack<
  Primary extends Font<RasterFormatMetadata>,
  const Fallback extends readonly Font<RasterFormatMetadata>[],
>(
  primary: Primary,
  ...fallback: Fallback
): FontStack<Primary['raster'] | Fallback[number]['raster'], Font<Primary['raster'] | Fallback[number]['raster']>>;

export function createFontStack(
  primary: Font<RasterFormatMetadata>,
  ...fallback: readonly Font<RasterFormatMetadata>[]
): FontStack<RasterFormatMetadata, Font<RasterFormatMetadata>> {
  const fonts: [Font<RasterFormatMetadata>, ...Font<RasterFormatMetadata>[]] = [primary, ...fallback];
  assertImmutableFont(primary);
  const unique = new Set<Font<RasterFormatMetadata>>([primary]);
  for (const font of fallback) {
    assertImmutableFont(font);
    if (unique.has(font)) throw new TypeError('font stack cannot contain the same font more than once');
    unique.add(font);
  }
  const stack: FontStack<RasterFormatMetadata> = Object.freeze({ fonts: Object.freeze(fonts) });
  immutableFontStacks.add(stack);
  return stack;
}

/** @internal Authenticate one immutable stack and prove every member is live at this call. */
export function immutableFontStackFonts<Technique extends RasterFormatMetadata>(
  stack: FontStack<Technique, Font<Technique>>,
): readonly [Font<Technique>, ...Font<Technique>[]] {
  if (typeof stack !== 'object' || stack === null || !immutableFontStacks.has(stack)) {
    throw new TypeError('font stack was not created by this package');
  }
  for (const font of stack.fonts) assertImmutableFont(font);
  return stack.fonts;
}

/** @internal Authenticate a portable font selection and preserve its fallback order. */
export function immutableFontSelectionFonts<Technique extends RasterFormatMetadata>(
  selection: FontSelection<Technique>,
): readonly [Font<Technique>, ...Font<Technique>[]] {
  if (typeof selection !== 'object' || selection === null) throw new TypeError('font selection must be an object');
  if (isImmutableFontStack(selection)) return immutableFontStackFonts(selection);
  assertImmutableFont(selection);
  return [selection];
}

/** @internal Narrow a live package-owned Font or FontStack without accepting structural lookalikes. */
export function isImmutableFontSelection(value: unknown): value is FontSelection<RasterFormatMetadata> {
  if (typeof value !== 'object' || value === null) return false;
  if (immutableFontStacks.has(value)) return true;
  return value instanceof FontImpl && !value.disposed;
}

class FontImpl<Format extends RasterFormatMetadata> implements Font<Format> {
  readonly #variant: ImmutableFontVariant<Format>;
  readonly #state: ImmutableFontState;
  readonly metrics: FontMetrics;
  readonly glyphCount: number;
  readonly raster: Format;

  constructor(variant: ImmutableFontVariant<Format>) {
    retainImmutableFontVariant(variant);
    this.#variant = variant;
    this.metrics = variant.backing.font.metrics;
    this.glyphCount = variant.backing.font.glyphCount;
    this.raster = variant.format;
    this.#state = {
      release: () => releaseImmutableFontVariant(variant),
      disposeListeners: new Set(),
      disposed: false,
    };
    immutableFontFinalizer.register(this, this.#state, this);
  }

  get disposed(): boolean {
    return this.#state.disposed;
  }

  dispose(): void {
    immutableFontFinalizer.unregister(this);
    disposeImmutableFontState(this.#state);
  }

  variant(): ImmutableFontVariant<Format> {
    if (this.#state.disposed) throw new TypeError('font has been disposed');
    return this.#variant;
  }

  observeDispose(listener: () => void): () => void {
    if (this.#state.disposed) {
      listener();
      return () => undefined;
    }
    this.#state.disposeListeners.add(listener);
    return () => this.#state.disposeListeners.delete(listener);
  }
}

function disposeImmutableFontState(state: ImmutableFontState): void {
  if (state.disposed) return;
  state.disposed = true;
  for (const listener of state.disposeListeners) {
    try {
      listener();
    } catch (error) {
      reportDisposalFailure('notifying an immutable-font disposal observer', error);
    }
  }
  state.disposeListeners.clear();
  state.release();
}

/** @internal Observe explicit application disposal without wrapping the Font identity. */
export function observeImmutableFontDispose<Format extends RasterFormatMetadata>(
  font: Font<Format>,
  listener: () => void,
): () => void {
  return immutableFontImplementation(font).observeDispose(listener);
}

/** @internal Create the one backing state retained by all technique variants and leases. */
export function createImmutableFontBacking(font: RegisteredFont): ImmutableFontBacking {
  return { font, leases: 0, released: false };
}

/** @internal Create one technique-specific immutable value over a shared backing. */
export function createImmutableFontVariant<Format extends RasterFormatMetadata>(init: {
  readonly backing: ImmutableFontBacking;
  readonly format: Format &
    Pick<RasterFormatCompilerWitness<RasterDataOf<Format>>, typeof bindRasterFormatCompiler> & {
      dispose(data: RasterDataOf<Format>): void;
    };
  readonly raster: RegisteredRaster<RasterKindOf<Format>>;
  readonly data: RasterDataOf<Format>;
}): ImmutableFontVariant<Format> {
  if (init.backing.released) throw new TypeError('font backing has been released');
  init.backing.leases += 1;
  return {
    ...init,
    compileRaster: init.format[bindRasterFormatCompiler](init.data),
    releaseData: () => init.format.dispose(init.data),
    releaseListeners: new Set(),
    leases: 0,
    released: false,
  };
}

/** @internal Return an independent application lease. */
export function createImmutableFontLease<Format extends RasterFormatMetadata>(
  variant: ImmutableFontVariant<Format>,
): Font<Format> {
  return new FontImpl(variant);
}

/** @internal Return an independent application lease over the same immutable variant. */
export function cloneImmutableFont<Technique extends RasterFormatMetadata>(font: Font<Technique>): Font<Technique> {
  return createImmutableFontLease(immutableFontImplementation(font).variant());
}

/** @internal Retain a library, pending-load, engine, or renderer lease. */
export function retainImmutableFontVariant<Format extends RasterFormatMetadata>(
  variant: ImmutableFontVariant<Format>,
): void {
  if (variant.released) throw new TypeError('font variant has been released');
  variant.leases += 1;
}

/** @internal Release a library, pending-load, engine, or renderer lease. */
export function releaseImmutableFontVariant<Format extends RasterFormatMetadata>(
  variant: ImmutableFontVariant<Format>,
): void {
  if (variant.leases <= 0) throw new Error('immutable font lease underflow');
  variant.leases -= 1;
  if (variant.leases !== 0 || variant.released) return;
  variant.released = true;
  for (const listener of variant.releaseListeners) {
    try {
      listener();
    } catch (error) {
      reportDisposalFailure('notifying an immutable-variant release observer', error);
    }
  }
  variant.releaseListeners.clear();
  try {
    variant.releaseData();
  } catch (error) {
    reportDisposalFailure('releasing immutable technique data', error);
  }
  try {
    variant.raster.dispose();
  } catch (error) {
    reportDisposalFailure('releasing immutable raster data', error);
  }
  releaseImmutableFontBacking(variant.backing);
}

/** @internal Observe the final lease release of the immutable variant behind a live Font. */
export function observeImmutableFontVariantRelease<Format extends RasterFormatMetadata>(
  font: Font<Format>,
  listener: () => void,
): () => void {
  const variant = immutableFontImplementation(font).variant();
  variant.releaseListeners.add(listener);
  return () => variant.releaseListeners.delete(listener);
}

/** @internal Read package-private resources while proving the user lease is live. */
export function immutableFontResources<Technique extends RasterFormatMetadata>(
  font: Font<Technique>,
): {
  readonly font: RegisteredFont;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
} {
  const variant = immutableFontImplementation(font).variant();
  return { font: variant.backing.font, raster: variant.raster, data: variant.data };
}

/** @internal A retained package-private view used while an engine binding is live. */
export interface ImmutableFontResourceLease<Technique extends RasterFormatMetadata> {
  readonly font: RegisteredFont;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
  readonly disposed: boolean;
  dispose(): void;
}

/** @internal Return the stable identity of a live immutable technique variant. */
export function immutableFontVariantIdentity<Format extends RasterFormatMetadata>(font: Font<Format>): object {
  return immutableFontImplementation(font).variant();
}

/** @internal Compile a live immutable Font through the operation closed over its exact decoded raster data. */
export function compileImmutableFontRaster(
  font: Font<RasterFormatMetadata>,
  input: RasterFontCompileInput,
): CompiledRasterFont | undefined {
  return immutableFontImplementation(font).variant().compileRaster(input);
}

/** @internal Retain one immutable technique variant independently of its user Font wrapper. */
export function acquireImmutableFontResources<Technique extends RasterFormatMetadata>(
  font: Font<Technique>,
): ImmutableFontResourceLease<Technique> {
  return new ImmutableFontResourceLeaseImpl(immutableFontImplementation(font).variant());
}

class ImmutableFontResourceLeaseImpl<
  Technique extends RasterFormatMetadata,
> implements ImmutableFontResourceLease<Technique> {
  readonly #variant: ImmutableFontVariant<Technique>;
  #disposed = false;

  constructor(variant: ImmutableFontVariant<Technique>) {
    retainImmutableFontVariant(variant);
    this.#variant = variant;
  }

  get font(): RegisteredFont {
    this.#assertActive();
    return this.#variant.backing.font;
  }

  get raster(): RegisteredRaster<RasterKindOf<Technique>> {
    this.#assertActive();
    return this.#variant.raster;
  }

  get data(): RasterDataOf<Technique> {
    this.#assertActive();
    return this.#variant.data;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    releaseImmutableFontVariant(this.#variant);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('immutable font resource lease has been disposed');
  }
}

function releaseImmutableFontBacking(backing: ImmutableFontBacking): void {
  if (backing.leases <= 0) throw new Error('immutable font backing lease underflow');
  backing.leases -= 1;
  if (backing.leases !== 0 || backing.released) return;
  backing.released = true;
  try {
    backing.font.dispose();
  } catch (error) {
    reportDisposalFailure('releasing immutable font backing', error);
  }
}

function isImmutableFontStack<Technique extends RasterFormatMetadata>(
  selection: FontSelection<Technique>,
): selection is FontStack<Technique, Font<Technique>> {
  return immutableFontStacks.has(selection);
}

function assertImmutableFont<Format extends RasterFormatMetadata>(
  font: Font<Format>,
): asserts font is FontImpl<Format> {
  if (!(font instanceof FontImpl)) throw new TypeError('font was not created by this package');
  if (font.disposed) throw new TypeError('font has been disposed');
}

function immutableFontImplementation<Format extends RasterFormatMetadata>(font: Font<Format>): FontImpl<Format> {
  assertImmutableFont(font);
  return font;
}

function reportDisposalFailure(stage: string, error: unknown): void {
  if (DEV) console.warn(`font teardown continued after ${stage} failed: ${String(error)}`);
}
