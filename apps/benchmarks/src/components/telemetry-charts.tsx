import { useEffect, useEffectEvent, useRef, type RefObject } from 'react';

import type { BitmapTextLiveStats } from '../renderer/bitmap-text';
import type { MtsdfTextLiveStats } from '../renderer/mtsdf-text';
import type { SlugTextLiveStats } from '../renderer/slug-text';
import {
  formatSparklineValue,
  sparklineCanvasMetrics,
  sparklinePresentationTimestamp,
  sparklineSampleY,
  sparklineTimestampX,
} from './sparkline';

export type TelemetryChartStats = BitmapTextLiveStats | MtsdfTextLiveStats | SlugTextLiveStats;

export interface TelemetryChartsProps {
  readonly presentation?: 'main' | 'presentation';
  readonly stats: TelemetryChartStats | undefined;
}

const TELEMETRY_CHART_WINDOW_MS = 8_000;
const TELEMETRY_PRESENTATION_DELAY_MS = 250;

export function TelemetryCharts({ presentation = 'main', stats }: TelemetryChartsProps) {
  const fpsCanvasRef = useRef<HTMLCanvasElement>(null);
  const cpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const historySegments = useRef<TelemetryChartStats[]>([]);
  const readStats = useEffectEvent(() => stats);
  useEffect(() => {
    const charts = [
      { id: 'fps', canvas: fpsCanvasRef.current, tone: 'success' },
      { id: 'cpu', canvas: cpuCanvasRef.current, tone: 'cyan' },
      { id: 'gpu', canvas: gpuCanvasRef.current, tone: 'warning' },
    ] as const;
    if (charts.some(({ canvas }) => canvas === null)) return;
    const drawing = charts.map(({ canvas, id, tone }) => {
      if (canvas === null) throw new TypeError(`missing ${id} telemetry canvas`);
      const context = canvas.getContext('2d');
      if (context === null) throw new TypeError(`missing ${id} telemetry context`);
      return { canvas, context, height: 1, id, pixelRatio: 0, tone, width: 1 };
    });
    const resize = (chart: (typeof drawing)[number]): void => {
      const { canvas, context, tone } = chart;
      const bounds = canvas.getBoundingClientRect();
      const metrics = sparklineCanvasMetrics(bounds.width, bounds.height, window.devicePixelRatio);
      chart.width = metrics.cssWidth;
      chart.height = metrics.cssHeight;
      chart.pixelRatio = metrics.pixelRatio;
      if (canvas.width !== metrics.backingWidth || canvas.height !== metrics.backingHeight) {
        canvas.width = metrics.backingWidth;
        canvas.height = metrics.backingHeight;
      }
      context.setTransform(metrics.scaleX, 0, 0, metrics.scaleY, 0, 0);
      context.strokeStyle = getComputedStyle(canvas).getPropertyValue(`--${tone}`);
      context.lineWidth = 1.5;
      canvas.dataset.backingHeight = String(metrics.backingHeight);
      canvas.dataset.backingWidth = String(metrics.backingWidth);
      canvas.dataset.cssHeight = String(metrics.cssHeight);
      canvas.dataset.cssWidth = String(metrics.cssWidth);
      canvas.dataset.pixelRatio = String(metrics.pixelRatio);
    };
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const chart = drawing.find(({ canvas }) => canvas === entry.target);
        if (chart !== undefined) resize(chart);
      }
    });
    for (const chart of drawing) {
      resizeObserver.observe(chart.canvas);
      resize(chart);
    }
    let animationFrame = 0;
    const draw = (timestamp: number): void => {
      for (const chart of drawing) {
        if (chart.pixelRatio !== Math.max(1, window.devicePixelRatio)) resize(chart);
      }
      const current = readStats();
      const presentationTimestamp = sparklinePresentationTimestamp(timestamp, TELEMETRY_PRESENTATION_DELAY_MS);
      if (current !== undefined) retainTelemetrySegment(historySegments.current, current, presentationTimestamp);
      if (historySegments.current.length > 0) {
        for (const chart of drawing) {
          drawTelemetryChart(chart, historySegments.current, presentationTimestamp);
        }
      } else {
        for (const { context, width, height } of drawing) context.clearRect(0, 0, width, height);
      }
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, []);
  return (
    <>
      <TelemetryChartPanel
        canvasRef={fpsCanvasRef}
        current={latestHistoryValue(stats?.fpsHistory, stats?.fpsHistoryCursor)}
        id="fps"
        label="FPS"
        maximum={stats?.maximumFramesPerSecond}
        minimum={stats?.minimumFramesPerSecond}
        scaleMaximum={stats?.refreshRateHz}
        tone="success"
        unit="fps"
        presentation={presentation}
      />
      <TelemetryChartPanel
        canvasRef={cpuCanvasRef}
        current={latestHistoryValue(stats?.submitHistory, stats?.submitHistoryCursor)}
        id="cpu"
        label="CPU"
        maximum={stats?.maximumSubmitMs}
        minimum={stats?.minimumSubmitMs}
        scaleMaximum={stats?.frameBudgetMs}
        tone="cyan"
        unit="ms"
        presentation={presentation}
      />
      <TelemetryChartPanel
        canvasRef={gpuCanvasRef}
        current={stats?.gpuFrameMs}
        emptyLabel={stats?.gpuTimingSupported === true ? 'Resolving GPU timing' : 'GPU timing unavailable'}
        id="gpu"
        label="GPU"
        maximum={stats?.maximumGpuMs}
        minimum={stats?.minimumGpuMs}
        scaleMaximum={stats?.frameBudgetMs}
        tone="warning"
        unit="ms"
        presentation={presentation}
      />
    </>
  );
}

