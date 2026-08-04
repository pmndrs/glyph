import { Suspense } from 'react';

import { HarnessRoute } from './routes/harness-route';
import { Route, Switch } from 'wouter';

function ShellFallback() {
  return <div className="grid min-h-screen place-items-center bg-background text-sm text-muted">Loading harness…</div>;
}

function locationSearch(): string {
  return typeof globalThis.location === 'undefined' ? '' : globalThis.location.search;
}

export function App() {
  if (new URLSearchParams(locationSearch()).has('runner')) {
    return (
      <div
        className="grid min-h-screen place-items-center bg-background font-mono text-[10px] text-dim"
        data-testid="runner-host"
      >
        INTERNAL RUNNER HOST
      </div>
    );
  }
  return (
    <Suspense fallback={<ShellFallback />}>
      <Switch>
        <Route path="/presentation">
          <HarnessRoute layout="presentation" />
        </Route>
        <Route>
          <HarnessRoute layout="main" />
        </Route>
      </Switch>
    </Suspense>
  );
}
