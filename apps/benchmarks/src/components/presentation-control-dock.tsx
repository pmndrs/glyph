import type { ReactNode } from 'react';
import {
  AlignHorizontalDistributeCenter,
  BoxSelect,
  CircleGauge,
  Droplets,
  Gauge,
  ListFilter,
  MoveHorizontal,
  Paintbrush,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  TextCursorInput,
  Type,
} from 'lucide-react';

import {
  ADVANCED_SHAPING_CASES,
  type AdvancedShapingCommand,
  type AdvancedShapingFrame,
  type AdvancedShapingState,
} from '../workloads/advanced-shaping/scene';
/*
 * The dock intentionally consumes the same typed control state as the main panel.
 * shadcn/Base UI owns interaction semantics; this component only maps state to a compact presentation.
 */
import type { GraphicsBackend, RasterTechnique } from '../benchmark/url-state';
import { logarithmicRangePosition, logarithmicRangeValue } from './range-values';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

export interface PresentationControlDockProps {
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly backend: GraphicsBackend;
  readonly dpr: 1 | 2;
  readonly fontSize: number;
  readonly layoutWidthPercent: number;
  readonly paintOpacityPercent: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokePercent: number;
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly showcaseState: AdvancedShapingState;
  readonly showLayoutBounds: boolean;
  readonly technique: RasterTechnique;
  readonly webgpu: boolean;
  readonly workload: string;
  readonly workloadAmount: number;
  readonly onAnimationEnabled: (value: boolean) => void;
  readonly onAnimationSpeed: (value: number) => void;
  readonly onBackend: (value: GraphicsBackend) => void;
  readonly onDpr: (value: 1 | 2) => void;
  readonly onFontSize: (value: number) => void;
  readonly onLayoutWidthPercent: (value: number) => void;
  readonly onPaintOpacityPercent: (value: number) => void;
  readonly onPaintShadowEnabled: (value: boolean) => void;
  readonly onPaintStrokePercent: (value: number) => void;
  readonly onShowcase: (command: AdvancedShapingCommand) => void;
  readonly onShowLayoutBounds: (value: boolean) => void;
  readonly onWorkloadAmount: (value: number) => void;
}

export function PresentationControlDock(props: PresentationControlDockProps) {
  return (
    <ButtonGroup
      aria-label="Render controls"
      className="max-h-full overflow-y-auto overscroll-contain rounded-md border border-border bg-black/80 shadow-2xl [&>[data-slot=button]:not(:last-child)]:border-b [&>[data-slot=button]]:rounded-none [&>[data-slot=button]]:border-0 [&>[data-slot=button]]:border-border [&>[data-slot=button]]:bg-transparent"
      orientation="vertical"
    >
      <BackendControl backend={props.backend} webgpu={props.webgpu} onChange={props.onBackend} />
      <DprControl dpr={props.dpr} onChange={props.onDpr} />
      <WorkloadControls {...props} />
    </ButtonGroup>
  );
}

