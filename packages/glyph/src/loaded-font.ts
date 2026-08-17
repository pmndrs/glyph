import { DEV } from './internal/dev.js';

import type { RegisteredFont } from './font.js';
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

export type FontSelection<Technique extends AnyRasterTechnique> = LoadedFont<Technique> | FontStack<Technique>;

export interface FontStack<Technique extends AnyRasterTechnique> {
  readonly fonts: readonly [LoadedFont<Technique>, ...LoadedFont<Technique>[]];
}

type TechniqueOfLoadedFont<Font> = Font extends LoadedFont<infer Technique> ? Technique : never;

export class FontLeaseError extends Error {
  readonly leaseCount: number;

  constructor(leaseCount: number) {
    super(`loaded font is retained by ${leaseCount} live paragraph lease${leaseCount === 1 ? '' : 's'}`);
    this.name = 'FontLeaseError';
    this.leaseCount = leaseCount;
  }
}

interface LoadedFontState {
  readonly release: () => void;
  readonly disposeListeners: Set<() => void>;
  leases: number;
  disposed: boolean;
}

const loadedFontState = new WeakMap<LoadedFont<AnyRasterTechnique>, LoadedFontState>();

export function createFontStack<
  Primary extends AnyRasterTechnique,
  const Fallback extends readonly LoadedFont<AnyRasterTechnique>[],
>(primary: LoadedFont<Primary>, ...fallback: Fallback): FontStack<Primary | TechniqueOfLoadedFont<Fallback[number]>> {
  type Technique = Primary | TechniqueOfLoadedFont<Fallback[number]>;
  const fonts = [primary, ...fallback] as unknown as [LoadedFont<Technique>, ...LoadedFont<Technique>[]];
  assertLoadedFont(primary);
  const unique = new Set<LoadedFont<AnyRasterTechnique>>([primary]);
  for (const font of fallback) {
    assertLoadedFont(font);
    if (unique.has(font)) throw new TypeError('font stack cannot contain the same loaded font more than once');
    unique.add(font);
    if (font.runtime !== primary.runtime)
      throw new TypeError('font stack members must belong to the same text runtime');
  }
  return Object.freeze({ fonts: Object.freeze(fonts) });
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
 * Teardown runs in `finally` blocks and in unmount paths that are already handling an
 * earlier failure. A throw there destroys the original error and leaves the resource
 * half-released, so outstanding leases are reported and force-released rather than
 * refused. A paragraph that outlives the font it leased still fails loudly at its next
 * use, which is the correct place to notice it.
 */
function disposeLoadedFont(state: LoadedFontState, owner: 'font' | 'runtime'): void {
  if (state.disposed) return;
  if (state.leases !== 0) {
    if (DEV) {
      console.warn(
        `${new FontLeaseError(state.leases).message}; disposing anyway during ${owner} teardown. ` +
          'Dispose every Text that leased it first — a TextGroup does not dispose its children.',
      );
    }
    state.leases = 0;
  }
  state.disposed = true;
  state.release();
  notifyDisposed(state);
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
    // A disposed font's lease ledger is closed: teardown already force-released whatever
    // was outstanding, so a late release is not a double release. Teardown order is not
    // ours to choose — react-three-fiber defers dispose to idle priority, so a paragraph
    // routinely disposes after the runtime an application tore down on unmount. The
    // underflow check still guards live fonts, where a double release is a real defect.
    if (state.disposed) continue;
    if (state.leases <= 0) throw new Error('font lease underflow');
    state.leases -= 1;
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
  for (const listener of state.disposeListeners) listener();
  state.disposeListeners.clear();
}

function isFontStack<Technique extends AnyRasterTechnique>(
  selection: FontSelection<Technique>,
): selection is FontStack<Technique> {
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
