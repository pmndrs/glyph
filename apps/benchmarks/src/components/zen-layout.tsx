import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { CustomSelect, type CustomSelectOption } from './custom-select';

export type ZenSelectOption = CustomSelectOption;

export interface ZenLayoutProps {
  readonly controls: ReactNode;
  readonly fontOptions: readonly ZenSelectOption[];
  readonly fontValue: string;
  readonly payload: ReactNode;
  readonly scene: ReactNode;
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
  scene,
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
    <div
      className="zen-layout relative h-dvh min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
      data-testid="zen-layout"
    >
      <main className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">{scene}</main>
      <header className="pointer-events-none absolute left-6 top-6 z-30 sm:left-8 sm:top-8">
        <div className="zen-top-chrome pointer-events-auto flex min-w-0 flex-wrap items-center gap-1.5">
          {techniqueControl}
          <CustomSelect
            ariaLabel="Live workload"
            options={workloadOptions}
            value={workloadValue}
            variant="zen"
            onChange={onWorkload}
          />
          <CustomSelect
            ariaLabel="Font fixture"
            options={fontOptions}
            value={fontValue}
            variant="zen"
            onChange={onFont}
          />
        </div>
      </header>

      <aside className="zen-side-chrome pointer-events-none absolute right-6 top-28 z-20 flex flex-col gap-2 sm:right-8 min-[1120px]:top-8">
        <div className="pointer-events-auto grid h-36 grid-rows-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-black/80 sm:h-40">
          {telemetry}
        </div>
        <div className="pointer-events-auto overflow-hidden rounded-xl border border-border bg-black/80">
          <button
            aria-expanded={controlsOpen}
            className="flex min-h-8 w-full items-center justify-between gap-3 px-2.5 text-left text-[10px] font-medium text-foreground hover:bg-surface/80"
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
            <div className="max-h-[min(28rem,calc(100dvh-15rem))] overflow-y-auto overscroll-contain border-t border-border p-3">
              {controls}
            </div>
          )}
        </div>
      </aside>

      <div className="zen-payload-chrome pointer-events-none absolute bottom-6 right-6 z-20 flex flex-wrap justify-end gap-2 sm:bottom-8 sm:right-8">
        {payload}
      </div>
    </div>
  );
}
