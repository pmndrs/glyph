import {
  type AdvancedShapingCommand,
  type AdvancedShapingFrame,
  type AdvancedShapingState,
} from '../workloads/advanced-shaping/scene';
import {
  BENCHMARK_FONT_LABELS,
  ICON_GRID_FONT_FIXTURE,
  SELECTABLE_FONT_FIXTURES,
  selectableFontFixture,
  type BenchmarkFontFixture,
  type SelectableFontFixture,
} from '../benchmark/font-fixtures';
import type { FontDelivery, GraphicsBackend, RasterFormatName } from '../benchmark/url-state';
import type { BitmapTextLiveStats } from '../techniques/bitmap/persistent-scene';
import type { MtsdfTextLiveStats } from '../techniques/mtsdf/persistent-scene';
import type { SlugTextLiveStats } from '../techniques/slug/persistent-scene';
import { FontFixtureButtons } from './font-fixture-buttons';
import { PayloadInspector } from './payload-inspector';
import { AdvancedShapingControls, LiveWorkloadControls } from './workload-controls';
import { Button } from './ui';
import { PresentationControlDock } from './presentation-control-dock';

type LiveTextStats = BitmapTextLiveStats | MtsdfTextLiveStats | SlugTextLiveStats;

export interface ConformanceView {
  readonly zoom: number;
  readonly panXPercent: number;
  readonly panYPercent: number;
}

export interface ControlsProps {
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
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
  readonly technique: RasterFormatName;
  readonly workload: string;
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly showcaseState: AdvancedShapingState;
  readonly showGrid: boolean;
  readonly showLayoutBounds: boolean;
  readonly webgpu: boolean;
  readonly onBackend: (backend: GraphicsBackend) => void;
  readonly onDelivery: (delivery: FontDelivery) => void;
  readonly onAnimationEnabled: (value: boolean) => void;
  readonly onAnimationSpeed: (value: number) => void;
  readonly onDpr: (dpr: 1 | 2) => void;
  readonly onFontSize: (value: number) => void;
  readonly onFontNotices: () => void;
  readonly onLayoutWidthPercent: (value: number) => void;
  readonly onPaintOpacityPercent: (value: number) => void;
  readonly onPaintShadowEnabled: (value: boolean) => void;
  readonly onPaintStrokePercent: (value: number) => void;
  readonly onSelectedFontFixture: (value: SelectableFontFixture) => void;
  readonly onWorkloadAmount: (value: number) => void;
  readonly onShowcase: (command: AdvancedShapingCommand) => void;
  readonly onShowGrid: (value: boolean) => void;
  readonly onShowLayoutBounds: (value: boolean) => void;
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
      {props.workload === 'advanced-shaping' && (
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
