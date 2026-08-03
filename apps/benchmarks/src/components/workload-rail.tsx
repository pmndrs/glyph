import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AdvancedShapingFrame } from '../workloads/advanced-shaping';
import {
  ADVANCED_FONT_FIXTURES,
  BENCHMARK_FONT_LABELS,
  ICON_GRID_FONT_FIXTURE,
  SELECTABLE_FONT_FIXTURES,
  selectableFontFixture,
  type BenchmarkFontFixture,
  type SelectableFontFixture,
} from '../benchmark/font-fixtures';
import type { HarnessLocation, RasterTechnique } from '../benchmark/url-state';
import {
  workloadScrollEdges,
  workloadsFor,
  type WorkloadOption,
  type WorkloadScrollEdges,
} from '../benchmark/workloads';
import mtsdfFixtures from '../../fixtures/rendering/showcase-mtsdf-fixtures-v0.json';
import slugFixtures from '../../fixtures/rendering/showcase-slug-fixtures-v0.json';
import { FontFixtureButtons, type FontFixtureButtonOption } from './font-fixture-buttons';
import { TechniqueSwitcher } from './technique-switcher';

let comparisonWorkloadModule: ReturnType<typeof importComparisonWorkload> | undefined;

function importComparisonWorkload() {
  return import('../workloads/comparison/scene');
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

function workloadRailDescription(workload: WorkloadOption, technique: RasterTechnique): string {
  const status = workload.techniques[technique];
  return status.kind === 'ready' ? workload.description : `M${status.milestone} · ${workload.description}`;
}

function synchronizeScrollEdges(
  element: HTMLDivElement,
  setEdges: Dispatch<SetStateAction<WorkloadScrollEdges>>,
): void {
  const next = workloadScrollEdges(element);
  setEdges((current) => (current.before === next.before && current.after === next.after ? current : next));
}

export function WorkloadRail({
  activeFontFixture,
  className = '',
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
  const fixtureScrollRef = useRef<HTMLDivElement>(null);
  const [fixtureScrollEdges, setFixtureScrollEdges] = useState<WorkloadScrollEdges>({ before: false, after: false });
  useEffect(() => {
    const element = workloadScrollRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => synchronizeScrollEdges(element, setScrollEdges));
    observer.observe(element);
    const content = element.firstElementChild;
    if (content !== null) observer.observe(content);
    synchronizeScrollEdges(element, setScrollEdges);
    return () => observer.disconnect();
  }, [location.mode]);

  useEffect(() => {
    const element = fixtureScrollRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => synchronizeScrollEdges(element, setFixtureScrollEdges));
    observer.observe(element);
    const content = element.firstElementChild;
    if (content !== null) observer.observe(content);
    synchronizeScrollEdges(element, setFixtureScrollEdges);
    return () => observer.disconnect();
  }, [activeFontFixture, location.technique, location.workload]);

  const fixtureOptions: readonly FontFixtureButtonOption<BenchmarkFontFixture>[] =
    location.workload === 'icon-grid'
      ? [
          {
            id: ICON_GRID_FONT_FIXTURE,
            label: BENCHMARK_FONT_LABELS[ICON_GRID_FONT_FIXTURE],
            metadata: '1,402 packed solid icons',
            dataAttribute: 'icon',
          },
        ]
      : location.workload === 'zoom-text'
        ? [
            {
              id: 'inter',
              label: BENCHMARK_FONT_LABELS.inter,
              metadata: 'Fixed multilingual zoom fixture',
              dataAttribute: 'zoom',
            },
          ]
        : location.workload === 'advanced-shaping'
          ? ADVANCED_FONT_FIXTURES.map((fixture) => ({
              id: fixture.id,
              label: fixture.label,
              metadata: `${fixture.metadata}${showcaseFrame.caseDefinition.fontFixture === fixture.id ? ' · recommended' : ''}`,
            }))
          : SELECTABLE_FONT_FIXTURES;
  const fixtureReadOnly = location.workload === 'icon-grid' || location.workload === 'zoom-text';

  return (
    <aside className={`flex min-h-0 flex-col overflow-hidden border-r border-border bg-chrome ${className}`}>
      {showTechnique && (
        <div className="shrink-0 px-3 pt-3">
          <p className="eyebrow">Technique</p>
          <TechniqueSwitcher className="mt-2" technique={location.technique} onTechnique={onTechnique} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col" data-testid="workload-fixture-region">
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
            onScroll={(event) => synchronizeScrollEdges(event.currentTarget, setScrollEdges)}
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
          className="relative z-20 flex max-h-[50%] min-h-0 shrink-0 flex-col overflow-hidden border-t border-border bg-chrome"
          data-testid="font-fixture-panel"
        >
          <p className="eyebrow shrink-0 px-3 pb-1.5 pt-2.5">Font fixture</p>
          <div className="relative min-h-0 flex-1">
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-7 bg-gradient-to-b from-chrome to-transparent transition-opacity ${fixtureScrollEdges.before ? 'opacity-100' : 'opacity-0'}`}
              data-testid="font-fixture-scroll-start-fade"
            />
            <div
              className="max-h-full overflow-y-auto overscroll-contain px-3 pb-2.5"
              data-scroll-after={String(fixtureScrollEdges.after)}
              data-scroll-before={String(fixtureScrollEdges.before)}
              data-testid="font-fixture-scroll"
              ref={fixtureScrollRef}
              onScroll={(event) => synchronizeScrollEdges(event.currentTarget, setFixtureScrollEdges)}
            >
              <FontFixtureButtons
                options={fixtureOptions}
                readOnly={fixtureReadOnly}
                value={displayedFontFixture}
                onChange={(value) => {
                  if (location.workload === 'advanced-shaping') {
                    onAdvancedFontFixture(value);
                  } else if (!fixtureReadOnly) {
                    onFontFixture(selectableFontFixture(value));
                  }
                }}
              />
            </div>
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-chrome to-transparent transition-opacity ${fixtureScrollEdges.after ? 'opacity-100' : 'opacity-0'}`}
              data-testid="font-fixture-scroll-end-fade"
            />
          </div>
          <p className="shrink-0 px-3 pb-2.5 pt-1.5 font-mono text-[8px] leading-tight text-dim">{rasterDescription}</p>
        </div>
      </div>
    </aside>
  );
}
