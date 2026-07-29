import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdvancedShapingFrame } from '../benchmark/advanced-shaping';
import {
  ADVANCED_FONT_FIXTURES,
  BENCHMARK_FONT_LABELS,
  ICON_GRID_FONT_FIXTURE,
  SELECTABLE_FONT_FIXTURES,
  selectableFontFixture,
  type BenchmarkFontFixture,
  type SelectableFontFixture,
} from '../benchmark/font-fixtures';
import type { HarnessLocation, HarnessMode, RasterTechnique } from '../benchmark/url-state';
import mtsdfFixtures from '../../fixtures/rendering/showcase-mtsdf-fixtures-v0.json';
import slugFixtures from '../../fixtures/rendering/showcase-slug-fixtures-v0.json';
import { TechniqueSwitcher } from './technique-switcher';

export interface WorkloadOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly techniques: Readonly<Record<RasterTechnique, WorkloadTechniqueStatus>>;
}

export interface WorkloadScrollEdges {
  readonly before: boolean;
  readonly after: boolean;
}

export function workloadScrollEdges({
  clientHeight,
  scrollHeight,
  scrollTop,
}: {
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
}): WorkloadScrollEdges {
  const maximumScrollTop = Math.max(0, scrollHeight - clientHeight);
  return {
    before: scrollTop > 0.5,
    after: scrollTop < maximumScrollTop - 0.5,
  };
}

type WorkloadTechniqueStatus = { readonly kind: 'ready' } | { readonly kind: 'planned'; readonly milestone: 8 | 9 };

const READY: WorkloadTechniqueStatus = { kind: 'ready' };

