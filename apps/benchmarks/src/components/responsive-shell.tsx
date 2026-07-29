import type { ReactNode } from 'react';

import type { HarnessLocation } from '../benchmark/url-state';
import { Button } from './ui';

export function CompactSheet({
  children,
  phone,
  title,
  onClose,
}: {
  readonly children: ReactNode;
  readonly phone: boolean;
  readonly title: string;
  readonly onClose: () => void;
}) {
  return (
    <>
      <button
        aria-label="Close controls"
        className="fixed inset-0 top-[52px] z-20 bg-black/40"
        type="button"
        onClick={onClose}
      />
      <section
        className={
          phone
            ? 'fixed inset-x-2 bottom-[66px] z-30 max-h-[calc(100dvh-126px)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-chrome p-4 shadow-2xl'
            : 'fixed right-2 top-[60px] z-30 max-h-[60dvh] w-[min(420px,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-xl border border-border bg-chrome p-4 shadow-2xl before:absolute before:-top-1.5 before:right-24 before:size-3 before:rotate-45 before:border-l before:border-t before:border-border before:bg-chrome'
        }
      >
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">{title}</h1>
          <Button aria-label="Close controls" onClick={onClose}>
            ×
          </Button>
        </div>
        {children}
      </section>
    </>
  );
}

export function CompactWorkloadPanel({
  children,
  phone,
  onClose,
}: {
  readonly children: ReactNode;
  readonly phone: boolean;
  readonly onClose: () => void;
}) {
  return (
    <>
      <button
        aria-label="Close workload menu"
        className="fixed inset-0 top-[52px] z-20 bg-black/40"
        type="button"
        onClick={onClose}
      />
      <div
        className={`fixed left-2 top-[60px] z-30 max-h-[calc(100dvh-72px)] w-[min(360px,calc(100vw-16px))] overflow-hidden rounded-xl border border-border bg-chrome shadow-2xl before:absolute before:-top-1.5 before:left-3 before:size-3 before:rotate-45 before:border-l before:border-t before:border-border before:bg-chrome ${phone ? 'bottom-[66px]' : ''}`}
      >
        {children}
      </div>
    </>
  );
}

export function MobileNavigation({
  location,
  onLocation,
}: {
  readonly location: HarnessLocation;
  readonly onLocation: (value: Partial<HarnessLocation>) => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[58px] grid-cols-4 border-t border-border bg-chrome p-2 min-[700px]:hidden">
      {(['scene', 'controls', 'report', 'export'] as const).map((view) => (
        <button
          aria-pressed={location.view === view}
          className={`rounded-md font-mono text-[10px] capitalize ${location.view === view ? 'bg-surface-active text-foreground ring-1 ring-inset ring-accent' : 'text-muted hover:bg-surface hover:text-foreground'}`}
          key={view}
          type="button"
          onClick={() => onLocation({ view })}
        >
          {view}
        </button>
      ))}
    </nav>
  );
}
