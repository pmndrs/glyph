import { useEffect, useEffectEvent, useRef, type RefObject } from 'react';

import type { BitmapTextLiveStats } from '../renderer/bitmap-text';
import type { MtsdfTextLiveStats } from '../renderer/mtsdf-text';
import type { SlugTextLiveStats } from '../renderer/slug-text';
import {
  sparklineAnimatedSampleX,
  sparklineCanvasMetrics,
  sparklineMotionProgress,
  sparklineSampleY,
} from './sparkline';

export type TelemetryChartStats = BitmapTextLiveStats | MtsdfTextLiveStats | SlugTextLiveStats;

export interface TelemetryChartsProps {
  readonly stats: TelemetryChartStats | undefined;
}

const TELEMETRY_CHART_TRANSITION_MS = 250;

export function TelemetryCharts({ stats }: TelemetryChartsProps) {
  const fpsCanvasRef = useRef<HTMLCanvasElement>(null);
  const cpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null);
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
    let transitionStartedAt = performance.now() - TELEMETRY_CHART_TRANSITION_MS;
    let historySignature = '';
    const draw = (timestamp: number): void => {
      for (const chart of drawing) {
        if (chart.pixelRatio !== Math.max(1, window.devicePixelRatio)) resize(chart);
      }
      const current = readStats();
      if (current !== undefined) {
        const signature = `${current.fpsHistoryCursor.length}:${current.fpsHistoryCursor.nextIndex}`;
        if (signature !== historySignature) {
          historySignature = signature;
          transitionStartedAt = timestamp;
        }
        const progress = sparklineMotionProgress(timestamp - transitionStartedAt, TELEMETRY_CHART_TRANSITION_MS);
        for (const chart of drawing) {
          const series = telemetryChartSeries(current, chart.id);
          drawTelemetrySeries(chart, series.values, series.length, series.nextIndex, series.maximum, progress);
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
      />
      <TelemetryChartPanel
        canvasRef={gpuCanvasRef}
        current={latestHistoryValue(stats?.gpuHistory, stats?.gpuHistoryCursor)}
        emptyLabel={stats?.gpuTimingSupported === true ? 'Resolving GPU timing' : 'GPU timing unavailable'}
        id="gpu"
        label="GPU"
        maximum={stats?.maximumGpuMs}
        minimum={stats?.minimumGpuMs}
        scaleMaximum={stats?.frameBudgetMs}
        tone="warning"
        unit="ms"
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
}) {
  return (
    <div
      className="flex min-h-0 flex-col bg-surface p-2"
      data-scale-maximum={scaleMaximum}
      data-testid={`sparkline-${id}`}
      data-tone={tone}
    >
      <div
        className={`flex items-baseline justify-between gap-2 font-mono text-[8px] uppercase tracking-wider ${sparklineToneClass(tone)}`}
      >
        <div className="flex items-baseline gap-2">
          <p>{label}</p>
          <p className="tabular-nums">{formatSparklineValue(current, unit)}</p>
        </div>
        <p className="text-right tabular-nums">
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

function drawTelemetrySeries(
  chart: {
    readonly context: CanvasRenderingContext2D;
    readonly height: number;
    readonly width: number;
  },
  values: Float32Array,
  length: number,
  nextIndex: number,
  maximum: number,
  progress: number,
): void {
  const { context, height, width } = chart;
  context.clearRect(0, 0, width, height);
  context.beginPath();
  const start = length === values.length ? nextIndex : 0;
  let drawing = false;
  for (let index = 0; index < length; index += 1) {
    const value = values[(start + index) % values.length] ?? Number.NaN;
    if (!Number.isFinite(value)) {
      drawing = false;
      continue;
    }
    const x = sparklineAnimatedSampleX(index, length, values.length, width, progress);
    const y = sparklineSampleY(value, maximum, height);
    if (!drawing) context.moveTo(x, y);
    else context.lineTo(x, y);
    drawing = true;
  }
  context.stroke();
}

function telemetryChartSeries(stats: TelemetryChartStats, id: 'cpu' | 'fps' | 'gpu') {
  switch (id) {
    case 'fps':
      return {
        length: stats.fpsHistoryLength,
        maximum: stats.refreshRateHz,
        nextIndex: stats.fpsHistoryCursor.nextIndex,
        values: stats.fpsHistory,
      };
    case 'cpu':
      return {
        length: stats.submitHistoryLength,
        maximum: stats.frameBudgetMs,
        nextIndex: stats.submitHistoryCursor.nextIndex,
        values: stats.submitHistory,
      };
    case 'gpu':
      return {
        length: stats.gpuHistoryLength,
        maximum: stats.frameBudgetMs,
        nextIndex: stats.gpuHistoryCursor.nextIndex,
        values: stats.gpuHistory,
      };
  }
}

function latestHistoryValue(
  values: Float32Array | undefined,
  cursor: { readonly length: number; readonly nextIndex: number } | undefined,
): number | undefined {
  if (values === undefined || cursor === undefined || cursor.length === 0) return undefined;
  const value = values[(cursor.nextIndex + values.length - 1) % values.length];
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function formatSparklineValue(value: number | undefined, unit: 'fps' | 'ms'): string {
  if (value === undefined) return '—';
  if (unit === 'fps') return value.toFixed(1);
  if (value > 0 && value < 0.01) return '<0.01 ms';
  return `${value.toFixed(2)} ms`;
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