const benchmarkWorkloads: readonly WorkloadOption[] = [
  {
    id: 'benchmark-ipsum',
    label: 'Benchmark ipsum',
    description: 'Tests the everyday cost of rendering and reflowing a full paragraph.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'advanced-shaping',
    label: 'Advanced shaping',
    description: 'Tests whether complex text stays correct as it types and wraps.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'text-ladder',
    label: 'Text ladder',
    description: 'Tests how text quality holds up from 8 to 512 pixels.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'zoom-text',
    label: 'Zoom text',
    description: 'Cycles through translations of “Shape” while scaling from 8 pt to the largest size that fits.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'icon-grid',
    label: 'Icon grid',
    description: 'Tests a labeled icon font across scale, movement, and raster techniques.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'off-axis-3d',
    label: 'Off-axis / 3D',
    description: 'Tests text quality and cost at steep, moving viewing angles.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'dynamic-layout',
    label: 'Dynamic layout',
    description: 'Tests whether animated containers reflow text smoothly and correctly.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'paragraph-stress',
    label: 'Paragraph stress',
    description: 'Tests rendering cost as paragraphs, glyphs, and atlas pressure grow.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'paint-effects',
    label: 'Paint & effects',
    description: 'Tests the live cost and visual quality of animated text effects.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
];

const conformanceWorkloads: readonly WorkloadOption[] = [
  {
    id: 'mtsdf-slug-compare',
    label: 'MSDF / Slug compare',
    description: 'Renders MSDF and Slug side by side and compares their coverage in a live GPU heatmap.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'runtime-fallback',
    label: 'Runtime fallback parity',
    description: 'Tests whether source-font runtime baking reproduces the checked-in baked render.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'text-accuracy',
    label: 'Pipeline accuracy',
    description: 'Technique-specific renderer output, sampling reference, difference, and error statistics.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'cross-technique-fidelity',
    label: 'Cross-technique fidelity',
    description: 'Bitmap, MSDF, and Slug compared independently with the same outline-derived coverage reference.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
];

let comparisonWorkloadModule: ReturnType<typeof importComparisonWorkload> | undefined;

function importComparisonWorkload() {
  return import('../renderer/comparison-workload');
}

function preloadComparisonWorkload(): ReturnType<typeof importComparisonWorkload> {
  comparisonWorkloadModule ??= importComparisonWorkload();
  return comparisonWorkloadModule;
}

function isComparisonWorkload(workload: string): boolean {
  return (
    workload === 'text-ladder' ||
    workload === 'zoom-text' ||
    workload === 'icon-grid' ||
    workload === 'off-axis-3d' ||
    workload === 'dynamic-layout' ||
    workload === 'paragraph-stress' ||
    workload === 'paint-effects'
  );
}

function mtsdfFixtureFor(fontFixture: BenchmarkFontFixture) {
  const fixture = mtsdfFixtures.artifacts.find((candidate) => candidate.fontFixture === fontFixture);
  if (fixture === undefined) {
    throw new Error(`MTSDF fixture manifest is missing ${fontFixture}`);
  }
  return fixture;
}

function slugFixtureFor(fontFixture: BenchmarkFontFixture) {
  const fixture = slugFixtures.artifacts.find((candidate) => candidate.fontFixture === fontFixture);
  if (fixture === undefined) {
    throw new Error(`Slug fixture manifest is missing ${fontFixture}`);
  }
  return fixture;
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function workloadsFor(mode: HarnessMode): readonly WorkloadOption[] {
  if (mode === 'benchmark') return benchmarkWorkloads;
  return conformanceWorkloads;
}

export function workloadById(mode: HarnessMode, id: string): WorkloadOption {
  const workloads = workloadsFor(mode);
  return workloads.find((workload) => workload.id === id) ?? workloads[0]!;
}

function workloadRailDescription(workload: WorkloadOption, technique: RasterTechnique): string {
  const status = workload.techniques[technique];
  return status.kind === 'ready' ? workload.description : `M${status.milestone} · ${workload.description}`;
}

export function WorkloadRail({
  activeFontFixture,
  className = '',
  fontFixture,
  location,
  showcaseFrame,
  showTechnique = true,
  onAdvancedFontFixture,
  onFontFixture,
  onLocation,
  onTechnique,
}: {
  readonly activeFontFixture: BenchmarkFontFixture;
  readonly className?: string;
  readonly fontFixture: SelectableFontFixture;
  readonly location: HarnessLocation;
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly showTechnique?: boolean;
  readonly onAdvancedFontFixture: (fontFixture: BenchmarkFontFixture) => void;
  readonly onFontFixture: (fontFixture: SelectableFontFixture) => void;
  readonly onLocation: (value: Partial<HarnessLocation>) => void;
  readonly onTechnique: (technique: RasterTechnique) => void;
}) {
  const workloads = workloadsFor(location.mode);
  const displayedFontFixture =
    location.workload === 'icon-grid'
      ? ICON_GRID_FONT_FIXTURE
      : location.workload === 'zoom-text'
        ? 'inter'
        : activeFontFixture;
  const selectedMtsdfFixture = location.technique === 'mtsdf' ? mtsdfFixtureFor(displayedFontFixture) : undefined;
  const selectedSlugFixture = location.technique === 'slug' ? slugFixtureFor(displayedFontFixture) : undefined;
  const rasterDescription =
    selectedSlugFixture !== undefined
      ? `Analytic Slug · ${selectedSlugFixture.raster.pages.length} page${selectedSlugFixture.raster.pages.length === 1 ? '' : 's'} · ${formatBytes(selectedSlugFixture.raster.decodedGpuBytes)} GPU`
      : selectedMtsdfFixture !== undefined
        ? `${selectedMtsdfFixture.configuration.emSize} px/em MTSDF · ${selectedMtsdfFixture.configuration.pixelRange} px range · ${selectedMtsdfFixture.raster.pages.length} pages`
        : '16 px grayscale bitmap strike';
  const workloadScrollRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState<WorkloadScrollEdges>({ before: false, after: false });
  const syncScrollEdges = useCallback((element: HTMLDivElement) => {
    const next = workloadScrollEdges(element);
    setScrollEdges((current) => (current.before === next.before && current.after === next.after ? current : next));
  }, []);

  useEffect(() => {
    const element = workloadScrollRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => syncScrollEdges(element));
    observer.observe(element);
    const content = element.firstElementChild;
    if (content !== null) observer.observe(content);
    syncScrollEdges(element);
    return () => observer.disconnect();
  }, [location.mode, syncScrollEdges]);

  return (
    <aside className={`flex min-h-0 flex-col overflow-hidden border-r border-border bg-chrome ${className}`}>
      {showTechnique && (
        <div className="shrink-0 px-3 pt-3">
          <p className="eyebrow">Technique</p>
          <TechniqueSwitcher className="mt-2" technique={location.technique} onTechnique={onTechnique} />
        </div>
      )}
      <p className={`eyebrow shrink-0 px-3 pb-2 ${showTechnique ? 'pt-5' : 'pt-3'}`}>
        {location.mode === 'benchmark' ? 'Live workloads' : 'Conformance checks'}
      </p>
      <div className="relative min-h-0 flex-1">
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-7 bg-gradient-to-b from-chrome to-transparent transition-opacity ${scrollEdges.before ? 'opacity-100' : 'opacity-0'}`}
          data-testid="workload-scroll-start-fade"
        />
        <div
          className="h-full overflow-y-auto overscroll-contain px-3 pb-3"
          data-scroll-after={String(scrollEdges.after)}
          data-scroll-before={String(scrollEdges.before)}
          data-testid="workload-scroll"
          ref={workloadScrollRef}
          onScroll={(event) => syncScrollEdges(event.currentTarget)}
        >
          <nav className="grid gap-1">
            {workloads.map((workload) => (
              <button
                className={`relative rounded-md px-4 py-3 text-left ${location.workload === workload.id ? 'bg-surface-active text-foreground' : 'text-foreground hover:bg-surface'} disabled:cursor-not-allowed disabled:opacity-40`}
                disabled={workload.techniques[location.technique].kind !== 'ready'}
                key={workload.id}
                type="button"
                onClick={() => onLocation({ workload: workload.id })}
                onFocus={() => {
                  if (isComparisonWorkload(workload.id)) void preloadComparisonWorkload();
                }}
                onPointerEnter={() => {
                  if (isComparisonWorkload(workload.id)) void preloadComparisonWorkload();
                }}
              >
                <span
                  className={`absolute left-1.5 top-3 h-4 w-[3px] rounded-full ${location.workload === workload.id ? 'bg-accent' : 'bg-transparent'}`}
                />
                <span className="block text-xs">{workload.label}</span>
                <span className="mt-1 block font-mono text-[8px] leading-relaxed text-muted">
                  {workloadRailDescription(workload, location.technique)}
                </span>
              </button>
            ))}
          </nav>
        </div>
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-chrome to-transparent transition-opacity ${scrollEdges.after ? 'opacity-100' : 'opacity-0'}`}
          data-testid="workload-scroll-end-fade"
        />
      </div>
      <div
        className="relative z-20 shrink-0 border-t border-border bg-chrome px-3 py-2.5"
        data-testid="font-fixture-panel"
      >
        <p className="eyebrow mb-1.5">Font fixture</p>
        {location.workload === 'icon-grid' ? (
          <div
            className="rounded-md border border-accent bg-surface-active px-2.5 py-1.5"
            data-icon-font-fixture={ICON_GRID_FONT_FIXTURE}
          >
            <span className="block text-xs">{BENCHMARK_FONT_LABELS[ICON_GRID_FONT_FIXTURE]}</span>
            <span className="mt-1 block font-mono text-[8px] text-dim">1,402 packed solid icons</span>
          </div>
        ) : location.workload === 'zoom-text' ? (
          <div
            className="rounded-md border border-accent bg-surface-active px-2.5 py-1.5"
            data-zoom-font-fixture="inter"
          >
            <span className="block text-xs">{BENCHMARK_FONT_LABELS.inter}</span>
            <span className="mt-1 block font-mono text-[8px] text-dim">Fixed multilingual zoom fixture</span>
          </div>
        ) : location.workload === 'advanced-shaping' ? (
          <select
            aria-label="Font fixture"
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-accent"
            value={activeFontFixture}
            onChange={(event) => {
              const fixture = ADVANCED_FONT_FIXTURES.find((candidate) => candidate.id === event.currentTarget.value);
              if (fixture === undefined)
                throw new TypeError(`Unknown advanced font fixture: ${event.currentTarget.value}`);
              onAdvancedFontFixture(fixture.id);
            }}
          >
            {ADVANCED_FONT_FIXTURES.map((fixture) => (
              <option key={fixture.id} value={fixture.id}>
                {fixture.label}
                {showcaseFrame.caseDefinition.fontFixture === fixture.id ? ' · recommended' : ''}
              </option>
            ))}
          </select>
        ) : (
          <select
            aria-label="Font fixture"
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-accent"
            value={fontFixture}
            onChange={(event) => onFontFixture(selectableFontFixture(event.currentTarget.value))}
          >
            {SELECTABLE_FONT_FIXTURES.map((fixture) => (
              <option key={fixture.id} value={fixture.id}>
                {fixture.label}
              </option>
            ))}
          </select>
        )}
        <p className="mt-1.5 font-mono text-[8px] leading-tight text-dim">{rasterDescription}</p>
      </div>
    </aside>
  );
}
