import { DEV } from './internal/dev.js';

import type { Font, FontMetrics, RegisteredFont } from './font.js';
import type { RegisteredRaster, RasterKindOf } from './raster.js';
import type { AnyRasterTechnique, RasterDataOf } from './raster-technique.js';

/** Portable application selection accepted by renderer-neutral text APIs. */
export type FontSelection<Technique extends AnyRasterTechnique> =
  | Font<Technique>
  | FontStack<Technique, Font<Technique>>;

/** Ordered immutable fonts used for shaping fallback within one text instance. */
export interface FontStack<Technique extends AnyRasterTechnique, Member extends Font<Technique> = Font<Technique>> {
  readonly fonts: readonly [Member, ...Member[]];
}

type TechniqueOfFont<Value> = Value extends Font<infer Technique> ? Technique : never;

interface ImmutableFontBacking {
  readonly font: RegisteredFont;
  leases: number;
  released: boolean;
}

export interface ImmutableFontVariant<Technique extends AnyRasterTechnique> {
  readonly backing: ImmutableFontBacking;
  readonly technique: Technique;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
  readonly releaseListeners: Set<() => void>;
  leases: number;
  released: boolean;
}

interface ImmutableFontState {
  readonly variant: ImmutableFontVariant<AnyRasterTechnique>;
  readonly disposeListeners: Set<() => void>;
  disposed: boolean;
}

const immutableFontState = new WeakMap<Font<AnyRasterTechnique>, ImmutableFontState>();
const immutableFontStacks = new WeakSet<object>();

/** Creates and authenticates an ordered, duplicate-free immutable font stack. */
export function createFontStack<
  const Primary extends Font<AnyRasterTechnique>,
  const Fallback extends readonly Font<AnyRasterTechnique>[],
>(
  primary: Primary,
  ...fallback: Fallback
): FontStack<TechniqueOfFont<Primary | Fallback[number]>, Font<TechniqueOfFont<Primary | Fallback[number]>>>;

export function createFontStack(
  primary: Font<AnyRasterTechnique>,
  ...fallback: readonly Font<AnyRasterTechnique>[]
): FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>> {
  const fonts = [primary, ...fallback];
  assertImmutableFont(primary);
  const unique = new Set<Font<AnyRasterTechnique>>([primary]);
  for (const font of fallback) {
    assertImmutableFont(font);
    if (unique.has(font)) throw new TypeError('font stack cannot contain the same font more than once');
    unique.add(font);
  }
  const stack = Object.freeze({ fonts: Object.freeze(fonts) }) as FontStack<AnyRasterTechnique>;
  immutableFontStacks.add(stack);
  return stack;
}

/** @internal Authenticate one immutable stack and prove every member is live at this call. */
export function immutableFontStackFonts(
  stack: FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>,
): readonly [Font<AnyRasterTechnique>, ...Font<AnyRasterTechnique>[]] {
  if (typeof stack !== 'object' || stack === null || !immutableFontStacks.has(stack)) {
    throw new TypeError('font stack was not created by this package');
  }
  for (const font of stack.fonts) assertImmutableFont(font);
  return stack.fonts;
}

/** @internal Authenticate a portable font selection and preserve its fallback order. */
export function immutableFontSelectionFonts<Technique extends AnyRasterTechnique>(
  selection: FontSelection<Technique>,
): readonly [Font<Technique>, ...Font<Technique>[]] {
  if (typeof selection !== 'object' || selection === null) throw new TypeError('font selection must be an object');
  if ('fonts' in selection) {
    return immutableFontStackFonts(selection as FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>) as readonly [
      Font<Technique>,
      ...Font<Technique>[],
    ];
  }
  assertImmutableFont(selection);
  return [selection];
}

class FontImpl<Technique extends AnyRasterTechnique> implements Font<Technique> {
  readonly metrics: FontMetrics;
  readonly glyphCount: number;
  readonly technique: Technique;

  constructor(variant: ImmutableFontVariant<Technique>) {
    retainImmutableFontVariant(variant);
    this.metrics = variant.backing.font.metrics;
    this.glyphCount = variant.backing.font.glyphCount;
    this.technique = variant.technique;
    immutableFontState.set(this, { variant, disposeListeners: new Set(), disposed: false });
  }

  get disposed(): boolean {
    return immutableStateOf(this).disposed;
  }

  dispose(): void {
    const state = immutableStateOf(this);
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
    releaseImmutableFontVariant(state.variant);
  }
}

