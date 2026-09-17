import {
  ADVANCED_SHAPING_CASES,
  type AdvancedShapingCommand,
  type AdvancedShapingFrame,
  type AdvancedShapingState,
} from '../workloads/advanced-shaping/scene';
import type { RasterFormatName } from '../benchmark/url-state';
import { Button, Field, SelectField, TextareaField, Toggle } from './ui';

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

export function LiveWorkloadControls({
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
      {(workload === 'editorial' ||
        workload === 'off-axis-3d' ||
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

export function AdvancedShapingControls({
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
