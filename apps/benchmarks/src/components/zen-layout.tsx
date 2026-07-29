import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';

export interface ZenSelectOption {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: string;
}

export interface ZenLayoutProps {
  readonly controls: ReactNode;
  readonly fontOptions: readonly ZenSelectOption[];
  readonly fontValue: string;
  readonly payload: ReactNode;
  readonly techniqueControl: ReactNode;
  readonly telemetry: ReactNode;
  readonly workloadOptions: readonly ZenSelectOption[];
  readonly workloadValue: string;
  readonly onExit: () => void;
  readonly onFont: (value: string) => void;
  readonly onWorkload: (value: string) => void;
}

export function ZenLayout({
  controls,
  fontOptions,
  fontValue,
  payload,
  techniqueControl,
  telemetry,
  workloadOptions,
  workloadValue,
  onExit,
  onFont,
  onWorkload,
}: ZenLayoutProps) {
  const [controlsOpen, setControlsOpen] = useState(false);
  const exit = useEffectEvent(onExit);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      exit();
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20" data-testid="zen-layout">
      <header className="pointer-events-none absolute left-0 top-0 z-30 p-3 sm:p-4">
        <div className="pointer-events-auto flex min-w-0 flex-wrap items-center gap-2">
          {techniqueControl}
          <ZenSelect ariaLabel="Live workload" options={workloadOptions} value={workloadValue} onChange={onWorkload} />
          <ZenSelect ariaLabel="Font fixture" options={fontOptions} value={fontValue} onChange={onFont} />
        </div>
      </header>

      <aside className="pointer-events-none absolute right-3 top-32 z-20 flex w-[min(18rem,calc(100vw-1.5rem))] flex-col gap-2 sm:right-4 sm:top-4">
        <div className="pointer-events-auto grid h-36 grid-rows-3 gap-px overflow-hidden rounded-xl border border-border/80 bg-border/70 shadow-2xl backdrop-blur-md sm:h-40">
          {telemetry}
        </div>
        <div className="pointer-events-auto overflow-hidden rounded-xl border border-border/80 bg-chrome/80 shadow-2xl backdrop-blur-md">
          <button
            aria-expanded={controlsOpen}
            className="flex min-h-10 w-full items-center justify-between gap-3 px-3 text-left text-xs font-medium text-foreground hover:bg-surface/80"
            type="button"
            onClick={() => setControlsOpen((open) => !open)}
          >
            Controls
            <svg
              aria-hidden="true"
              className={`ml-auto size-4 shrink-0 text-muted transition-transform ${controlsOpen ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 16 16"
            >
              <path d="m6 4 4 4-4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {controlsOpen && (
            <div className="max-h-[min(28rem,calc(100dvh-15rem))] overflow-y-auto overscroll-contain border-t border-border/80 p-3">
              {controls}
            </div>
          )}
        </div>
      </aside>

      <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex max-w-[calc(100vw-1.5rem)] flex-wrap justify-end gap-2 sm:bottom-4 sm:right-4">
        {payload}
      </div>
    </div>
  );
}

function ZenSelect({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  readonly ariaLabel: string;
  readonly options: readonly ZenSelectOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="relative max-w-[min(14rem,40vw)]">
      <select
        aria-label={ariaLabel}
        className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-border/80 bg-chrome/80 px-3 pr-8 text-xs text-foreground shadow-xl backdrop-blur-md hover:border-accent focus:border-accent focus:outline-none"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted"
        fill="none"
        viewBox="0 0 16 16"
      >
        <path d="m4 6 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
