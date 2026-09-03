import type { HarnessLocation, HarnessMode, RasterFormatName } from '../benchmark/url-state';
import { RasterFormatSwitcher } from './raster-format-switcher';
import { Button, Chip } from './ui';

export interface TopBarProps {
  readonly compact: boolean;
  readonly phone: boolean;
  readonly location: HarnessLocation;
  readonly mode: HarnessMode;
  readonly liveFormatComparison: boolean;
  readonly pending: boolean;
  readonly ready: boolean;
  readonly webgpu: boolean;
  readonly onAction: () => void;
  readonly onControls: () => void;
  readonly onMenu: () => void;
  readonly onMode: (mode: HarnessMode) => void;
  readonly onFormat: (technique: RasterFormatName) => void;
  readonly onPresentationMode: () => void;
  readonly workloadPanelOpen: boolean;
}

export function TopBar({
  compact,
  phone,
  location,
  mode,
  liveFormatComparison,
  pending,
  ready,
  webgpu,
  onAction,
  onControls,
  onMenu,
  onMode,
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
        <div className="flex rounded-md border border-border bg-background p-0.5 sm:ml-3">
          {(['benchmark', 'conformance'] as const).map((value) => (
            <button
              aria-label={value}
              className={`min-h-7 rounded px-2 py-1.5 text-[10px] capitalize sm:px-3 sm:text-[11px] ${mode === value ? 'bg-surface-active text-foreground' : 'text-muted hover:bg-surface'}`}
              key={value}
              type="button"
              onClick={() => onMode(value)}
            >
              <span className="sm:hidden">{value === 'benchmark' ? 'Bench' : 'Test'}</span>
              <span className="hidden sm:inline">{value}</span>
            </button>
          ))}
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
        {mode === 'benchmark' && (
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
        )}
        <Button
          aria-label={
            mode === 'benchmark'
              ? location.view === 'report'
                ? 'Return to live benchmark'
                : 'Capture report'
              : liveFormatComparison
                ? 'Live GPU comparison'
                : 'Run conformance'
          }
          className="px-2 text-[10px] sm:px-3 sm:text-xs"
          disabled={!ready}
          variant="primary"
          onClick={onAction}
        >
          {pending ? (
            'Running…'
          ) : mode === 'benchmark' ? (
            location.view === 'report' ? (
              'Live view'
            ) : (
              <>
                <span className="sm:hidden">Capture</span>
                <span className="hidden sm:inline">Capture report</span>
              </>
            )
          ) : liveFormatComparison ? (
            'Live compare'
          ) : (
            <>
              <span className="sm:hidden">Run</span>
              <span className="hidden sm:inline">Run conformance</span>
            </>
          )}
        </Button>
      </div>
    </header>
  );
}