function WorkloadControls(props: PresentationControlDockProps) {
  const controls: ReactNode[] = [];
  if (props.workload !== 'text-ladder' && props.workload !== 'zoom-text') {
    controls.push(
      <RangeControl
        icon={<Type />}
        key="font-size"
        label={props.workload === 'icon-grid' ? 'Icon size' : 'Rendered size'}
        logarithmic={props.workload === 'icon-grid'}
        max={props.workload === 'icon-grid' ? 1024 : 96}
        min={8}
        step={1}
        suffix="px"
        value={props.fontSize}
        onChange={props.onFontSize}
      />,
    );
  }
  if (workloadHasLayoutWidth(props.workload)) {
    controls.push(
      <RangeControl
        icon={<MoveHorizontal />}
        key="layout-width"
        label="Layout width"
        max={props.workload === 'off-axis-3d' ? 200 : 100}
        min={40}
        step={2}
        suffix="%"
        value={props.layoutWidthPercent}
        onChange={props.onLayoutWidthPercent}
      />,
    );
  }
  const amountLabel = workloadAmountLabel(props.workload);
  if (amountLabel !== undefined) {
    controls.push(
      <RangeControl
        icon={workloadAmountIcon(props.workload)}
        key="workload-amount"
        label={amountLabel}
        max={100}
        min={0}
        step={1}
        suffix="%"
        value={props.workloadAmount}
        onChange={props.onWorkloadAmount}
        {...(props.workload === 'paint-effects' ? { className: 'presentation-hue-slider' } : {})}
      />,
    );
  }
  if (workloadHasAnimation(props.workload)) {
    controls.push(
      <AnimationControl
        enabled={props.animationEnabled}
        key="animation"
        speed={props.animationSpeed}
        onEnabled={props.onAnimationEnabled}
        onSpeed={props.onAnimationSpeed}
      />,
    );
  }
  if (props.workload === 'dynamic-layout') {
    controls.push(
      <ToggleControl
        checked={props.showLayoutBounds}
        icon={<BoxSelect />}
        key="layout-bounds"
        label="Layout bounds"
        onChange={props.onShowLayoutBounds}
      />,
    );
  }
  if (props.workload === 'paint-effects' || props.workload === 'rich-text') {
    controls.push(
      <RangeControl
        icon={<Droplets />}
        key="opacity"
        label="Opacity"
        max={100}
        min={0}
        step={1}
        suffix="%"
        value={props.paintOpacityPercent}
        onChange={props.onPaintOpacityPercent}
      />,
    );
    if (props.technique === 'mtsdf') {
      controls.push(
        <RangeControl
          icon={<Paintbrush />}
          key="stroke"
          label="Stroke width"
          max={100}
          min={0}
          step={1}
          suffix="%"
          value={props.paintStrokePercent}
          onChange={props.onPaintStrokePercent}
        />,
        <ToggleControl
          checked={props.paintShadowEnabled}
          icon={<Sparkles />}
          key="shadow"
          label="Shadow"
          onChange={props.onPaintShadowEnabled}
        />,
      );
    }
  }
  if (props.workload === 'advanced-shaping') {
    controls.push(
      <AdvancedCaseControl
        frame={props.showcaseFrame}
        key="advanced-case"
        state={props.showcaseState}
        onShowcase={props.onShowcase}
      />,
      <AdvancedTextControl frame={props.showcaseFrame} key="advanced-text" onShowcase={props.onShowcase} />,
      <AdvancedTimelineControl
        frame={props.showcaseFrame}
        key="advanced-timeline"
        state={props.showcaseState}
        onShowcase={props.onShowcase}
      />,
    );
  }
  return controls;
}

function BackendControl({
  backend,
  webgpu,
  onChange,
}: {
  readonly backend: GraphicsBackend;
  readonly webgpu: boolean;
  readonly onChange: (value: GraphicsBackend) => void;
}) {
  return (
    <DockPopover label="Graphics backend" value={backend === 'webgpu' ? 'GPU' : 'GL'}>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          disabled={!webgpu}
          variant={backend === 'webgpu' ? 'default' : 'outline'}
          onClick={() => onChange('webgpu')}
        >
          GPU
        </Button>
        <Button variant={backend === 'webgl2' ? 'default' : 'outline'} onClick={() => onChange('webgl2')}>
          GL
        </Button>
      </div>
    </DockPopover>
  );
}

function DprControl({ dpr, onChange }: { readonly dpr: 1 | 2; readonly onChange: (value: 1 | 2) => void }) {
  return (
    <DockPopover label="Device pixel ratio" value={`${dpr}×`}>
      <div className="grid grid-cols-2 gap-1.5">
        {([1, 2] as const).map((value) => (
          <Button key={value} variant={dpr === value ? 'default' : 'outline'} onClick={() => onChange(value)}>
            {value}×
          </Button>
        ))}
      </div>
    </DockPopover>
  );
}