function TelemetryChartPanel({
  canvasRef,
  current,
  emptyLabel,
  id,
  label,
  maximum,
  minimum,
  scaleMaximum,
  tone,
  unit,
  presentation,
}: {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly current: number | undefined;
  readonly emptyLabel?: string;
  readonly id: 'cpu' | 'fps' | 'gpu';
  readonly label: string;
  readonly maximum: number | undefined;
  readonly minimum: number | undefined;
  readonly scaleMaximum: number | undefined;
  readonly tone: 'cyan' | 'success' | 'warning';
  readonly unit: 'fps' | 'ms';
  readonly presentation: 'main' | 'presentation';
}) {
  return (
    <div
      className={`flex min-h-0 flex-col p-2 ${presentation === 'presentation' ? 'bg-transparent' : 'bg-surface'}`}
      data-scale-maximum={scaleMaximum}
      data-testid={`sparkline-${id}`}
      data-tone={tone}
    >
      <div
        className={`flex items-baseline justify-between gap-2 font-mono text-[8px] uppercase tracking-wider ${sparklineToneClass(tone)}`}
      >
        <div className="flex items-baseline gap-2 font-mono">
          <p className="font-mono">{label}</p>
          <p className="font-mono tabular-nums">{formatSparklineValue(current, unit)}</p>
        </div>
        <p className="text-right font-mono tabular-nums">
          {formatSparklineValue(minimum, unit)} – {formatSparklineValue(maximum, unit)}
        </p>
      </div>
      <div className="relative mt-1 min-h-4 w-full flex-1">
        <canvas aria-label={`${label} history`} className="absolute inset-0 size-full" ref={canvasRef} />
        {current === undefined && emptyLabel !== undefined && (
          <span className="absolute inset-0 grid place-items-center font-mono text-[8px] text-dim">{emptyLabel}</span>
        )}
      </div>
    </div>
  );
}

