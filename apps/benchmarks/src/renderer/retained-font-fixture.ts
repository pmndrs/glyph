import type { Font, RasterFormatMetadata } from '@pmndrs/glyph';

import type { BenchmarkFontFixture } from '../benchmark/font-fixtures';

export interface LiveFontFixtureUpdate {
  readonly fontFixture?: BenchmarkFontFixture;
}

export interface RetainedFontFixtureAsset {
  readonly font: Font<RasterFormatMetadata>;
}

export interface RetainedFontFixtureState<Asset extends RetainedFontFixtureAsset> {
  readonly fixture: BenchmarkFontFixture;
  readonly asset: Asset;
}

export type RetainedFontFixtureLoader<Asset extends RetainedFontFixtureAsset> = (
  fixture: BenchmarkFontFixture,
) => Promise<Asset>;

export interface RetainedFontFixtureController<Asset extends RetainedFontFixtureAsset> {
  readonly current: RetainedFontFixtureState<Asset>;
  /** Whether `commit` can build a generation on `fixture` in the caller's own turn, with nothing left to fetch. */
  has(fixture: BenchmarkFontFixture): boolean;
  /**
   * Fetches and decodes a replacement fixture behind the visible one. This is the only genuinely asynchronous step in
   * a live update, and staging it here is what lets a fixture swap load without tearing down the text on screen.
   */
  load(fixture: BenchmarkFontFixture, load: RetainedFontFixtureLoader<Asset>): Promise<void>;
  /**
   * Builds one generation against `fixture` and, once `apply` returns, adopts it and releases the fixture it replaced.
   * Synchronous by construction: a fixture with no completed `load` is a caller error rather than something to await.
   * A throwing `apply` leaves the visible fixture and its asset exactly as they were.
   */
  commit<Result>(fixture: BenchmarkFontFixture, apply: (asset: Asset) => Result): Result;
  dispose(): void;
}

/** Keeps one live font owner while Text transactionally commits replacement generations. */
export function createRetainedFontFixtureController<Asset extends RetainedFontFixtureAsset>(
  initial: RetainedFontFixtureState<Asset>,
  ownership: { readonly dispose?: (asset: Asset) => void } = {},
): RetainedFontFixtureController<Asset> {
  let current = initial;
  let staged: RetainedFontFixtureState<Asset> | undefined;
  let pending: { readonly fixture: BenchmarkFontFixture; readonly load: Promise<void> } | undefined;
  let loadToken = 0;
  let disposed = false;
  const disposeAsset = ownership.dispose ?? ((asset: Asset): void => asset.font.dispose());

  const release = (state: RetainedFontFixtureState<Asset> | undefined): void => {
    if (state === undefined || state.asset.font === current.asset.font) return;
    disposeAsset(state.asset);
  };

  const stage = async (
    fixture: BenchmarkFontFixture,
    loadAsset: RetainedFontFixtureLoader<Asset>,
    token: number,
  ): Promise<void> => {
    const asset = await loadAsset(fixture);
    // A fixture requested and then abandoned mid-flight still allocated GPU resources; release them here rather than
    // stranding them behind the fixture the caller actually settled on.
    if (disposed || token !== loadToken) {
      if (asset.font !== current.asset.font) disposeAsset(asset);
      throw supersededError();
    }
    pending = undefined;
    release(staged);
    staged = { fixture, asset };
  };

  return {
    get current() {
      return current;
    },
    has(fixture) {
      return !disposed && (fixture === current.fixture || fixture === staged?.fixture);
    },
    load(fixture, loadAsset) {
      if (disposed) return Promise.reject(disposedError());
      if (fixture === current.fixture) {
        loadToken += 1;
        pending = undefined;
        release(staged);
        staged = undefined;
        return Promise.resolve();
      }
      if (fixture === staged?.fixture) return Promise.resolve();
      if (pending?.fixture === fixture) return pending.load;
      loadToken += 1;
      const load = stage(fixture, loadAsset, loadToken);
      pending = { fixture, load };
      return load;
    },
    commit(fixture, apply) {
      if (disposed) throw disposedError();
      const target = fixture === current.fixture ? current : fixture === staged?.fixture ? staged : undefined;
      if (target === undefined) {
        throw new DOMException(`The font fixture "${fixture}" is not loaded`, 'InvalidStateError');
      }
      const result = apply(target.asset);
      if (target !== current) {
        const previous = current;
        current = target;
        staged = undefined;
        if (previous.asset.font !== target.asset.font) disposeAsset(previous.asset);
      }
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pending = undefined;
      const previouslyStaged = staged;
      staged = undefined;
      release(previouslyStaged);
      disposeAsset(current.asset);
    },
  };
}

function supersededError(): DOMException {
  return new DOMException('The font fixture load was superseded', 'AbortError');
}

function disposedError(): DOMException {
  return new DOMException('The font fixture owner is disposed', 'AbortError');
}
