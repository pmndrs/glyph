import type { HarnessLocation, RasterFormatName } from '../benchmark/url-state';
import { RasterFormatSwitcher } from './raster-format-switcher';
import { Button, Chip } from './ui';

export interface TopBarProps {
  readonly compact: boolean;
  readonly phone: boolean;
  readonly location: HarnessLocation;
  readonly webgpu: boolean;
  readonly onControls: () => void;
  readonly onMenu: () => void;
  readonly onFormat: (technique: RasterFormatName) => void;
  readonly onPresentationMode: () => void;
  readonly workloadPanelOpen: boolean;
}

export function TopBar({
  compact,
  phone,
  location,
  webgpu,
  onControls,
  onMenu,
  onFormat,
  onPresentationMode,
  workloadPanelOpen,
}: TopBarProps) {
  return (
    <header className="border-b border-border bg-chrome">
      <div className="flex h-[52px] items-center gap-2 px-2 sm:gap-3 sm:px-3 lg:px-4">
        <button
          aria-expanded={workloadPanelOpen}
          aria-label={workloadPanelOpen ? 'Close workload menu' : 'Open workload menu'}
          className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-surface-raised text-muted transition-colors hover:border-accent hover:text-foreground"
          title={workloadPanelOpen ? 'Close workload menu' : 'Open workload menu'}
          type="button"
          onClick={onMenu}
        >
          <svg aria-hidden="true" className="size-[18px]" viewBox="0 0 24 24">
            <rect fill="none" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" width="18" x="3" y="4" />
            <path d="M9 4v16" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path
              d={workloadPanelOpen ? 'm16 9-3 3 3 3' : 'm13 9 3 3-3 3'}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        </button>
        <div className="hidden min-w-0 sm:block">
          <div className="text-sm font-semibold leading-none">pmndrs/glyph</div>
          <div className="mt-1 font-mono text-[9px] text-dim">TEXT PERFORMANCE LAB</div>
        </div>
        {compact && (
          <RasterFormatSwitcher
            className="w-[136px] shrink-0 sm:w-[180px]"
            format={location.technique}
            onFormat={onFormat}
          />
        )}
        <div className="flex-1" />
        <span className="hidden min-[900px]:inline-flex">
          <Chip tone={webgpu ? 'success' : 'warning'}>{webgpu ? 'WebGPU available' : 'WebGPU unavailable'}</Chip>
        </span>
        {compact && !phone && (
          <Button
            aria-label="Open render controls"
            className="px-2 text-[10px] sm:px-3"
            variant={location.view === 'controls' ? 'primary' : 'secondary'}
            onClick={onControls}
          >
            Controls
          </Button>
        )}
        <Button
          aria-label="Enter Presentation Mode"
          className="hidden size-8 p-0 sm:inline-flex"
          title="Enter Presentation Mode"
          variant="secondary"
          onClick={onPresentationMode}
        >
          <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
            <path
              d="M6 2H2v4M10 2h4v4M14 10v4h-4M6 14H2v-4"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        </Button>
      </div>
    </header>
  );
}