function appendTelemetrySeries(
  chart: {
    readonly context: CanvasRenderingContext2D;
    readonly height: number;
    readonly width: number;
  },
  timestamps: Float64Array,
  values: Float32Array,
  length: number,
  nextIndex: number,
  maximum: number,
  nowMs: number,
  windowMs: number,
): void {
  const { context, height, width } = chart;
  const start = length === values.length ? nextIndex : 0;
  let drawing = false;
  for (let index = 0; index < length; index += 1) {
    const value = values[(start + index) % values.length] ?? Number.NaN;
    const timestamp = timestamps[(start + index) % timestamps.length] ?? Number.NaN;
    if (!Number.isFinite(value) || !Number.isFinite(timestamp)) continue;
    const x = sparklineTimestampX(timestamp, nowMs, windowMs, width);
    if (!Number.isFinite(x) || x < 0 || x > width) continue;
    const y = sparklineSampleY(value, maximum, height);
    if (!drawing) context.moveTo(x, y);
    else context.lineTo(x, y);
    drawing = true;
  }
}

function drawTelemetryChart(
  chart: {
    readonly context: CanvasRenderingContext2D;
    readonly height: number;
    readonly id: 'cpu' | 'fps' | 'gpu';
    readonly width: number;
  },
  segments: readonly TelemetryChartStats[],
  presentationTimestamp: number,
): void {
  chart.context.clearRect(0, 0, chart.width, chart.height);
  chart.context.beginPath();
  for (const stats of segments) {
    switch (chart.id) {
      case 'fps':
        appendTelemetrySeries(
          chart,
          stats.frameTimestampHistory,
          stats.fpsHistory,
          stats.fpsHistoryLength,
          stats.fpsHistoryCursor.nextIndex,
          stats.refreshRateHz,
          presentationTimestamp,
          TELEMETRY_CHART_WINDOW_MS,
        );
        break;
      case 'cpu':
        appendTelemetrySeries(
          chart,
          stats.frameTimestampHistory,
          stats.submitHistory,
          stats.submitHistoryLength,
          stats.submitHistoryCursor.nextIndex,
          stats.frameBudgetMs,
          presentationTimestamp,
          TELEMETRY_CHART_WINDOW_MS,
        );
        break;
      case 'gpu':
        appendTelemetrySeries(
          chart,
          stats.frameTimestampHistory,
          stats.gpuHistory,
          stats.gpuHistoryLength,
          stats.gpuHistoryCursor.nextIndex,
          stats.frameBudgetMs,
          presentationTimestamp,
          TELEMETRY_CHART_WINDOW_MS,
        );
        break;
    }
  }
  chart.context.stroke();
}

function retainTelemetrySegment(
  segments: TelemetryChartStats[],
  stats: TelemetryChartStats,
  presentationTimestamp: number,
): void {
  const currentIndex = segments.findIndex(
    ({ frameTimestampHistory }) => frameTimestampHistory === stats.frameTimestampHistory,
  );
  if (currentIndex === -1) segments.push(stats);
  else segments[currentIndex] = stats;

  const oldestVisibleTimestamp = presentationTimestamp - TELEMETRY_CHART_WINDOW_MS;
  while (segments.length > 1 && latestHistoryTimestamp(segments[0]!) < oldestVisibleTimestamp) segments.shift();
}

function latestHistoryTimestamp(stats: TelemetryChartStats): number {
  const { frameTimestampHistory, fpsHistoryCursor } = stats;
  if (fpsHistoryCursor.length === 0) return Number.NEGATIVE_INFINITY;
  return frameTimestampHistory[
    (fpsHistoryCursor.nextIndex + frameTimestampHistory.length - 1) % frameTimestampHistory.length
  ]!;
}

function latestHistoryValue(
  values: Float32Array | undefined,
  cursor: { readonly length: number; readonly nextIndex: number } | undefined,
): number | undefined {
  if (values === undefined || cursor === undefined || cursor.length === 0) return undefined;
  const value = values[(cursor.nextIndex + values.length - 1) % values.length];
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function sparklineToneClass(tone: 'cyan' | 'success' | 'warning'): string {
  switch (tone) {
    case 'cyan':
      return 'text-cyan';
    case 'success':
      return 'text-success';
    case 'warning':
      return 'text-warning';
  }
}
