import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { Metric } from '../../components/ui';
import { usePersistentRenderHost } from '../../renderer/persistent-render-host-context';
import type { RasterTechniqueComparisonPersistentScene } from './scenes/raster-technique-comparison';
import type { ConformanceSurfaceProps } from './types';

function loadRasterTechniqueComparison() {
  return import('./scenes/raster-technique-comparison');
}

async function reportInitializationFailure(
  cleanup: () => Promise<void>,
  caught: unknown,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await cleanup();
    onError(caught);
  } catch (cleanupError) {
    onError(cleanupError);
  }
}

export function RasterTechniqueComparisonSurface({
  backend,
  comparisonText,
  conformanceView,
  fontFixture,
  onPan,
  onZoom,
}: Pick<
  ConformanceSurfaceProps,
  'backend' | 'comparisonText' | 'conformanceView' | 'fontFixture' | 'onPan' | 'onZoom'
>) {
  const { activateSurface } = usePersistentRenderHost();
  const activatePersistentSurface = useEffectEvent(activateSurface);
  const containerRef = useRef<HTMLDivElement>(null);
  const comparisonRef = useRef<RasterTechniqueComparisonPersistentScene>(undefined);
  const [ready, setReady] = useState(false);
  const [committedText, setCommittedText] = useState('');
  const [error, setError] = useState<string>();
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    setError(caught instanceof Error ? caught.message : String(caught));
  });
  const initialView = useEffectEvent(() => conformanceView);
  const initialText = useEffectEvent(() => comparisonText);
  const publishPan = useEffectEvent((deltaXPercent: number, deltaYPercent: number) => {
    onPan(deltaXPercent, deltaYPercent);
  });
  const publishZoom = useEffectEvent((zoom: number) => {
    onZoom(zoom);
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const controller = new AbortController();
    let comparison: RasterTechniqueComparisonPersistentScene | undefined;
    let surfaceLease: Awaited<ReturnType<typeof activateSurface>> | undefined;
    let cancelled = false;
    const releaseComparison = async (): Promise<void> => {
      const current = comparison;
      comparison = undefined;
      if (comparisonRef.current === current) comparisonRef.current = undefined;
      await surfaceLease?.release();
      surfaceLease = undefined;
    };
    const initialization = (async () => {
      if (cancelled) return;
      const { createRasterTechniqueComparisonPersistentScene } = await loadRasterTechniqueComparison();
      if (cancelled) return;
      const optionsText = initialText();
      const created = createRasterTechniqueComparisonPersistentScene({
        backend,
        fontFixture,
        onError: publishError,
        onPan: publishPan,
        onZoom: publishZoom,
        text: optionsText,
      });
      comparison = created;
      comparisonRef.current = created;
      surfaceLease = await activatePersistentSurface(
        {
          anchor: container,
          controller: comparisonRef,
          label: 'Live MSDF and Slug GPU comparison',
          pan: true,
          scene: created,
          zoom: true,
        },
        controller.signal,
      );
      if (cancelled) {
        await surfaceLease.release();
        return;
      }
      let text = optionsText;
      let latestText = initialText();
      while (latestText !== text) {
        text = latestText;
        await created.setText(text);
        latestText = initialText();
      }
      if (cancelled) return;
      const view = initialView();
      created.setView(view.zoom, view.panXPercent, view.panYPercent);
      setCommittedText(text);
      setReady(true);
      setError(undefined);
    })();
    void initialization.catch((caught: unknown) =>
      reportInitializationFailure(releaseComparison, caught, publishError),
    );
    return () => {
      cancelled = true;
      controller.abort();
      void initialization.then(releaseComparison, () => undefined);
    };
  }, [backend, fontFixture]);

  useEffect(() => {
    comparisonRef.current?.setView(conformanceView.zoom, conformanceView.panXPercent, conformanceView.panYPercent);
  }, [conformanceView]);

  useEffect(() => {
    let current = true;
    void comparisonRef.current
      ?.setText(comparisonText)
      .then(() => {
        if (current) {
          setCommittedText(comparisonText);
          setError(undefined);
        }
      })
      .catch(publishError);
    return () => {
      current = false;
    };
  }, [comparisonText]);

  return (
    <div
      className="grid min-h-0 grid-rows-[auto_minmax(420px,1fr)_auto] gap-3"
      data-comparison-text={committedText}
      data-conformance-ready={String(ready)}
      data-testid="raster-technique-comparison"
    >
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-surface">
        <Metric label="Pipeline" value="GPU only" />
        <Metric label="Readback / CPU diff" value="0 / 0" />
        <Metric label="Heatmap gain" value="8×" />
      </div>
      <div
        ref={containerRef}
        className="relative min-h-[420px] overflow-hidden rounded-md border border-border bg-background"
        data-pan-x={conformanceView.panXPercent}
        data-pan-y={conformanceView.panYPercent}
        data-zoom={conformanceView.zoom}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 grid grid-cols-3 border-b border-border bg-black/70 font-mono text-[9px] uppercase tracking-wider text-muted">
          <span className="border-r border-border px-3 py-2">MSDF</span>
          <span className="border-r border-border px-3 py-2">Slug</span>
          <span className="px-3 py-2">Delta ×8 · red MSDF / cyan Slug</span>
        </div>
        {!ready && error === undefined && (
          <div className="absolute inset-0 grid place-items-center bg-background text-[10px] text-muted">
            INITIALIZING GPU COMPARISON
          </div>
        )}
        {error !== undefined && (
          <div className="absolute inset-0 grid place-items-center bg-background p-3 text-center text-[10px] text-danger">
            {error}
          </div>
        )}
      </div>
      <div className="rounded-md border border-border bg-surface p-3 text-[10px] text-dim">
        Both candidates share the same text, layout dimensions, camera, physical target size, and view transform. The
        heatmap samples both render targets directly on the GPU; black agrees, red is extra MSDF coverage, and cyan is
        extra Slug coverage.
      </div>
    </div>
  );
}
