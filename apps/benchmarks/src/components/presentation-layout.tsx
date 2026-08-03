import { useEffect, useEffectEvent, type ReactNode } from 'react';
import { isBenchmarkWorkloadId, type BenchmarkWorkloadId } from '../workloads/catalog';
import { CustomSelect, type CustomSelectOption } from './custom-select';

export type PresentationSelectOption = CustomSelectOption;

export interface PresentationLayoutProps {
  readonly controls: ReactNode;
  readonly fontOptions: readonly PresentationSelectOption[];
  readonly fontValue: string;
  readonly payload: ReactNode;
  readonly playing: boolean;
  readonly scene: ReactNode;
  readonly techniqueControl: ReactNode;
  readonly telemetry: ReactNode;
  readonly workloadOptions: readonly PresentationSelectOption[];
  readonly workloadValue: BenchmarkWorkloadId;
  readonly onExit: () => void;
  readonly onFont: (value: string) => void;
  readonly onWorkload: (value: BenchmarkWorkloadId) => void;
}

export function PresentationLayout({
  controls,
  fontOptions,
  fontValue,
  payload,
  playing,
  scene,
  techniqueControl,
  telemetry,
  workloadOptions,
  workloadValue,
  onExit,
  onFont,
  onWorkload,
}: PresentationLayoutProps) {
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
      className="presentation-layout relative h-dvh min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
      data-presentation-playing={playing}
      data-testid="presentation-layout"
    >
      <main className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">{scene}</main>
      <header className="pointer-events-none absolute left-6 top-6 z-30 sm:left-8 sm:top-8">
        <div className="presentation-top-chrome pointer-events-auto flex min-w-0 flex-wrap items-center gap-1.5">
          {techniqueControl}
          <CustomSelect
            ariaLabel="Live workload"
            options={workloadOptions}
            value={workloadValue}
            variant="presentation"
            onChange={(value) => {
              if (isBenchmarkWorkloadId(value)) onWorkload(value);
            }}
          />
          <CustomSelect
            ariaLabel="Font fixture"
            options={fontOptions}
            value={fontValue}
            variant="presentation"
            onChange={onFont}
          />
        </div>
      </header>

      <aside className="presentation-controls-chrome pointer-events-auto absolute left-6 top-1/2 z-30 sm:left-8">
        {controls}
      </aside>

      <aside className="presentation-telemetry-chrome pointer-events-none absolute right-6 top-28 z-20 sm:right-8 min-[1120px]:top-8">
        <div className="pointer-events-auto grid h-36 grid-rows-3 divide-y divide-border overflow-hidden rounded-md border border-border bg-black/80 sm:h-40">
          {telemetry}
        </div>
      </aside>

      <div className="presentation-payload-chrome pointer-events-none absolute bottom-6 right-6 z-20 flex flex-wrap justify-end gap-2 sm:bottom-8 sm:right-8">
        {payload}
      </div>
    </div>
  );
}
