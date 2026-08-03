import { RuntimeWorldProvider } from '../benchmark/runtime-world-provider';
import type { HarnessLayout } from '../benchmark/url-state';
import { HarnessController } from '../controllers/harness-controller';

export function HarnessRoute({ layout }: { readonly layout: HarnessLayout }) {
  return (
    <RuntimeWorldProvider>
      <HarnessController layout={layout} />
    </RuntimeWorldProvider>
  );
}
