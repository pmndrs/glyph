import { usePreparationStatus } from './prepare';

/** Covers preparation frames. Failures stay visible instead of starting a partially prepared recording. */
export function HeroLoading() {
  const { phase: current, failure } = usePreparationStatus();

  return (
    <output
      className="hero-loading"
      data-ready={current === 'ready'}
      aria-label={current === 'failed' ? undefined : 'Loading scene'}
      aria-hidden={current === 'ready'}
    >
      {current === 'failed' ? (
        `Unable to prepare scene: ${failure}`
      ) : (
        <svg viewBox="0 0 42.5 42.5" aria-hidden="true">
          <path d="M15 0h27.5v27.5h-12.5v-15h-15z M0 15h12.5v12.5h-12.5z M15 15h12.5v12.5h-12.5z M15 30h12.5v12.5h-12.5z" />
        </svg>
      )}
    </output>
  );
}