/** @internal Observe explicit application disposal without wrapping the Font identity. */
export function observeImmutableFontDispose(font: Font<AnyRasterTechnique>, listener: () => void): () => void {
  const state = immutableStateOf(font);
  if (state.disposed) {
    listener();
    return () => undefined;
  }
  state.disposeListeners.add(listener);
  return () => state.disposeListeners.delete(listener);
}

/** @internal Create the one backing state retained by all technique variants and leases. */
export function createImmutableFontBacking(font: RegisteredFont): ImmutableFontBacking {
  return { font, leases: 0, released: false };
}

/** @internal Create one technique-specific immutable value over a shared backing. */
export function createImmutableFontVariant<Technique extends AnyRasterTechnique>(init: {
  readonly backing: ImmutableFontBacking;
  readonly technique: Technique;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
}): ImmutableFontVariant<Technique> {
  if (init.backing.released) throw new TypeError('font backing has been released');
  init.backing.leases += 1;
  return { ...init, releaseListeners: new Set(), leases: 0, released: false };
}

/** @internal Return an independent application lease. */
export function createImmutableFontLease<Technique extends AnyRasterTechnique>(
  variant: ImmutableFontVariant<Technique>,
): Font<Technique> {
  return new FontImpl(variant);
}

/** @internal Return an independent application lease over the same immutable variant. */
export function cloneImmutableFont<Technique extends AnyRasterTechnique>(font: Font<Technique>): Font<Technique> {
  assertImmutableFont(font);
  return createImmutableFontLease(immutableStateOf(font).variant as ImmutableFontVariant<Technique>);
}

/** @internal Retain a library, pending-load, engine, or renderer lease. */
export function retainImmutableFontVariant(variant: ImmutableFontVariant<AnyRasterTechnique>): void {
  if (variant.released) throw new TypeError('font variant has been released');
  variant.leases += 1;
}

/** @internal Release a library, pending-load, engine, or renderer lease. */
export function releaseImmutableFontVariant(variant: ImmutableFontVariant<AnyRasterTechnique>): void {
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
    (variant.technique as unknown as { dispose(data: unknown): void }).dispose(variant.data);
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
export function observeImmutableFontVariantRelease(font: Font<AnyRasterTechnique>, listener: () => void): () => void {
  assertImmutableFont(font);
  const variant = immutableStateOf(font).variant;
  variant.releaseListeners.add(listener);
  return () => variant.releaseListeners.delete(listener);
}

/** @internal Read package-private resources while proving the user lease is live. */
export function immutableFontResources<Technique extends AnyRasterTechnique>(
  font: Font<Technique>,
): {
  readonly font: RegisteredFont;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
} {
  assertImmutableFont(font);
  const variant = immutableStateOf(font).variant as ImmutableFontVariant<Technique>;
  return { font: variant.backing.font, raster: variant.raster, data: variant.data };
}

/** @internal A retained package-private view used while an engine binding is live. */
export interface ImmutableFontResourceLease<Technique extends AnyRasterTechnique> {
  readonly font: RegisteredFont;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
  readonly disposed: boolean;
  dispose(): void;
}

/** @internal Return the stable identity of a live immutable technique variant. */
export function immutableFontVariantIdentity(font: Font<AnyRasterTechnique>): object {
  assertImmutableFont(font);
  return immutableStateOf(font).variant;
}

/** @internal Retain one immutable technique variant independently of its user Font wrapper. */
export function acquireImmutableFontResources<Technique extends AnyRasterTechnique>(
  font: Font<Technique>,
): ImmutableFontResourceLease<Technique> {
  assertImmutableFont(font);
  return new ImmutableFontResourceLeaseImpl(immutableStateOf(font).variant as ImmutableFontVariant<Technique>);
}

class ImmutableFontResourceLeaseImpl<
  Technique extends AnyRasterTechnique,
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

function assertImmutableFont(font: Font<AnyRasterTechnique>): void {
  const state = immutableFontState.get(font);
  if (state === undefined) throw new TypeError('font was not created by this package');
  if (state.disposed) throw new TypeError('font has been disposed');
}

function immutableStateOf(font: Font<AnyRasterTechnique>): ImmutableFontState {
  const state = immutableFontState.get(font);
  if (state === undefined) throw new TypeError('invalid immutable font');
  return state;
}

function reportDisposalFailure(stage: string, error: unknown): void {
  if (DEV) console.warn(`font teardown continued after ${stage} failed: ${String(error)}`);
}
