import type { HarnessLocation } from '../../benchmark/url-state';
import { HarnessLayout, type HarnessLayoutProps } from '../../components/harness-layout';
import { PersistentRenderHostProvider, usePersistentRenderHost } from '../../renderer/persistent-render-host-context';
import type { PersistentRenderJob } from '../../renderer/persistent-render-host';

type RunExclusiveJob = <T>(job: PersistentRenderJob<T>, signal?: AbortSignal) => Promise<Awaited<T>>;

interface PersistentHarnessLayoutProps extends Omit<HarnessLayoutProps, 'onAction'> {
  readonly backend: HarnessLocation['backend'];
  readonly dpr: 1 | 2;
  readonly onBenchmarkAction: () => void;
  readonly onConformanceAction: (runExclusiveJob: RunExclusiveJob) => void;
  readonly onRendererError: (caught: unknown) => void;
}

export function PersistentHarnessLayout({
  backend,
  dpr,
  onRendererError,
  ...properties
}: PersistentHarnessLayoutProps) {
  return (
    <PersistentRenderHostProvider backend={backend} dpr={dpr} key={backend} onError={onRendererError}>
      <PersistentHarnessLayoutAdapter {...properties} />
    </PersistentRenderHostProvider>
  );
}

function PersistentHarnessLayoutAdapter({
  onBenchmarkAction,
  onConformanceAction,
  ...properties
}: Omit<PersistentHarnessLayoutProps, 'backend' | 'dpr' | 'onRendererError'>) {
  const { runExclusiveJob } = usePersistentRenderHost();
  return (
    <HarnessLayout
      {...properties}
      onAction={
        properties.location.mode === 'benchmark' ? onBenchmarkAction : () => onConformanceAction(runExclusiveJob)
      }
    />
  );
}
