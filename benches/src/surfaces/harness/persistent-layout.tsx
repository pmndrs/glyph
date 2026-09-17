import type { HarnessLocation } from '../../benchmark/url-state';
import { HarnessLayout, type HarnessLayoutProps } from '../../components/harness-layout';
import { PersistentRenderHostProvider } from '../../renderer/persistent-render-host-context';

interface PersistentHarnessLayoutProps extends HarnessLayoutProps {
  readonly backend: HarnessLocation['backend'];
  readonly dpr: 1 | 2;
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
      <HarnessLayout {...properties} />
    </PersistentRenderHostProvider>
  );
}