function RangeControl({
  className,
  icon,
  label,
  logarithmic = false,
  max,
  min,
  step,
  suffix,
  value,
  onChange,
}: {
  readonly className?: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly logarithmic?: boolean;
  readonly max: number;
  readonly min: number;
  readonly step: number;
  readonly suffix: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const sliderValue = logarithmic ? logarithmicRangePosition(value, min, max) : value;
  return (
    <DockPopover icon={icon} label={label} value={`${value}${suffix}`}>
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ${className ?? ''}`}>
        <Slider
          aria-label={label}
          max={logarithmic ? 1 : max}
          min={logarithmic ? 0 : min}
          step={logarithmic ? 0.001 : step}
          value={[sliderValue]}
          onValueChange={(next) => {
            const nextValue = sliderValueOf(next);
            onChange(logarithmic ? logarithmicRangeValue(nextValue, min, max, step) : nextValue);
          }}
        />
        <output className="min-w-14 text-right font-mono text-xs tabular-nums text-foreground">
          {value} {suffix}
        </output>
      </div>
    </DockPopover>
  );
}

function AnimationControl({
  enabled,
  speed,
  onEnabled,
  onSpeed,
}: {
  readonly enabled: boolean;
  readonly speed: number;
  readonly onEnabled: (value: boolean) => void;
  readonly onSpeed: (value: number) => void;
}) {
  return (
    <DockPopover icon={enabled ? <Pause /> : <Play />} label="Animation" value={enabled ? 'ON' : 'OFF'}>
      <ToggleRow checked={enabled} label="Animate" onChange={onEnabled} />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <Slider
          aria-label="Animation speed"
          max={100}
          min={0}
          step={1}
          value={[speed]}
          onValueChange={(next) => onSpeed(sliderValueOf(next))}
        />
        <output className="min-w-10 text-right font-mono text-xs tabular-nums text-foreground">{speed}%</output>
      </div>
    </DockPopover>
  );
}

function ToggleControl({
  checked,
  icon,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <DockPopover icon={icon} label={label} value={checked ? 'ON' : 'OFF'}>
      <ToggleRow checked={checked} label={label} onChange={onChange} />
    </DockPopover>
  );
}

function ToggleRow({
  checked,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 text-xs text-foreground">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function AdvancedCaseControl({
  frame,
  state,
  onShowcase,
}: {
  readonly frame: AdvancedShapingFrame;
  readonly state: AdvancedShapingState;
  readonly onShowcase: (command: AdvancedShapingCommand) => void;
}) {
  return (
    <DockPopover icon={<ListFilter />} label="Shaping case" value={frame.caseDefinition.language.toUpperCase()}>
      <Select
        value={state.caseId}
        onValueChange={(caseId) => {
          const definition = ADVANCED_SHAPING_CASES.find((candidate) => candidate.id === caseId);
          if (definition !== undefined) onShowcase({ kind: 'select-case', caseId: definition.id });
        }}
      >
        <SelectTrigger aria-label="Shaping case" className="w-full border-border bg-background">
          <span className="truncate">{frame.caseDefinition.label}</span>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className="border border-border bg-black/95 ring-0">
          {ADVANCED_SHAPING_CASES.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center justify-between gap-4 text-xs text-foreground">
        Auto case cycle
        <Switch
          aria-label="Auto case cycle"
          checked={state.auto}
          onCheckedChange={(enabled) => onShowcase({ kind: 'set-auto', enabled })}
        />
      </div>
      <div className="grid gap-2">
        <span className="text-[10px] uppercase tracking-[0.08em] text-dim">
          Reveal speed · {state.revealUnitsPerSecond.toFixed(0)}/s
        </span>
        <Slider
          aria-label="Advanced shaping reveal speed"
          max={240}
          min={10}
          step={1}
          value={[state.revealUnitsPerSecond]}
          onValueChange={(next) => onShowcase({ kind: 'set-speed', revealUnitsPerSecond: sliderValueOf(next) })}
        />
      </div>
    </DockPopover>
  );
}

function AdvancedTextControl({
  frame,
  onShowcase,
}: {
  readonly frame: AdvancedShapingFrame;
  readonly onShowcase: (command: AdvancedShapingCommand) => void;
}) {
  return (
    <DockPopover icon={<TextCursorInput />} label="Live text" value={`${frame.text.length}`}>
      <Textarea
        aria-label="Live text"
        className="min-h-24 border-border bg-background text-xs"
        value={frame.text}
        onChange={(event) => onShowcase({ kind: 'edit', text: event.currentTarget.value })}
      />
    </DockPopover>
  );
}

function AdvancedTimelineControl({
  frame,
  state,
  onShowcase,
}: {
  readonly frame: AdvancedShapingFrame;
  readonly state: AdvancedShapingState;
  readonly onShowcase: (command: AdvancedShapingCommand) => void;
}) {
  return (
    <DockPopover icon={state.playing ? <Pause /> : <Play />} label="Shaping timeline" value={`${frame.tick}`}>
      <div className="grid grid-cols-2 gap-1.5">
        <Button onClick={() => onShowcase({ kind: state.playing ? 'pause' : 'play' })}>
          {state.playing ? <Pause /> : <Play />}
          {state.playing ? 'Pause' : 'Play'}
        </Button>
        <Button variant="outline" onClick={() => onShowcase({ kind: 'reset' })}>
          <RotateCcw />
          Reset
        </Button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <Slider
          aria-label="Shaping timeline"
          max={frame.tickCount}
          min={0}
          step={1}
          value={[frame.tick]}
          onValueChange={(next) => onShowcase({ kind: 'seek', tick: sliderValueOf(next) })}
        />
        <output className="font-mono text-xs tabular-nums text-foreground">
          {frame.tick}/{frame.tickCount}
        </output>
      </div>
    </DockPopover>
  );
}

function DockPopover({
  children,
  icon,
  label,
  value,
}: {
  readonly children: ReactNode;
  readonly icon?: ReactNode;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={`${label}: ${value}`}
            className="flex h-12 w-12 flex-col gap-0.5 px-1 text-muted hover:bg-surface-active hover:text-foreground aria-expanded:bg-surface-active aria-expanded:text-foreground aria-expanded:ring-1 aria-expanded:ring-inset aria-expanded:ring-accent [&_svg]:size-4"
            size="icon-lg"
            variant="ghost"
          />
        }
      >
        {icon}
        <span
          className={
            icon === undefined
              ? 'font-mono text-sm leading-none tabular-nums'
              : 'font-mono text-[9px] leading-none tabular-nums'
          }
        >
          {value}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-72 gap-3 rounded-md border border-border bg-black/80 p-3 text-foreground ring-0 backdrop-blur-none"
        side="right"
        sideOffset={8}
      >
        <PopoverHeader>
          <PopoverTitle className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">{label}</PopoverTitle>
        </PopoverHeader>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function workloadHasLayoutWidth(workload: string): boolean {
  return (
    workload === 'benchmark-ipsum' ||
    workload === 'dynamic-layout' ||
    workload === 'off-axis-3d' ||
    workload === 'paint-effects' ||
    workload === 'paragraph-stress' ||
    workload === 'rich-text'
  );
}

function sliderValueOf(value: number | readonly number[]): number {
  return typeof value === 'number' ? value : (value[0] ?? 0);
}

function workloadHasAnimation(workload: string): boolean {
  return (
    workload === 'off-axis-3d' ||
    workload === 'icon-grid' ||
    workload === 'paint-effects' ||
    workload === 'zoom-text' ||
    workload === 'text-ladder' ||
    workload === 'dynamic-layout' ||
    workload === 'paragraph-stress' ||
    workload === 'rich-text'
  );
}

function workloadAmountLabel(workload: string): string | undefined {
  switch (workload) {
    case 'off-axis-3d':
      return 'Perspective intensity';
    case 'dynamic-layout':
      return 'Reflow amplitude';
    case 'paragraph-stress':
      return 'Text volume';
    case 'paint-effects':
      return 'Hue spread';
    case 'rich-text':
      return 'Span density';
    default:
      return undefined;
  }
}

function workloadAmountIcon(workload: string): ReactNode {
  switch (workload) {
    case 'off-axis-3d':
      return <CircleGauge />;
    case 'dynamic-layout':
      return <AlignHorizontalDistributeCenter />;
    case 'paint-effects':
      return <Paintbrush />;
    default:
      return <Gauge />;
  }
}
