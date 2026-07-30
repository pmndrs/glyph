import { FontRegistry, type RegisteredFont } from '@pmndrs/text';

import type { BenchmarkFontFixture } from '../benchmark/font-fixtures';

export interface LiveFontFixtureUpdate {
  readonly fontFixture?: BenchmarkFontFixture;
}

export interface RetainedFontFixtureAsset {
  readonly font: RegisteredFont;
}

export interface RetainedFontFixtureState<Asset extends RetainedFontFixtureAsset> {
  readonly fixture: BenchmarkFontFixture;
  readonly asset: Asset;
}

export interface RetainedFontFixtureController<Asset extends RetainedFontFixtureAsset> {
  readonly registry: FontRegistry;
  readonly current: RetainedFontFixtureState<Asset>;
  update(options: {
    readonly fixture: BenchmarkFontFixture;
    readonly isCurrent: () => boolean;
    readonly load: (fixture: BenchmarkFontFixture, registry: FontRegistry) => Promise<Asset>;
    readonly commit: (asset: Asset) => Promise<void>;
  }): Promise<RetainedFontFixtureState<Asset>>;
  dispose(): void;
}

/** Keeps one registry and one live font owner while Text transactionally commits replacement generations. */
export function createRetainedFontFixtureController<Asset extends RetainedFontFixtureAsset>(
  registry: FontRegistry,
  initial: RetainedFontFixtureState<Asset>,
  ownership: { readonly dispose?: (asset: Asset) => void } = {},
): RetainedFontFixtureController<Asset> {
  let current = initial;
  let disposed = false;
  let updateTail = Promise.resolve();
  const disposeAsset = ownership.dispose ?? ((asset: Asset): void => asset.font.dispose());

  const performUpdate = async (
    options: Parameters<RetainedFontFixtureController<Asset>['update']>[0],
  ): Promise<RetainedFontFixtureState<Asset>> => {
    if (disposed) throw disposedError();
    const replacing = options.fixture !== current.fixture;
    const candidate = replacing
      ? { fixture: options.fixture, asset: await options.load(options.fixture, registry) }
      : current;
    if (disposed || !options.isCurrent()) {
      disposeCandidate(candidate, current, disposeAsset);
      throw supersededError();
    }
    try {
      await options.commit(candidate.asset);
    } catch (error) {
      disposeCandidate(candidate, current, disposeAsset);
      throw error;
    }
    if (disposed) {
      disposeCandidate(candidate, current, disposeAsset);
      throw disposedError();
    }
    if (replacing) {
      const previous = current;
      current = candidate;
      if (previous.asset.font !== candidate.asset.font) disposeAsset(previous.asset);
    }
    // A newer request may already be queued. The committed candidate remains the visible owner until that request
    // commits; disposing it here would invalidate the Text generation that is deliberately still on screen.
    if (!options.isCurrent()) throw supersededError();
    return current;
  };

  return {
    registry,
    get current() {
      return current;
    },
    update(options) {
      const result = updateTail.then(
        () => performUpdate(options),
        () => performUpdate(options),
      );
      updateTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeAsset(current.asset);
    },
  };
}

function disposeCandidate<Asset extends RetainedFontFixtureAsset>(
  candidate: RetainedFontFixtureState<Asset>,
  current: RetainedFontFixtureState<Asset>,
  dispose: (asset: Asset) => void,
): void {
  if (candidate.asset.font !== current.asset.font) dispose(candidate.asset);
}

function supersededError(): DOMException {
  return new DOMException('The font fixture update was superseded', 'AbortError');
}

function disposedError(): DOMException {
  return new DOMException('The font fixture owner is disposed', 'AbortError');
}
