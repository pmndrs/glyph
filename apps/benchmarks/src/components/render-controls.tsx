import type { ReactNode } from 'react';

import {
  ADVANCED_SHAPING_CASES,
  type AdvancedShapingCommand,
  type AdvancedShapingFrame,
  type AdvancedShapingState,
} from '../workloads/advanced-shaping/scene';
import {
  BENCHMARK_FONT_LABELS,
  ICON_GRID_FONT_FIXTURE,
  SELECTABLE_FONT_FIXTURES,
  liveWorkloadFontFixtures,
  selectableFontFixture,
  type BenchmarkFontFixture,
  type SelectableFontFixture,
} from '../benchmark/font-fixtures';
import type { FontDelivery, GraphicsBackend, HarnessMode, RasterFormatName } from '../benchmark/url-state';
import packageSizes from '../generated/package-sizes.json';
import type { BitmapTextLiveStats } from '../techniques/bitmap/persistent-scene';
import type { MtsdfTextLiveStats } from '../techniques/mtsdf/persistent-scene';
import type { SlugTextLiveStats } from '../techniques/slug/persistent-scene';
import { FontFixtureButtons } from './font-fixture-buttons';
import { Button, Field, SelectField, TextareaField, Toggle } from './ui';
import { PresentationControlDock } from './presentation-control-dock';
import bitmapFixtures from '../../fixtures/rendering/showcase-bitmap-density-fixtures-v0.json';
import mtsdfFixtures from '../../fixtures/rendering/showcase-mtsdf-fixtures-v0.json';
import slugFixtures from '../../fixtures/rendering/showcase-slug-fixtures-v0.json';

type LiveTextStats = BitmapTextLiveStats | MtsdfTextLiveStats | SlugTextLiveStats;

export interface ConformanceView {
  readonly zoom: number;
  readonly panXPercent: number;
  readonly panYPercent: number;
}

function formatLabel(technique: RasterFormatName): 'Bitmap' | 'MSDF' | 'Slug' {
  return technique === 'mtsdf' ? 'MSDF' : technique === 'slug' ? 'Slug' : 'Bitmap';
}

function workloadAmountLabel(workload: string, amount: number): string | undefined {
  switch (workload) {
    case 'off-axis-3d':
      return `Perspective intensity · ${amount}%`;
    case 'dynamic-layout':
      return `Reflow amplitude · ${amount}%`;
    case 'paragraph-stress':
      return `Text volume · ${amount}%`;
    case 'paint-effects':
      return `Hue spread · ${amount}%`;
    case 'rich-text':
      return `Span density · ${amount}%`;
    default:
      return undefined;
  }
}

function workloadHasLayoutWidth(workload: string): boolean {
  switch (workload) {
    case 'benchmark-ipsum':
    case 'dynamic-layout':
    case 'off-axis-3d':
    case 'paint-effects':
    case 'paragraph-stress':
    case 'rich-text':
      return true;
    default:
      return false;
  }
}

