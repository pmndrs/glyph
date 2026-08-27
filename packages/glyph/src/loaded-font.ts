import { DEV } from './internal/dev.js';

import type { Font, FontMetrics, RegisteredFont } from './font.js';
import type { RegisteredRaster, RasterKindOf } from './raster.js';
import type { AnyRasterTechnique, RasterDataOf } from './raster-technique.js';
import type { TextRuntime } from './text-runtime.js';

export interface LoadedFont<Technique extends AnyRasterTechnique> {
  readonly runtime: TextRuntime;
  readonly font: RegisteredFont;
  readonly technique: Technique;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
  readonly disposed: boolean;
  dispose(): void;
}

export type FontSelection<Technique extends AnyRasterTechnique> =
  | LoadedFont<Technique>
  | FontStack<Technique, LoadedFont<Technique>>;

export interface FontStack<
  Technique extends AnyRasterTechnique,
  Member extends Font<Technique> | LoadedFont<Technique> = LoadedFont<Technique>,
> {
  readonly fonts: readonly [Member, ...Member[]];
}

type TechniqueOfLoadedFont<Value> = Value extends LoadedFont<infer Technique> ? Technique : never;
type TechniqueOfFont<Value> = Value extends Font<infer Technique> ? Technique : never;

interface LoadedFontState {
  readonly release: () => void;
  readonly disposeListeners: Set<() => void>;
  leases: number;
  disposed: boolean;
  released: boolean;
}

const loadedFontState = new WeakMap<LoadedFont<AnyRasterTechnique>, LoadedFontState>();

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
  leases: number;
  released: boolean;
}

interface ImmutableFontState {
  readonly variant: ImmutableFontVariant<AnyRasterTechnique>;
  disposed: boolean;
}

const immutableFontState = new WeakMap<Font<AnyRasterTechnique>, ImmutableFontState>();
const immutableFontStacks = new WeakSet<object>();

export function createFontStack<
  const Primary extends Font<AnyRasterTechnique>,
  const Fallback extends readonly Font<AnyRasterTechnique>[],
>(
  primary: Primary,
  ...fallback: Fallback
): FontStack<TechniqueOfFont<Primary | Fallback[number]>, Font<TechniqueOfFont<Primary | Fallback[number]>>>;

export function createFontStack<
  Primary extends AnyRasterTechnique,
  const Fallback extends readonly LoadedFont<AnyRasterTechnique>[],
>(
  primary: LoadedFont<Primary>,
  ...fallback: Fallback
): FontStack<
  Primary | TechniqueOfLoadedFont<Fallback[number]>,
  LoadedFont<Primary | TechniqueOfLoadedFont<Fallback[number]>>
>;

