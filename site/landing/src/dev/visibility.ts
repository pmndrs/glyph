import { useSyncExternalStore } from 'react';

/**
 * Whether the development overlays are showing.
 *
 * A subscribable module value rather than context, for the same reason the look
 * is: the stats counter renders inside `<Canvas>` and the panel renders outside
 * it, and React context does not cross that reconciler boundary. An external
 * store is read identically from both roots.
 */
let visible = true;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): boolean {
  return visible;
}

export function useDebugVisible(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/**
 * Space toggles. Bound once at module scope and ignored while the caret is in a
 * field, so typing a value into the panel does not flicker the panel away.
 */
export function bindDebugToggle(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || event.repeat) return;

    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;

    // Space scrolls the page by default, which is not wanted on a full-bleed
    // canvas and is actively confusing when it also toggles something.
    event.preventDefault();
    visible = !visible;
    for (const listener of listeners) listener();
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
