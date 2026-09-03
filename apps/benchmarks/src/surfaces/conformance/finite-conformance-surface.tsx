import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { BitmapTextConformanceCapture } from '../../benchmark/targets/conformance/raster/bitmap-capture';
import type { MtsdfTextConformanceCapture } from '../../benchmark/targets/conformance/raster/mtsdf-capture';
import type { SlugTextConformanceCapture } from '../../benchmark/targets/conformance/raster/slug-capture';
import { usePersistentRenderHost } from '../../renderer/persistent-render-host-context';
import type { RuntimeFallbackCapture } from '../../benchmark/targets/conformance/raster/runtime-fallback';
import type { SourceOutlineFidelityCapture } from '../../benchmark/low-level/raster/source-outline-reference';
import type { ConformanceView } from '../../components/render-controls';
import { Metric } from '../../components/ui';
import { captureFiniteConformance, type FiniteConformanceCapture } from './capture';
import type { ConformanceSurfaceProps } from './types';

function formatMs(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)} ms`;
}

function formatLabel(technique: ConformanceSurfaceProps['technique']): 'Bitmap' | 'MSDF' | 'Slug' {
  return technique === 'mtsdf' ? 'MSDF' : technique === 'slug' ? 'Slug' : 'Bitmap';
}

export function FiniteConformanceSurface({
  backend,
  conformanceView,
  dpr,
  event,
  fontFixture,
  summary,
  technique,
  workload,
  onPan,
  onZoom,
}: ConformanceSurfaceProps) {
  const { runExclusiveJob } = usePersistentRenderHost();
  const runExclusiveCapture = useEffectEvent(runExclusiveJob);
  const [capture, setCapture] = useState<FiniteConformanceCapture>();
  const [error, setError] = useState<string>();
  const publishCapture = useEffectEvent((value: FiniteConformanceCapture) => {
    setCapture(value);
    setError(undefined);
  });
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    setError(caught instanceof Error ? caught.message : String(caught));
  });
  useEffect(() => {
    if (summary === undefined) return;
    const controller = new AbortController();
    let cancelled = false;
    const request = runExclusiveCapture(
      ({ renderer, signal }) =>
        captureFiniteConformance({ backend, dpr, fontFixture, renderer, signal, technique, workload }),
      controller.signal,
    );
    void request
      .then((value) => {
        if (!cancelled) publishCapture(value);
      })
      .catch((caught: unknown) => {
        if (!cancelled) publishError(caught);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [backend, dpr, fontFixture, summary, technique, workload]);

  const bitmapCapture = capture?.kind === 'bitmap' ? capture.value : undefined;
  const mtsdfCapture = capture?.kind === 'mtsdf' ? capture.value : undefined;
  const slugCapture = capture?.kind === 'slug' ? capture.value : undefined;
  const analyticCapture = technique === 'slug' ? slugCapture : mtsdfCapture;
  const sourceOutlineCapture = capture?.kind === 'source-outline' ? capture.value : undefined;
  const runtimeFallbackCapture = capture?.kind === 'runtime-fallback' ? capture.value : undefined;
  const isSourceOutline = workload === 'cross-technique-fidelity';
  const isRuntimeFallback = workload === 'runtime-fallback';

  return (
    <div
      className="grid min-h-0 grid-rows-[auto_minmax(360px,1fr)_auto] gap-3"
      data-conformance-ready={String(capture !== undefined)}
      data-runtime-fallback-mismatch-bytes={runtimeFallbackCapture?.mismatchBytes}
      data-runtime-fallback-changed-pixels={runtimeFallbackCapture?.changedPixels}
      data-runtime-fallback-maximum-error={runtimeFallbackCapture?.maximumError}
      data-testid="conformance-surface"
    >
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface md:grid-cols-4">
        <Metric
          label={
            isRuntimeFallback
              ? 'Mismatched bytes'
              : isSourceOutline || technique !== 'bitmap'
                ? 'Mean error · 0–255'
                : 'Reference mismatch'
          }
          value={
            isRuntimeFallback
              ? String(runtimeFallbackCapture?.mismatchBytes ?? '—')
              : isSourceOutline
                ? sourceOutlineCapture === undefined
                  ? '—'
                  : `${sourceOutlineCapture.meanAbsoluteError.toFixed(3)} · ${((sourceOutlineCapture.meanAbsoluteError / 255) * 100).toFixed(3)}%`
                : technique !== 'bitmap'
                  ? analyticCapture === undefined
                    ? '—'
                    : `${analyticCapture.meanAbsoluteError.toFixed(3)} · ${((analyticCapture.meanAbsoluteError / 255) * 100).toFixed(3)}%`
                  : bitmapCapture === undefined
                    ? '—'
                    : String(bitmapCapture.mismatchBytes)
          }
        />
        <Metric
          label={
            isRuntimeFallback
              ? 'Changed pixels'
              : isSourceOutline || technique !== 'bitmap'
                ? 'Pixels > 2 / 255'
                : 'Half-coverage ink'
          }
          value={
            isRuntimeFallback
              ? String(runtimeFallbackCapture?.changedPixels ?? '—')
              : isSourceOutline
                ? sourceOutlineCapture === undefined
                  ? '—'
                  : `${sourceOutlineCapture.errorPixels} · ${((sourceOutlineCapture.errorPixels / (sourceOutlineCapture.width * sourceOutlineCapture.height)) * 100).toFixed(2)}%`
                : technique !== 'bitmap'
                  ? analyticCapture === undefined
                    ? '—'
                    : `${analyticCapture.errorPixels} · ${((analyticCapture.errorPixels / (analyticCapture.width * analyticCapture.height)) * 100).toFixed(2)}%`
                  : bitmapCapture === undefined
                    ? '—'
                    : String(bitmapCapture.inkPixels)
          }
        />
        <Metric
          label={
            isRuntimeFallback
              ? 'Maximum error · 0–255'
              : isSourceOutline || technique !== 'bitmap'
                ? 'Maximum error · 0–255'
                : 'Lit pixels'
          }
          value={
            isRuntimeFallback
              ? `${runtimeFallbackCapture?.maximumError ?? '—'} / 255`
              : isSourceOutline
                ? sourceOutlineCapture === undefined
                  ? '—'
                  : `${sourceOutlineCapture.maximumError} / 255`
                : technique !== 'bitmap'
                  ? analyticCapture === undefined
                    ? '—'
                    : `${analyticCapture.maximumError} / 255`
                  : bitmapCapture === undefined
                    ? '—'
                    : String(bitmapCapture.litPixels)
          }
        />
        <Metric label="Render submit (diagnostic)" value={formatMs(capture?.value.renderSubmitMs)} />
        <Metric label="Suite duration" value={formatMs(summary?.medianMs ?? event?.medianMs)} />
      </div>
      <FiniteConformancePanels
        analyticCapture={analyticCapture}
        bitmapCapture={bitmapCapture}
        conformanceView={conformanceView}
        runtimeFallbackCapture={runtimeFallbackCapture}
        sourceOutlineCapture={sourceOutlineCapture}
        technique={technique}
        workload={workload}
        onPan={onPan}
        onZoom={onZoom}
      />
      <div className="rounded-md border border-border bg-surface p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className={`size-2 rounded-full ${summary?.status === 'passed' ? 'bg-success' : 'bg-dim'}`} />
          <span className="font-medium">Finite conformance suite</span>
          <span className="ml-auto font-mono text-[10px] text-muted">
            {summary?.validation ??
              (isSourceOutline
                ? 'Run conformance to validate the selected renderer against the pinned source font in browser Canvas2D.'
                : technique !== 'bitmap'
                  ? `Run conformance to validate ${formatLabel(technique)} GPU sampling against the independent CPU sampling reference.`
                  : 'Run conformance to test full-frame and clipped output.')}
          </span>
        </div>
        <p className="mt-2 text-[10px] text-dim">
          {isSourceOutline
            ? 'All techniques are compared independently with browser Canvas2D using the same pinned source font, authored lines, physical size, and paragraph baselines.'
            : technique !== 'bitmap'
              ? 'Heatmap: black agrees, red is extra GPU coverage, and cyan is extra CPU-reference coverage. Intensity is amplified 8×.'
              : 'End-to-end suite duration includes readback, CPU composition, comparison, clipping, and hashing. It is test cost, not renderer performance.'}
        </p>
      </div>
      {error !== undefined && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function FiniteConformancePanels({
  analyticCapture,
  bitmapCapture,
  conformanceView,
  runtimeFallbackCapture,
  sourceOutlineCapture,
  technique,
  workload,
  onPan,
  onZoom,
}: {
  readonly analyticCapture: MtsdfTextConformanceCapture | SlugTextConformanceCapture | undefined;
  readonly bitmapCapture: BitmapTextConformanceCapture | undefined;
  readonly conformanceView: ConformanceView;
  readonly runtimeFallbackCapture: RuntimeFallbackCapture | undefined;
  readonly sourceOutlineCapture: SourceOutlineFidelityCapture | undefined;
  readonly technique: ConformanceSurfaceProps['technique'];
  readonly workload: ConformanceSurfaceProps['workload'];
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onZoom: (zoom: number) => void;
}) {
  if (workload === 'runtime-fallback') {
    return (
      <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
        <PixelBytesPanel
          bytes={runtimeFallbackCapture?.baked}
          conformanceView={conformanceView}
          height={runtimeFallbackCapture?.height}
          label="Checked-in baked asset"
          width={runtimeFallbackCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={runtimeFallbackCapture?.runtime}
          conformanceView={conformanceView}
          height={runtimeFallbackCapture?.height}
          label="Source font · runtime bake"
          width={runtimeFallbackCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={runtimeFallbackCapture?.difference}
          className="md:col-span-2"
          conformanceView={conformanceView}
          height={runtimeFallbackCapture?.height}
          label="Baked / runtime difference heatmap ×8"
          width={runtimeFallbackCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
      </div>
    );
  }
  if (workload === 'cross-technique-fidelity') {
    return (
      <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
        <PixelBytesPanel
          bytes={sourceOutlineCapture?.candidate}
          conformanceView={conformanceView}
          height={sourceOutlineCapture?.height}
          label={`${formatLabel(technique)} candidate · ${sourceOutlineCapture?.physicalPpem ?? '—'} device px`}
          width={sourceOutlineCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={sourceOutlineCapture?.reference}
          conformanceView={conformanceView}
          height={sourceOutlineCapture?.height}
          label="Browser Canvas2D · pinned source font"
          width={sourceOutlineCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={sourceOutlineCapture?.difference}
          className="md:col-span-2"
          conformanceView={conformanceView}
          height={sourceOutlineCapture?.height}
          label="Source-outline difference heatmap ×8"
          width={sourceOutlineCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
      </div>
    );
  }
  if (technique !== 'bitmap') {
    return (
      <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
        <PixelBytesPanel
          bytes={analyticCapture?.candidate}
          conformanceView={conformanceView}
          height={analyticCapture?.height}
          label={`${formatLabel(technique)} candidate`}
          width={analyticCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={analyticCapture?.reference}
          conformanceView={conformanceView}
          height={analyticCapture?.height}
          label="CPU sampling reference"
          width={analyticCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={analyticCapture?.difference}
          className="md:col-span-2"
          conformanceView={conformanceView}
          height={analyticCapture?.height}
          label="Difference heatmap ×8"
          width={analyticCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
      </div>
    );
  }
  return (
    <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
      <PixelPanel
        capture={bitmapCapture}
        conformanceView={conformanceView}
        kind="candidate"
        label="Candidate"
        onPan={onPan}
        onZoom={onZoom}
      />
      <PixelPanel
        capture={bitmapCapture}
        conformanceView={conformanceView}
        kind="reference"
        label="CPU reference"
        onPan={onPan}
        onZoom={onZoom}
      />
      <PixelPanel
        capture={bitmapCapture}
        className="md:col-span-2"
        conformanceView={conformanceView}
        kind="difference"
        label="Difference ×1"
        onPan={onPan}
        onZoom={onZoom}
      />
    </div>
  );
}

function PixelBytesPanel({
  bytes,
  className = '',
  conformanceView,
  height,
  label,
  width,
  onPan,
  onZoom,
}: {
  readonly bytes: Uint8Array | undefined;
  readonly className?: string;
  readonly conformanceView: ConformanceView;
  readonly height: number | undefined;
  readonly label: string;
  readonly width: number | undefined;
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onZoom: (zoom: number) => void;
}) {
  const interactionRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomFromWheel = useEffectEvent((deltaY: number) => {
    const direction = deltaY < 0 ? 0.25 : -0.25;
    onZoom(Math.min(8, Math.max(1, conformanceView.zoom + direction)));
  });
  useEffect(() => {
    const interaction = interactionRef.current;
    if (interaction === null) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoomFromWheel(event.deltaY);
    };
    interaction.addEventListener('wheel', handleWheel, { passive: false });
    return () => interaction.removeEventListener('wheel', handleWheel);
  }, []);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || bytes === undefined || width === undefined || height === undefined) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Unable to create conformance inspection canvas');
    const pixels =
      bytes.buffer instanceof ArrayBuffer
        ? new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8ClampedArray(bytes);
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
  }, [bytes, height, width]);
  function moveView(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || conformanceView.zoom <= 1) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onPan((event.movementX / bounds.width) * 100, (event.movementY / bounds.height) * 100);
  }
  return (
    <figure className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-panel ${className}`}>
      <figcaption className="border-b border-border px-3 py-2 font-mono text-[9px] uppercase tracking-wider text-muted">
        {label}
      </figcaption>
      <button
        ref={interactionRef}
        type="button"
        aria-label={`Pan and zoom ${label}`}
        className={`grid min-h-[240px] flex-1 place-items-center overflow-hidden p-3 ${conformanceView.zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
        data-pan-x={conformanceView.panXPercent}
        data-pan-y={conformanceView.panYPercent}
        data-zoom={conformanceView.zoom}
        style={{ touchAction: 'none' }}
        onDoubleClick={() => onZoom(conformanceView.zoom === 1 ? 2 : 1)}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={moveView}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        {bytes === undefined ? (
          <span className="font-mono text-[9px] text-dim">GENERATING</span>
        ) : (
          <canvas
            className="h-auto max-h-full w-full select-none [image-rendering:pixelated]"
            ref={canvasRef}
            style={{
              transform: `translate3d(${conformanceView.panXPercent}%, ${conformanceView.panYPercent}%, 0) scale(${conformanceView.zoom})`,
              transformOrigin: 'center',
            }}
          />
        )}
      </button>
    </figure>
  );
}

function PixelPanel({
  capture,
  className,
  conformanceView,
  kind,
  label,
  onPan,
  onZoom,
}: {
  readonly capture: BitmapTextConformanceCapture | undefined;
  readonly className?: string;
  readonly conformanceView: ConformanceView;
  readonly kind: 'candidate' | 'reference' | 'difference';
  readonly label: string;
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onZoom: (zoom: number) => void;
}) {
  return (
    <PixelBytesPanel
      bytes={capture?.[kind]}
      {...(className === undefined ? {} : { className })}
      conformanceView={conformanceView}
      height={capture?.height}
      label={label}
      width={capture?.width}
      onPan={onPan}
      onZoom={onZoom}
    />
  );
}