export function createFontStack(
  primary: Font<AnyRasterTechnique> | LoadedFont<AnyRasterTechnique>,
  ...fallback: readonly (Font<AnyRasterTechnique> | LoadedFont<AnyRasterTechnique>)[]
): FontStack<AnyRasterTechnique, Font<AnyRasterTechnique> | LoadedFont<AnyRasterTechnique>> {
  const fonts = [primary, ...fallback];
  const immutable = immutableFontState.has(primary as Font<AnyRasterTechnique>);
  if (immutable) assertImmutableFont(primary as Font<AnyRasterTechnique>);
  else assertLoadedFont(primary as LoadedFont<AnyRasterTechnique>);
  const unique = new Set<Font<AnyRasterTechnique> | LoadedFont<AnyRasterTechnique>>([primary]);
  for (const font of fallback) {
    if (immutable !== immutableFontState.has(font as Font<AnyRasterTechnique>)) {
      throw new TypeError('font stack cannot mix immutable and runtime-bound fonts');
    }
    if (immutable) assertImmutableFont(font as Font<AnyRasterTechnique>);
    else assertLoadedFont(font as LoadedFont<AnyRasterTechnique>);
    if (unique.has(font)) throw new TypeError('font stack cannot contain the same font more than once');
    unique.add(font);
    if (
      !immutable &&
      (font as LoadedFont<AnyRasterTechnique>).runtime !== (primary as LoadedFont<AnyRasterTechnique>).runtime
    )
      throw new TypeError('font stack members must belong to the same text runtime');
  }
  const stack = Object.freeze({ fonts: Object.freeze(fonts) }) as FontStack<
    AnyRasterTechnique,
    Font<AnyRasterTechnique> | LoadedFont<AnyRasterTechnique>
  >;
  if (immutable) immutableFontStacks.add(stack);
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

class FontImpl<Technique extends AnyRasterTechnique> implements Font<Technique> {
  readonly metrics: FontMetrics;
  readonly glyphCount: number;
  readonly technique: Technique;

  constructor(variant: ImmutableFontVariant<Technique>) {
    retainImmutableFontVariant(variant);
    this.metrics = variant.backing.font.metrics;
    this.glyphCount = variant.backing.font.glyphCount;
    this.technique = variant.technique;
    immutableFontState.set(this, { variant, disposed: false });
  }

  get disposed(): boolean {
    return immutableStateOf(this).disposed;
  }

  dispose(): void {
    const state = immutableStateOf(this);
    if (state.disposed) return;
    state.disposed = true;
    releaseImmutableFontVariant(state.variant);
  }
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
  return { ...init, leases: 0, released: false };
}

/** @internal Return an independent application lease. */
export function createImmutableFontLease<Technique extends AnyRasterTechnique>(
  variant: ImmutableFontVariant<Technique>,
): Font<Technique> {
  return new FontImpl(variant);
}

/** @internal Retain a library, pending-load, runtime, or renderer lease. */
export function retainImmutableFontVariant(variant: ImmutableFontVariant<AnyRasterTechnique>): void {
  if (variant.released) throw new TypeError('font variant has been released');
  variant.leases += 1;
}

/** @internal Release a library, pending-load, runtime, or renderer lease. */
export function releaseImmutableFontVariant(variant: ImmutableFontVariant<AnyRasterTechnique>): void {
  if (variant.leases <= 0) throw new Error('immutable font lease underflow');
  variant.leases -= 1;
  if (variant.leases !== 0 || variant.released) return;
  variant.released = true;
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

export class LoadedFontImpl<Technique extends AnyRasterTechnique> implements LoadedFont<Technique> {
  readonly runtime: TextRuntime;
  readonly font: RegisteredFont;
  readonly technique: Technique;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;

  constructor(init: {
    readonly runtime: TextRuntime;
    readonly font: RegisteredFont;
    readonly technique: Technique;
    readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
    readonly data: RasterDataOf<Technique>;
    readonly release: (font: LoadedFontImpl<Technique>) => void;
  }) {
    this.runtime = init.runtime;
    this.font = init.font;
    this.technique = init.technique;
    this.raster = init.raster;
    this.data = init.data;
    loadedFontState.set(this, {
      release: () => init.release(this),
      disposeListeners: new Set(),
      leases: 0,
      disposed: false,
      released: false,
    });
  }

  get disposed(): boolean {
    return stateOf(this).disposed;
  }

  dispose(): void {
    disposeLoadedFont(stateOf(this), 'font');
  }
}

/**
 * Disposal is total: it always completes, it is safe to repeat, and it never throws.
 *
 * Manual disposal makes the font unavailable immediately and defers its underlying
 * resources until the final live consumer lease ends. Runtime teardown force-closes the
 * lease ledger so deferred React cleanup remains a safe no-op.
 */
function disposeLoadedFont(state: LoadedFontState, owner: 'font' | 'runtime'): void {
  if (!state.disposed && state.leases !== 0) {
    if (DEV) {
      console.warn(
        `loaded font is retained by ${state.leases} live paragraph lease${state.leases === 1 ? '' : 's'};` +
          (owner === 'runtime'
            ? ' disposing anyway during runtime teardown. '
            : ' deferring release until its final lease ends. ') +
          'Dispose every Text that leased it first — a TextGroup does not dispose its children.',
      );
    }
  }
  state.disposed = true;
  notifyDisposed(state);
  if (owner === 'runtime') state.leases = 0;
  if (state.leases === 0) releaseLoadedFont(state);
}

/** @internal Acquire one retained paragraph lease on every concrete font. */
export function acquireFontSelection<Technique extends AnyRasterTechnique>(
  selection: FontSelection<Technique>,
  runtime: TextRuntime,
  technique: Technique,
): void {
  const acquired: LoadedFont<Technique>[] = [];
  try {
    for (const font of concreteFonts(selection)) {
      assertCompatibleFont(font, runtime, technique);
      stateOf(font).leases += 1;
      acquired.push(font);
    }
  } catch (error) {
    for (const font of acquired) stateOf(font).leases -= 1;
    throw error;
  }
}

/** Acquire one renderer lease without imposing a single raster technique on the selection. Public through `@pmndrs/glyph/core`. */
export function acquireFontSelectionForRuntime(
  selection: FontSelection<AnyRasterTechnique>,
  runtime: TextRuntime,
): void {
  const acquired: LoadedFont<AnyRasterTechnique>[] = [];
  try {
    for (const font of concreteFonts(selection)) {
      assertFontForRuntime(font, runtime);
      stateOf(font).leases += 1;
      acquired.push(font);
    }
  } catch (error) {
    for (const font of acquired) stateOf(font).leases -= 1;
    throw error;
  }
}

/** Release one retained renderer or paragraph lease from every concrete font. Public through `@pmndrs/glyph/core`. */
export function releaseFontSelection<Technique extends AnyRasterTechnique>(selection: FontSelection<Technique>): void {
  for (const font of concreteFonts(selection)) {
    const state = stateOf(font);
    // Runtime teardown closes the ledger before deferred React disposal arrives. Manual
    // font disposal keeps the ledger open so its final live Text releases the resource.
    if (state.disposed && state.released) continue;
    if (state.leases <= 0) throw new Error('font lease underflow');
    state.leases -= 1;
    if (state.disposed && state.leases === 0) releaseLoadedFont(state);
  }
}

/** @internal Validate a selection without changing ownership. */
export function assertFontSelection<Technique extends AnyRasterTechnique>(
  selection: FontSelection<Technique>,
  runtime: TextRuntime,
  technique: Technique,
): void {
  for (const font of concreteFonts(selection)) assertCompatibleFont(font, runtime, technique);
}

/** Validate renderer ownership without imposing a single raster technique on the selection. Public through `@pmndrs/glyph/core`. */
export function assertFontSelectionForRuntime(
  selection: FontSelection<AnyRasterTechnique>,
  runtime: TextRuntime,
): void {
  for (const font of concreteFonts(selection)) assertFontForRuntime(font, runtime);
}

/** Return the immutable concrete fallback order. Public through `@pmndrs/glyph/core`. */
export function concreteFonts<Technique extends AnyRasterTechnique>(
  selection: FontSelection<Technique>,
): readonly [LoadedFont<Technique>, ...LoadedFont<Technique>[]] {
  return isFontStack(selection) ? selection.fonts : [selection];
}

/** @internal Runtime teardown. Total and non-throwing, like every other disposal path. */
export function disposeLoadedFontFromRuntime(font: LoadedFont<AnyRasterTechnique>): void {
  disposeLoadedFont(stateOf(font), 'runtime');
}

/** Observe successful loaded-font disposal without wrapping its identity. Public through `@pmndrs/glyph/core`. */
export function observeLoadedFontDispose(font: LoadedFont<AnyRasterTechnique>, listener: () => void): () => void {
  const state = stateOf(font);
  if (state.disposed) {
    listener();
    return () => undefined;
  }
  state.disposeListeners.add(listener);
  return () => state.disposeListeners.delete(listener);
}

function notifyDisposed(state: LoadedFontState): void {
  for (const listener of state.disposeListeners) {
    try {
      listener();
      state.disposeListeners.delete(listener);
    } catch (error) {
      reportDisposalFailure('notifying a loaded-font disposal observer', error);
    }
  }
}

function releaseLoadedFont(state: LoadedFontState): void {
  if (state.released) return;
  try {
    state.release();
    state.released = true;
  } catch (error) {
    reportDisposalFailure('releasing loaded-font resources', error);
  }
}

function reportDisposalFailure(stage: string, error: unknown): void {
  if (DEV) console.warn(`loaded-font teardown continued after ${stage} failed: ${String(error)}`);
}

function isFontStack<Technique extends AnyRasterTechnique>(
  selection: FontSelection<Technique>,
): selection is FontStack<Technique, LoadedFont<Technique>> {
  return 'fonts' in selection;
}

function assertCompatibleFont<Technique extends AnyRasterTechnique>(
  font: LoadedFont<Technique>,
  runtime: TextRuntime,
  technique: Technique,
): void {
  assertFontForRuntime(font, runtime);
  if (font.technique !== technique) throw new TypeError('font does not use the paragraph batch technique');
}

function assertFontForRuntime(font: LoadedFont<AnyRasterTechnique>, runtime: TextRuntime): void {
  assertLoadedFont(font);
  if (font.runtime !== runtime) throw new TypeError('font belongs to another text runtime');
}

function assertLoadedFont(font: LoadedFont<AnyRasterTechnique>): void {
  const state = loadedFontState.get(font);
  if (state === undefined) throw new TypeError('font was not created by this text runtime implementation');
  if (state.disposed) throw new TypeError('loaded font has been disposed');
}

function stateOf<Technique extends AnyRasterTechnique>(font: LoadedFont<Technique>): LoadedFontState {
  const state = loadedFontState.get(font);
  if (state === undefined) throw new TypeError('invalid loaded font');
  return state;
}