function liveWorkloadControlDescription(workload: string, technique: RasterFormatName): string {
  switch (workload) {
    case 'advanced-shaping':
      return technique === 'bitmap'
        ? 'Bitmap text looks best at its baked 16 px strike; scaling exposes the need for additional strikes.'
        : technique === 'mtsdf'
          ? 'MSDF text uses one 64 px/em atlas to stay crisp across the rendered-size range.'
          : 'Slug evaluates the source outlines analytically across the rendered-size range.';
    case 'text-ladder':
      return 'Use the ladder to compare crispness and artifacts from 8 to 1024 pixels.';
    case 'zoom-text':
      return 'Centered translations of “Shape” cycle while scaling from 8 pt to the largest size the viewport fits.';
    case 'icon-grid':
      return 'Scale and pan a labeled Font Awesome icon grid rendered through the selected raster format.';
    case 'off-axis-3d':
      return 'Increase perspective to inspect text at steeper viewing angles.';
    case 'dynamic-layout':
      return 'Adjust reflow to stress three independently resizing paragraphs.';
    case 'paragraph-stress':
      return 'Increase text volume to inspect layout, draw, memory, CPU, and GPU cost.';
    case 'paint-effects':
      return technique === 'slug'
        ? 'Adjust color and opacity while watching their live analytic rendering cost; Slug V0 intentionally omits stroke and shadow.'
        : 'Adjust color, opacity, stroke, and shadow while watching their live rendering cost.';
    default:
      return 'Change the paragraph width to inspect live reflow quality and cost.';
  }
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function mtsdfFixtureFor(fontFixture: BenchmarkFontFixture) {
  const fixture = mtsdfFixtures.artifacts.find((candidate) => candidate.fontFixture === fontFixture);
  if (fixture === undefined) throw new Error(`MTSDF fixture manifest is missing ${fontFixture}`);
  return fixture;
}

function bitmapFixtureFor(fontFixture: BenchmarkFontFixture) {
  const fixture = bitmapFixtures.artifacts.find((candidate) => candidate.fontFixture === fontFixture);
  if (fixture === undefined) throw new Error(`bitmap fixture manifest is missing ${fontFixture}`);
  return fixture;
}

function slugFixtureFor(fontFixture: BenchmarkFontFixture) {
  const fixture = slugFixtures.artifacts.find((candidate) => candidate.fontFixture === fontFixture);
  if (fixture === undefined) throw new Error(`Slug fixture manifest is missing ${fontFixture}`);
  return fixture;
}

export interface ControlsProps {
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
  readonly comparisonText: string;
  readonly conformanceView: ConformanceView;
  readonly dpr: 1 | 2;
  readonly fontFixture: BenchmarkFontFixture;
  readonly liveStats: LiveTextStats | undefined;
  readonly minimal?: boolean;
  readonly fontSize: number;
  readonly layoutWidthPercent: number;
  readonly paintOpacityPercent: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokePercent: number;
  readonly selectedFontFixture: SelectableFontFixture;
  readonly workloadAmount: number;
  readonly mode: HarnessMode;
  readonly technique: RasterFormatName;
  readonly workload: string;
  readonly samples: number;
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly showcaseState: AdvancedShapingState;
  readonly showGrid: boolean;
  readonly showLayoutBounds: boolean;
  readonly warmup: number;
  readonly webgpu: boolean;
  readonly onBackend: (backend: GraphicsBackend) => void;
  readonly onDelivery: (delivery: FontDelivery) => void;
  readonly onAnimationEnabled: (value: boolean) => void;
  readonly onAnimationSpeed: (value: number) => void;
  readonly onComparisonText: (value: string) => void;
  readonly onConformanceReset: () => void;
  readonly onConformanceZoom: (zoom: number) => void;
  readonly onDpr: (dpr: 1 | 2) => void;
  readonly onFontSize: (value: number) => void;
  readonly onFontNotices: () => void;
  readonly onLayoutWidthPercent: (value: number) => void;
  readonly onPaintOpacityPercent: (value: number) => void;
  readonly onPaintShadowEnabled: (value: boolean) => void;
  readonly onPaintStrokePercent: (value: number) => void;
  readonly onSelectedFontFixture: (value: SelectableFontFixture) => void;
  readonly onWorkloadAmount: (value: number) => void;
  readonly onSamples: (value: number) => void;
  readonly onShowcase: (command: AdvancedShapingCommand) => void;
  readonly onShowGrid: (value: boolean) => void;
  readonly onShowLayoutBounds: (value: boolean) => void;
  readonly onWarmup: (value: number) => void;
}

export function Controls(props: ControlsProps) {
  if (props.minimal === true) {
    return (
      <PresentationControlDock
        animationEnabled={props.animationEnabled}
        animationSpeed={props.animationSpeed}
        backend={props.backend}
        dpr={props.dpr}
        fontSize={props.fontSize}
        layoutWidthPercent={props.layoutWidthPercent}
        paintOpacityPercent={props.paintOpacityPercent}
        paintShadowEnabled={props.paintShadowEnabled}
        paintStrokePercent={props.paintStrokePercent}
        showcaseFrame={props.showcaseFrame}
        showcaseState={props.showcaseState}
        showLayoutBounds={props.showLayoutBounds}
        technique={props.technique}
        webgpu={props.webgpu}
        workload={props.workload}
        workloadAmount={props.workloadAmount}
        onAnimationEnabled={props.onAnimationEnabled}
        onAnimationSpeed={props.onAnimationSpeed}
        onBackend={props.onBackend}
        onDpr={props.onDpr}
        onFontSize={props.onFontSize}
        onLayoutWidthPercent={props.onLayoutWidthPercent}
        onPaintOpacityPercent={props.onPaintOpacityPercent}
        onPaintShadowEnabled={props.onPaintShadowEnabled}
        onPaintStrokePercent={props.onPaintStrokePercent}
        onShowcase={props.onShowcase}
        onShowLayoutBounds={props.onShowLayoutBounds}
        onWorkloadAmount={props.onWorkloadAmount}
      />
    );
  }
  return <StandardControls {...props} />;
}

function StandardControls(props: ControlsProps) {
  return (
    <section className="grid min-w-0 gap-4 [&>*]:min-w-0" data-testid="controls">
      <div>
        <p className="eyebrow">Inspection controls</p>
        <h2 className="mt-1 text-base font-semibold">Render configuration</h2>
      </div>
      {props.workload !== 'advanced-shaping' && (
        <CompactFontFixtureControl
          selectedFontFixture={props.selectedFontFixture}
          workload={props.workload}
          onSelectedFontFixture={props.onSelectedFontFixture}
        />
      )}
      <RenderConfigurationControls {...props} />
      {props.mode === 'conformance' && <ConformanceControls {...props} />}
      {props.mode === 'benchmark' && (
        <LiveWorkloadControls
          animationEnabled={props.animationEnabled}
          animationSpeed={props.animationSpeed}
          fontSize={props.fontSize}
          layoutWidthPercent={props.layoutWidthPercent}
          paintOpacityPercent={props.paintOpacityPercent}
          paintShadowEnabled={props.paintShadowEnabled}
          paintStrokePercent={props.paintStrokePercent}
          showLayoutBounds={props.showLayoutBounds}
          technique={props.technique}
          workload={props.workload}
          workloadAmount={props.workloadAmount}
          onAnimationEnabled={props.onAnimationEnabled}
          onAnimationSpeed={props.onAnimationSpeed}
          onFontSize={props.onFontSize}
          onLayoutWidthPercent={props.onLayoutWidthPercent}
          onPaintOpacityPercent={props.onPaintOpacityPercent}
          onPaintShadowEnabled={props.onPaintShadowEnabled}
          onPaintStrokePercent={props.onPaintStrokePercent}
          onShowLayoutBounds={props.onShowLayoutBounds}
          onWorkloadAmount={props.onWorkloadAmount}
        />
      )}
      {props.mode === 'benchmark' && props.workload === 'advanced-shaping' && (
        <AdvancedShapingControls
          showcaseFrame={props.showcaseFrame}
          showcaseState={props.showcaseState}
          onShowcase={props.onShowcase}
        />
      )}
      <PayloadInspector
        delivery={props.delivery}
        fontFixture={props.fontFixture}
        liveStats={props.liveStats}
        technique={props.technique}
        workload={props.workload}
      />
      <button
        className="min-h-7 text-left text-[9px] text-muted underline decoration-border underline-offset-4 hover:text-foreground"
        type="button"
        onClick={props.onFontNotices}
      >
        Font licenses &amp; notices
      </button>
    </section>
  );
}

function RenderConfigurationControls(props: ControlsProps) {
  return (
    <>
      <div>
        <p className="mb-2 font-mono text-[9px] uppercase text-dim">Backend</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={!props.webgpu}
            variant={props.backend === 'webgpu' ? 'primary' : 'secondary'}
            onClick={() => props.onBackend('webgpu')}
          >
            WebGPU
          </Button>
          <Button
            variant={props.backend === 'webgl2' ? 'primary' : 'secondary'}
            onClick={() => props.onBackend('webgl2')}
          >
            WebGL
          </Button>
        </div>
      </div>
      <div data-testid="font-delivery-switcher">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-2">
          <fieldset className="grid min-w-0 gap-1.5">
            <legend className="font-mono text-[9px] uppercase text-dim">DPR</legend>
            <div className="grid grid-cols-2 rounded-md border border-border bg-background p-0.5">
              {([1, 2] as const).map((value) => (
                <button
                  aria-pressed={props.dpr === value}
                  className={`min-h-7 rounded px-3 text-[11px] font-medium transition-colors ${props.dpr === value ? 'bg-accent text-white' : 'text-muted hover:bg-surface hover:text-foreground'}`}
                  key={value}
                  type="button"
                  onClick={() => props.onDpr(value)}
                >
                  {value}×
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-1.5">
            <p className="font-mono text-[9px] uppercase text-dim">Source</p>
            <Button
              aria-pressed={props.delivery === 'baked'}
              className="min-w-[84px] gap-1.5"
              variant={props.delivery === 'baked' ? 'primary' : 'secondary'}
              onClick={() => props.onDelivery(props.delivery === 'baked' ? 'runtime' : 'baked')}
            >
              <span aria-hidden="true" className="inline-block w-3 text-center">
                {props.delivery === 'baked' ? '✓' : ''}
              </span>
              Baked
            </Button>
          </div>
          <div className="grid gap-1.5">
            <p className="font-mono text-[9px] uppercase text-dim">Grid</p>
            <Button
              aria-label="Show canvas grid"
              aria-pressed={props.showGrid}
              className="w-8 px-0"
              title="Show canvas grid"
              variant={props.showGrid ? 'primary' : 'secondary'}
              onClick={() => props.onShowGrid(!props.showGrid)}
            >
              <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
                <path d="M1.5 5.5h13m-13 5h13m-9-9v13m5-13v13" stroke="currentColor" />
                <rect height="13" rx="1" stroke="currentColor" width="13" x="1.5" y="1.5" />
              </svg>
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function ConformanceControls(props: ControlsProps) {
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-md border border-border bg-surface p-3">
        <Field
          label={`Zoom · ${props.conformanceView.zoom.toFixed(2)}×`}
          max={8}
          min={1}
          step={0.25}
          type="range"
          value={props.conformanceView.zoom}
          onChange={(event) => props.onConformanceZoom(event.currentTarget.valueAsNumber)}
        />
        <Button variant="secondary" onClick={props.onConformanceReset}>
          Reset zoom
        </Button>
      </div>
      {props.workload === 'mtsdf-slug-compare' && (
        <div className="rounded-md border border-border bg-surface p-3">
          <TextareaField
            label="Comparison text"
            value={props.comparisonText}
            onChange={(event) => props.onComparisonText(event.currentTarget.value)}
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Warmup"
          min={0}
          type="number"
          value={props.warmup}
          onChange={(event) => props.onWarmup(event.currentTarget.valueAsNumber)}
        />
        <Field
          label="Samples"
          min={1}
          type="number"
          value={props.samples}
          onChange={(event) => props.onSamples(event.currentTarget.valueAsNumber)}
        />
      </div>
    </>
  );
}

function CompactFontFixtureControl({
  selectedFontFixture,
  workload,
  onSelectedFontFixture,
}: {
  readonly selectedFontFixture: SelectableFontFixture;
  readonly workload: string;
  readonly onSelectedFontFixture: (value: SelectableFontFixture) => void;
}) {
  const options =
    workload === 'icon-grid'
      ? [
          {
            id: ICON_GRID_FONT_FIXTURE,
            label: BENCHMARK_FONT_LABELS[ICON_GRID_FONT_FIXTURE],
            metadata: '1,402 packed solid icons',
            dataAttribute: 'icon' as const,
          },
        ]
      : workload === 'zoom-text'
        ? [
            {
              id: 'inter' as const,
              label: BENCHMARK_FONT_LABELS.inter,
              metadata: 'Fixed multilingual zoom fixture',
              dataAttribute: 'zoom' as const,
            },
          ]
        : SELECTABLE_FONT_FIXTURES;
  const value =
    workload === 'icon-grid' ? ICON_GRID_FONT_FIXTURE : workload === 'zoom-text' ? 'inter' : selectedFontFixture;
  const readOnly = workload === 'icon-grid' || workload === 'zoom-text';
  return (
    <div className="grid gap-1.5 min-[1200px]:hidden">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">Font fixture</span>
      <FontFixtureButtons
        options={options}
        readOnly={readOnly}
        value={value}
        onChange={(next) => {
          if (!readOnly) onSelectedFontFixture(selectableFontFixture(next));
        }}
      />
    </div>
  );
}

function LiveWorkloadControls({
  animationEnabled,
  animationSpeed,
  fontSize,
  layoutWidthPercent,
  paintOpacityPercent,
  paintShadowEnabled,
  paintStrokePercent,
  showLayoutBounds,
  technique,
  workload,
  workloadAmount,
  onAnimationEnabled,
  onAnimationSpeed,
  onFontSize,
  onLayoutWidthPercent,
  onPaintOpacityPercent,
  onPaintShadowEnabled,
  onPaintStrokePercent,
  onShowLayoutBounds,
  onWorkloadAmount,
}: {
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly fontSize: number;
  readonly layoutWidthPercent: number;
  readonly paintOpacityPercent: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokePercent: number;
  readonly showLayoutBounds: boolean;
  readonly technique: RasterFormatName;
  readonly workload: string;
  readonly workloadAmount: number;
  readonly onAnimationEnabled: (value: boolean) => void;
  readonly onAnimationSpeed: (value: number) => void;
  readonly onFontSize: (value: number) => void;
  readonly onLayoutWidthPercent: (value: number) => void;
  readonly onPaintOpacityPercent: (value: number) => void;
  readonly onPaintShadowEnabled: (value: boolean) => void;
  readonly onPaintStrokePercent: (value: number) => void;
  readonly onShowLayoutBounds: (value: boolean) => void;
  readonly onWorkloadAmount: (value: number) => void;
}) {
  const amountLabel = workloadAmountLabel(workload, workloadAmount);
  return (
    <div className="grid gap-3 rounded-md border border-border bg-surface p-3">
      <p className="eyebrow">Live workload</p>
      {workload === 'text-ladder' ? (
        <p className="font-mono text-[9px] uppercase text-muted">Rendered range · 8–1024 CSS px</p>
      ) : workload !== 'zoom-text' ? (
        <Field
          label={`${workload === 'icon-grid' ? 'Icon size' : 'Rendered size'} · ${fontSize} CSS px`}
          max={workload === 'icon-grid' ? 1_024 : 96}
          min={8}
          rangeScale={workload === 'icon-grid' ? 'logarithmic' : 'linear'}
          step={1}
          type="range"
          value={fontSize}
          {...(workload === 'icon-grid' ? { onRangeValueChange: onFontSize } : {})}
          onChange={workload === 'icon-grid' ? undefined : (event) => onFontSize(event.currentTarget.valueAsNumber)}
        />
      ) : null}
      {workloadHasLayoutWidth(workload) && (
        <Field
          label={`Layout width · ${layoutWidthPercent}%`}
          max={workload === 'off-axis-3d' ? 200 : 100}
          min={40}
          step={2}
          type="range"
          value={layoutWidthPercent}
          onChange={(event) => onLayoutWidthPercent(event.currentTarget.valueAsNumber)}
        />
      )}
      {amountLabel !== undefined && (
        <Field
          label={amountLabel}
          max={100}
          min={0}
          step={1}
          type="range"
          value={workloadAmount}
          onChange={(event) => onWorkloadAmount(event.currentTarget.valueAsNumber)}
        />
      )}
      {(workload === 'off-axis-3d' ||
        workload === 'icon-grid' ||
        workload === 'paint-effects' ||
        workload === 'zoom-text' ||
        workload === 'text-ladder' ||
        workload === 'dynamic-layout' ||
        workload === 'paragraph-stress' ||
        workload === 'rich-text') && (
        <>
          <Toggle checked={animationEnabled} label="Animate" onChange={onAnimationEnabled} />
          <Field
            label={`Animation speed · ${animationSpeed}%`}
            max={100}
            min={0}
            step={1}
            type="range"
            value={animationSpeed}
            onChange={(event) => onAnimationSpeed(event.currentTarget.valueAsNumber)}
          />
        </>
      )}
      {workload === 'dynamic-layout' && (
        <Toggle checked={showLayoutBounds} label="Show layout bounds" onChange={onShowLayoutBounds} />
      )}
      {(workload === 'paint-effects' || workload === 'rich-text') && (
        <>
          <Field
            label={`Opacity · ${paintOpacityPercent}%`}
            max={100}
            min={0}
            step={1}
            type="range"
            value={paintOpacityPercent}
            onChange={(event) => onPaintOpacityPercent(event.currentTarget.valueAsNumber)}
          />
          <Field
            disabled={technique !== 'mtsdf'}
            label={
              technique === 'mtsdf'
                ? `Stroke width · ${paintStrokePercent}%`
                : technique === 'slug'
                  ? 'Stroke width · unavailable for Slug V0'
                  : 'Stroke width · unavailable for bitmap'
            }
            max={100}
            min={0}
            step={1}
            type="range"
            value={technique === 'mtsdf' ? paintStrokePercent : 0}
            onChange={(event) => onPaintStrokePercent(event.currentTarget.valueAsNumber)}
          />
          <Toggle
            checked={technique === 'mtsdf' && paintShadowEnabled}
            disabled={technique !== 'mtsdf'}
            label={
              technique === 'mtsdf'
                ? 'Shadow'
                : technique === 'slug'
                  ? 'Shadow · unavailable for Slug V0'
                  : 'Shadow · unavailable for bitmap'
            }
            onChange={onPaintShadowEnabled}
          />
        </>
      )}
      <p className="min-h-[30px] text-[10px] leading-relaxed text-muted">
        {liveWorkloadControlDescription(workload, technique)}
      </p>
    </div>
  );
}

function AdvancedShapingControls({
  showcaseFrame,
  showcaseState,
  onShowcase,
}: {
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly showcaseState: AdvancedShapingState;
  readonly onShowcase: (command: AdvancedShapingCommand) => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border border-border bg-surface p-3">
      <p className="eyebrow">Shaping timeline</p>
      <SelectField
        label="Case"
        options={ADVANCED_SHAPING_CASES.map((definition) => ({
          label: definition.label,
          value: definition.id,
        }))}
        value={showcaseState.caseId}
        onChange={(caseId) => {
          const definition = ADVANCED_SHAPING_CASES.find((entry) => entry.id === caseId);
          if (definition !== undefined) {
            onShowcase({ kind: 'select-case', caseId: definition.id });
          }
        }}
      />
      <Toggle
        checked={showcaseState.auto}
        label="Auto case cycle"
        onChange={(enabled) => onShowcase({ kind: 'set-auto', enabled })}
      />
      <Field
        label={`Reveal speed · ${showcaseState.revealUnitsPerSecond.toFixed(0)}/s`}
        max={240}
        min={10}
        step={1}
        type="range"
        value={showcaseState.revealUnitsPerSecond}
        onChange={(event) => onShowcase({ kind: 'set-speed', revealUnitsPerSecond: event.currentTarget.valueAsNumber })}
      />
      <TextareaField
        label="Live text"
        value={showcaseFrame.text}
        onChange={(event) => onShowcase({ kind: 'edit', text: event.currentTarget.value })}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          variant={showcaseState.playing ? 'primary' : 'secondary'}
          onClick={() => onShowcase({ kind: showcaseState.playing ? 'pause' : 'play' })}
        >
          {showcaseState.playing ? 'Pause' : 'Play'}
        </Button>
        <Button onClick={() => onShowcase({ kind: 'reset' })}>Reset</Button>
      </div>
      <Field
        label={`Timeline · ${showcaseFrame.tick} / ${showcaseFrame.tickCount}`}
        max={showcaseFrame.tickCount}
        min={0}
        step={1}
        type="range"
        value={showcaseFrame.tick}
        onChange={(event) => onShowcase({ kind: 'seek', tick: event.currentTarget.valueAsNumber })}
      />
      <p className="font-mono text-[9px] leading-relaxed text-muted">
        {showcaseFrame.caseDefinition.language.toUpperCase()} · {showcaseFrame.caseDefinition.direction.toUpperCase()} ·
        WIDTH {(showcaseFrame.widthPermille / 10).toFixed(0)}%
      </p>
    </div>
  );
}

function PayloadInspector({
  delivery,
  fontFixture,
  liveStats,
  technique,
  workload,
}: {
  readonly delivery: FontDelivery;
  readonly fontFixture: BenchmarkFontFixture;
  readonly liveStats: LiveTextStats | undefined;
  readonly technique: RasterFormatName;
  readonly workload: string;
}) {
  const runtime = measuredPackageSizeIfAvailable(`${technique}-runtime-js`);
  const shaper = measuredPackageSize('text-shaper-wasm');
  const bakerHost = measuredPackageSizeIfAvailable(`${technique}-baker-js`);
  const bakerWasm = measuredPackageSizeIfAvailable(`${technique}-baker-wasm`);
  const runtimeBakerHost = measuredPackageSize('runtime-baker-host-js');
  const runtimeBakerWorker = measuredPackageSize('runtime-baker-worker-js');
  const coreBakerHost = measuredPackageSize('portable-baker-js');
  const coreBakerWasm = measuredPackageSize('portable-baker-wasm');
  const libraryTransferBytes = runtime === undefined ? undefined : runtime.gzipBytes + shaper.gzipBytes;
  const bakerTransferBytes =
    bakerHost === undefined || bakerWasm === undefined
      ? undefined
      : runtimeBakerHost.gzipBytes +
        runtimeBakerWorker.gzipBytes +
        coreBakerHost.gzipBytes +
        coreBakerWasm.gzipBytes +
        bakerHost.gzipBytes +
        bakerWasm.gzipBytes;
  const bitmapStats = liveStats?.technique === 'bitmap' ? liveStats : undefined;
  const mtsdfStats = liveStats?.technique === 'mtsdf' ? liveStats : undefined;
  const slugStats = liveStats?.technique === 'slug' ? liveStats : undefined;
  const workloadFonts = liveWorkloadFontFixtures(workload, fontFixture);
  const selectedFixtures: readonly {
    readonly id: BenchmarkFontFixture;
    readonly role: 'font' | 'icons' | 'labels';
  }[] =
    workloadFonts.kind === 'icon-grid'
      ? [
          { id: workloadFonts.primary, role: 'icons' },
          { id: workloadFonts.labels, role: 'labels' },
        ]
      : [{ id: workloadFonts.primary, role: 'font' }];
  const selectedMtsdfFixtures =
    technique === 'mtsdf'
      ? selectedFixtures.map(({ id, role }) => ({
          fixture: mtsdfFixtureFor(id),
          fontFixture: id,
          role,
        }))
      : [];
  const selectedSlugFixtures =
    technique === 'slug'
      ? selectedFixtures.map(({ id, role }) => ({
          fixture: slugFixtureFor(id),
          fontFixture: id,
          role,
        }))
      : [];
  const selectedBitmapFixtures =
    technique === 'bitmap'
      ? selectedFixtures.map(({ id, role }) => ({
          fixture: bitmapFixtureFor(id),
          fontFixture: id,
          role,
        }))
      : [];
  const mtsdfFixture = selectedMtsdfFixtures[0]?.fixture;
  const slugFixture = selectedSlugFixtures[0]?.fixture;
  const fontTransferBytes =
    technique === 'mtsdf'
      ? sumOptionalBytes(selectedMtsdfFixtures.map(({ fixture }) => fixture.compressed.bytes))
      : technique === 'slug'
        ? sumOptionalBytes(selectedSlugFixtures.map(({ fixture }) => fixture.compressed.bytes))
        : sumOptionalBytes(selectedBitmapFixtures.map(({ fixture }) => fixture.bytes));
  const textureGpuBytes =
    technique === 'mtsdf'
      ? (mtsdfStats?.atlasGpuBytes ??
        sumOptionalBytes(
          selectedMtsdfFixtures.map(({ fixture }) => fixture.raster.runtimeTextureArray.basePaddedGpuBytes),
        ))
      : technique === 'slug'
        ? (slugStats?.slugGpuBytes ??
          sumOptionalBytes(selectedSlugFixtures.map(({ fixture }) => fixture.raster.decodedGpuBytes)))
        : (bitmapStats?.atlasGpuBytes ??
          sumOptionalBytes(selectedBitmapFixtures.map(({ fixture }) => fixture.raster.decodedGpuBytes)));
  const bitmapPages =
    bitmapStats === undefined
      ? selectedBitmapFixtures.flatMap(({ fixture, fontFixture: pageFontFixture, role }) =>
          fixture.raster.pages.map((page) => ({
            key: `${pageFontFixture}-fixture-${page.index}`,
            label: `${BENCHMARK_FONT_LABELS[pageFontFixture]} ${role} · page ${page.index + 1} · ${page.width}×${page.height}`,
            embeddedBytes: page.encodedBytes,
            gpuBytes: page.decodedGpuBytes,
          })),
        )
      : bitmapStats.atlasPages.map((page) => ({
          key: `${page.strikePpem}-${page.pageIndex}`,
          label: `${page.strikePpem} px · page ${page.pageIndex + 1} · ${page.width}×${page.height}`,
          embeddedBytes: undefined,
          gpuBytes: page.gpuBytes,
        }));
  const pages =
    technique === 'mtsdf'
      ? selectedMtsdfFixtures.flatMap(({ fixture, fontFixture: pageFontFixture, role }) =>
          fixture.raster.pages.map((page) => ({
            key: `${pageFontFixture}-${String(page.index)}`,
            label: `${BENCHMARK_FONT_LABELS[pageFontFixture]} ${role} · page ${page.index + 1} · ${page.width}×${page.height}`,
            embeddedBytes: page.encodedBytes,
            gpuBytes: page.decodedGpuBytes,
          })),
        )
      : technique === 'slug'
        ? slugStats === undefined
          ? selectedSlugFixtures.flatMap(({ fixture, fontFixture: pageFontFixture, role }) =>
              fixture.raster.pages.map((page) => ({
                key: `${pageFontFixture}-slug-page-${page.index}`,
                label: `${BENCHMARK_FONT_LABELS[pageFontFixture]} ${role} · page ${page.index + 1} analytic resources · ${page.width}×${page.height}`,
                embeddedBytes: page.encodedBytes,
                gpuBytes: page.decodedGpuBytes,
              })),
            )
          : [
              {
                key: 'slug-curves',
                label: `RGBA16F curves · ${slugStats.slugCurveTexelCount} texels`,
                embeddedBytes: undefined,
                gpuBytes: slugStats.slugCurveGpuBytes,
              },
              {
                key: 'slug-headers',
                label: `R32UI headers · ${slugStats.slugHeaderCount} used`,
                embeddedBytes: undefined,
                gpuBytes: slugStats.slugHeaderGpuBytes,
              },
              {
                key: 'slug-references',
                label: `R16UI references · ${slugStats.slugReferenceCount} used`,
                embeddedBytes: undefined,
                gpuBytes: slugStats.slugReferenceGpuBytes,
              },
            ]
        : bitmapPages;
  const pageGpuBytes = pages.reduce((total, page) => total + page.gpuBytes, 0);
  const textureBaseBytes = technique === 'slug' ? undefined : textureGpuBytes;
  const texturePaddingBytes = textureBaseBytes === undefined ? undefined : Math.max(0, textureBaseBytes - pageGpuBytes);
  const displayedFontTransferBytes = delivery === 'runtime' ? liveStats?.sourceFontBytes : fontTransferBytes;

  return (
    <>
      <div className="rounded-md border border-border bg-surface p-3" data-testid="payload-inspector">
        <InspectorTableHeader label="Payload" valueLabel="Gzip" />
        <InspectorDisclosure
          className="mt-3 border-b border-border pb-3"
          label="Runtime"
          status={runtime === undefined ? 'unloaded' : 'loaded'}
          value={formatBytes(libraryTransferBytes)}
        >
          <PayloadRow
            label={`${formatLabel(technique)} runtime`}
            status={runtime === undefined ? 'unloaded' : 'loaded'}
            value={formatBytes(runtime?.gzipBytes)}
          />
          <PayloadRow label={shaper.label} status="loaded" value={formatBytes(shaper.gzipBytes)} />
          <p className="text-[9px] leading-relaxed text-dim">
            Includes the pmndrs/glyph core, selected raster runtime, and shaper. External Three.js and React peers are
            not included; font assets are listed below.
          </p>
        </InspectorDisclosure>
        <InspectorDisclosure
          className="pt-3"
          label="Bake (lazy)"
          status={delivery === 'runtime' ? 'loaded' : 'unloaded'}
          value={formatBytes(bakerTransferBytes)}
        >
          <PayloadRow
            label="Runtime baker host"
            status={delivery === 'runtime' ? 'loaded' : 'unloaded'}
            value={formatBytes(runtimeBakerHost.gzipBytes)}
          />
          <PayloadRow
            label="Runtime baker worker"
            status={delivery === 'runtime' ? 'loaded' : 'unloaded'}
            value={formatBytes(runtimeBakerWorker.gzipBytes)}
          />
          <PayloadRow
            label="Core baker host"
            status={delivery === 'runtime' ? 'loaded' : 'unloaded'}
            value={formatBytes(coreBakerHost.gzipBytes)}
          />
          <PayloadRow
            label="Core baker Wasm"
            status={delivery === 'runtime' ? 'loaded' : 'unloaded'}
            value={formatBytes(coreBakerWasm.gzipBytes)}
          />
          <PayloadRow
            label={`${formatLabel(technique)} baker host`}
            status={delivery === 'runtime' && bakerHost !== undefined ? 'loaded' : 'unloaded'}
            value={formatBytes(bakerHost?.gzipBytes)}
          />
          <PayloadRow
            label={`${formatLabel(technique)} baker Wasm`}
            status={delivery === 'runtime' && bakerWasm !== undefined ? 'loaded' : 'unloaded'}
            value={formatBytes(bakerWasm?.gzipBytes)}
          />
        </InspectorDisclosure>
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <InspectorTableHeader
          label="Asset"
          valueLabel={delivery === 'baked' && technique !== 'bitmap' ? 'Gzip' : 'Bytes'}
        />
        <div className="mt-3 pl-6">
          <PayloadRow
            label={delivery === 'runtime' ? 'Source font' : 'Font assets'}
            status={displayedFontTransferBytes === undefined ? 'unloaded' : 'loaded'}
            value={formatBytes(displayedFontTransferBytes)}
          />
        </div>
      </div>
      <div className="rounded-md border border-border bg-surface p-3" data-testid="gpu-resource-inspector">
        <InspectorTableHeader label="Resource" valueLabel="GPU" />
        <InspectorDisclosure
          className="mt-3"
          label={technique === 'slug' ? 'Analytic textures' : 'Atlas textures'}
          status={textureGpuBytes === undefined ? 'unloaded' : 'loaded'}
          value={formatBytes(textureGpuBytes)}
        >
          {technique === 'mtsdf' && (
            <p className="text-[9px] leading-relaxed text-dim">
              MSDF · {mtsdfFixture?.configuration.emSize ?? 64} px/em · {mtsdfFixture?.configuration.pixelRange ?? 8} px
              range
            </p>
          )}
          {technique === 'slug' && (
            <p className="text-[9px] leading-relaxed text-dim">
              Slug · exact RGBA16F curves, R32UI band headers, and R16UI references ·{' '}
              {slugStats?.slugPageCount ?? slugFixture?.raster.pages.length ?? '—'} page
              {(slugStats?.slugPageCount ?? slugFixture?.raster.pages.length) === 1 ? '' : 's'}
            </p>
          )}
          {pages.length === 0 ? (
            <p className="text-[9px] text-dim">Page dimensions appear after the font loads.</p>
          ) : (
            pages.map((page) => (
              <PayloadRow key={page.key} label={page.label} status="loaded" value={formatBytes(page.gpuBytes)} />
            ))
          )}
          {texturePaddingBytes !== undefined && texturePaddingBytes > 0 && (
            <PayloadRow label="Layer padding" status="loaded" value={formatBytes(texturePaddingBytes)} />
          )}
        </InspectorDisclosure>
      </div>
    </>
  );
}

function sumOptionalBytes(values: readonly (number | undefined)[]): number | undefined {
  if (values.length === 0) return undefined;
  let total = 0;
  for (const value of values) {
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

function PayloadRow({
  emphasis = false,
  label,
  status,
  value,
}: {
  readonly emphasis?: boolean;
  readonly label: string;
  readonly status?: 'loaded' | 'unloaded';
  readonly value: string;
}) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_2.5rem_3.5rem] items-center gap-x-2 text-[10px] ${emphasis ? 'font-medium' : ''}`}
    >
      <span className={emphasis ? 'text-foreground' : 'text-muted'}>{label}</span>
      {status === undefined ? <span aria-hidden="true" /> : <PayloadStatus status={status} />}
      <span className="whitespace-nowrap text-right font-mono tabular-nums text-dim">{value}</span>
    </div>
  );
}

function PayloadStatus({ status }: { readonly status: 'loaded' | 'unloaded' }) {
  return (
    <span
      aria-label={status}
      className={`grid size-4 place-items-center justify-self-center ${status === 'loaded' ? 'text-success' : 'text-dim'}`}
      title={status}
    >
      <svg aria-hidden="true" className="size-3" viewBox="0 0 12 12">
        {status === 'loaded' ? (
          <path
            d="m2 6 2.5 2.5L10 3"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        ) : (
          <path d="m3 3 6 6m0-6L3 9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
        )}
      </svg>
    </span>
  );
}

function InspectorTableHeader({ label, valueLabel }: { label: string; valueLabel: string }) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_2.5rem_3.5rem] items-center gap-x-2">
      <span aria-hidden="true" />
      <p className="eyebrow">{label}</p>
      <span className="text-center font-mono text-[8px] uppercase text-dim">Loaded</span>
      <span className="text-right font-mono text-[8px] uppercase text-dim">{valueLabel}</span>
    </div>
  );
}

function InspectorDisclosure({
  children,
  className,
  label,
  status,
  value,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly label: string;
  readonly status: 'loaded' | 'unloaded';
  readonly value: string;
}) {
  return (
    <details className={`group ${className ?? ''}`}>
      <summary className="grid cursor-pointer list-none grid-cols-[1rem_minmax(0,1fr)_2.5rem_3.5rem] items-center gap-x-2 text-[10px] font-medium [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          className="size-4 shrink-0 origin-center text-dim transition-transform duration-150 group-open:rotate-90"
          viewBox="0 0 16 16"
        >
          <path
            d="m6 3 5 5-5 5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
        </svg>
        <span className="text-foreground">{label}</span>
        <PayloadStatus status={status} />
        <span className="whitespace-nowrap text-right font-mono tabular-nums text-dim">{value}</span>
      </summary>
      <div className="mt-3 grid gap-2 pl-6">{children}</div>
    </details>
  );
}

interface MeasuredPackageSize {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly gzipBytes: number;
}

function measuredPackageSize(id: string): MeasuredPackageSize {
  const entry = measuredPackageSizeIfAvailable(id);
  if (entry === undefined) throw new Error(`Missing measured package size: ${id}`);
  return entry;
}

function measuredPackageSizeIfAvailable(id: string): MeasuredPackageSize | undefined {
  const entry = packageSizes.entries.find((candidate) => candidate.id === id);
  return entry?.status === 'measured' ? entry : undefined;
}
