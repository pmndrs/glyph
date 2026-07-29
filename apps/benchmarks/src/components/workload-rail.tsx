import type { AdvancedShapingFrame } from '../benchmark/advanced-shaping';
import {
  ADVANCED_FONT_FIXTURES,
  BENCHMARK_FONT_LABELS,
  ICON_GRID_FONT_FIXTURE,
  SELECTABLE_FONT_FIXTURES,
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
  return (
    <aside className={`overflow-auto overscroll-contain border-r border-border bg-chrome p-3 ${className}`}>
      {showTechnique && (
        <>
          <p className="eyebrow">Technique</p>
          <TechniqueSwitcher className="mt-2" technique={location.technique} onTechnique={onTechnique} />
        </>
      )}
      <p className={`eyebrow mb-2 ${showTechnique ? 'mt-5' : ''}`}>
        {location.mode === 'benchmark' ? 'Live workloads' : 'Conformance checks'}
      </p>
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
      <div className="mt-5">
        <p className="eyebrow mb-2">Font fixture</p>
        {location.workload === 'icon-grid' ? (
          <div
            className="rounded-md border border-accent bg-surface-active px-3 py-2"
            data-icon-font-fixture={ICON_GRID_FONT_FIXTURE}
          >
            <span className="block text-xs">{BENCHMARK_FONT_LABELS[ICON_GRID_FONT_FIXTURE]}</span>
            <span className="mt-1 block font-mono text-[8px] text-dim">1,402 packed solid icons</span>
          </div>
        ) : location.workload === 'zoom-text' ? (
          <div className="rounded-md border border-accent bg-surface-active px-3 py-2" data-zoom-font-fixture="inter">
            <span className="block text-xs">{BENCHMARK_FONT_LABELS.inter}</span>
            <span className="mt-1 block font-mono text-[8px] text-dim">Fixed multilingual zoom fixture</span>
          </div>
        ) : location.workload === 'advanced-shaping' ? (
          <div className="grid gap-1">
            {ADVANCED_FONT_FIXTURES.map((fixture) => (
              <button
                className={`rounded-md border px-3 py-2 text-left ${activeFontFixture === fixture.id ? 'border-accent bg-surface-active text-foreground' : 'border-border bg-surface text-muted'}`}
                key={fixture.id}
                type="button"
                onClick={() => onAdvancedFontFixture(fixture.id)}
              >
                <span className="block text-xs">{fixture.label}</span>
                <span className="mt-1 block font-mono text-[8px] text-dim">
                  {fixture.metadata}
                  {showcaseFrame.caseDefinition.fontFixture === fixture.id ? ' · recommended' : ''}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid gap-1">
            {SELECTABLE_FONT_FIXTURES.map((fixture) => (
              <button
                className={`rounded-md border px-3 py-2 text-left ${fontFixture === fixture.id ? 'border-accent bg-surface-active text-foreground' : 'border-border bg-surface text-muted'}`}
                key={fixture.id}
                type="button"
                onClick={() => onFontFixture(fixture.id)}
              >
                <span className="block text-xs">{fixture.label}</span>
                <span className="mt-1 block font-mono text-[8px] text-dim">{fixture.metadata}</span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 font-mono text-[9px] text-dim">{rasterDescription}</p>
      </div>
    </aside>
  );
}
