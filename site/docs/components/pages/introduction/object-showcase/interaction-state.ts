export type ShowcaseInteraction =
  | Readonly<{ phase: 'orbiting' }>
  | Readonly<{ phase: 'focusing'; selectedIndex: number }>
  | Readonly<{ phase: 'open'; selectedIndex: number }>
  | Readonly<{ phase: 'closing'; selectedIndex: number }>;

export const ORBITING: ShowcaseInteraction = Object.freeze({ phase: 'orbiting' });

export function focusShowcaseObject(selectedIndex: number): ShowcaseInteraction {
  return Object.freeze({ phase: 'focusing', selectedIndex });
}

export function finishShowcaseFocus(state: ShowcaseInteraction): ShowcaseInteraction {
  return state.phase === 'focusing' ? Object.freeze({ phase: 'open', selectedIndex: state.selectedIndex }) : state;
}

export function closeShowcasePanel(state: ShowcaseInteraction): ShowcaseInteraction {
  return state.phase === 'open' || state.phase === 'focusing'
    ? Object.freeze({ phase: 'closing', selectedIndex: state.selectedIndex })
    : state;
}

export function finishShowcaseClose(state: ShowcaseInteraction): ShowcaseInteraction {
  return state.phase === 'closing' ? ORBITING : state;
}

export function selectedShowcaseIndex(state: ShowcaseInteraction): number | undefined {
  return state.phase === 'orbiting' ? undefined : state.selectedIndex;
}

/** Labels return while the camera returns, rather than waiting for orbit mode to resume. */
export function showcaseLabelOpacityTarget(state: ShowcaseInteraction): number {
  return state.phase === 'orbiting' || state.phase === 'closing' ? 1 : 0;
}

/** The return flight remains interruptible so another object can be focused immediately. */
export function canSelectShowcaseObject(state: ShowcaseInteraction): boolean {
  return state.phase === 'orbiting' || state.phase === 'closing';
}
