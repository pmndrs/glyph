import { useCallback, useRef, useState } from 'react';

import type { BakeProgress } from '@pmndrs/glyph';

import type { GraphicsBackend } from '../../benchmark/url-state';

export function useBakeProgress(label: string): {
  readonly value: BakeProgress | undefined;
  readonly active: boolean;
  readonly publish: (progress: BakeProgress) => void;
  readonly finish: () => void;
} {
  const [value, setValue] = useState<BakeProgress>();
  const [active, setActive] = useState(false);
  const lastConsoleKey = useRef('');
  const publish = useCallback(
    (progress: BakeProgress): void => {
      setValue(progress);
      setActive(true);
      if (!import.meta.env.DEV) return;
      const percentage = Math.round((progress.completed / progress.total) * 100);
      const bucket = Math.floor(percentage / 10) * 10;
      const key = `${progress.stage}:${progress.phase}:${String(bucket)}`;
      if (key === lastConsoleKey.current) return;
      lastConsoleKey.current = key;
      console.info(`[pmndrs/glyph] ${label} ${progress.stage} bake: ${progress.phase} ${String(percentage)}%`);
    },
    [label],
  );
  const finish = useCallback((): void => setActive(false), []);
  return { value, active, publish, finish };
}

export function BakeProgressOverlay({
  backend,
  progress,
  technique,
}: {
  readonly backend: GraphicsBackend;
  readonly progress: BakeProgress | undefined;
  readonly technique: 'BITMAP' | 'MSDF' | 'SLUG';
}) {
  const percentage = bakeProgressPercentage(progress);
  const label =
    progress === undefined
      ? `INITIALIZING ${technique} ${backend.toUpperCase()}`
      : `${progress.stage === 'font' ? 'FONT' : technique} ${progress.phase.toUpperCase()}`;
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-background px-8">
      <div className="w-full max-w-sm" data-testid="bake-progress">
        <div className="mb-2 flex items-center justify-between font-mono text-[9px] text-dim">
          <span>{label}</span>
          <span>{percentage}%</span>
        </div>
        <progress
          aria-label={label}
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface accent-accent"
          max={100}
          value={percentage}
        />
      </div>
    </div>
  );
}

function bakeProgressPercentage(progress: BakeProgress | undefined): number {
  if (progress === undefined) return 0;
  const ratio = progress.completed / progress.total;
  if (progress.stage === 'font') {
    if (progress.phase === 'loading') return 2;
    if (progress.phase === 'baking') return 8;
    if (progress.phase === 'packaging') return 16;
    if (progress.phase === 'transferring') return 19;
    if (progress.phase === 'complete') return 20;
    return Math.round(ratio * 20);
  }
  if (progress.phase === 'loading') return 22;
  if (progress.phase === 'rasterizing') return 25 + Math.round(ratio * 65);
  if (progress.phase === 'packaging') return 92;
  if (progress.phase === 'transferring') return 97;
  if (progress.phase === 'complete') return 100;
  return 20;
}
