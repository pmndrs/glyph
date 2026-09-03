import { Component, type ReactNode } from 'react';

import type { RasterFormatName } from '../../benchmark/url-state';
import { formatLabel } from '../benchmark/labels';

/** Distinguishes a rejected scene load from the pending Suspense state. */
export class SceneErrorBoundary extends Component<
  Readonly<{ technique: RasterFormatName; onError: (error: unknown) => void; children: ReactNode }>,
  Readonly<{ error: unknown }>
> {
  override state: Readonly<{ error: unknown }> = { error: undefined };

  static getDerivedStateFromError(error: unknown): Readonly<{ error: unknown }> {
    return { error };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    if (this.state.error === undefined) return this.props.children;
    const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
    return (
      <div
        className="relative grid h-full min-h-0 place-items-center overflow-hidden bg-background"
        data-testid="scene-error"
      >
        <div className="max-w-[min(42rem,90%)] rounded-md border border-red-500/40 bg-black/90 px-4 py-3 font-mono text-[10px] text-red-200">
          <div className="mb-1 font-semibold">Failed to load {formatLabel(this.props.technique)} scene</div>
          <div className="break-words text-red-300/80">{message}</div>
        </div>
      </div>
    );
  }
}
