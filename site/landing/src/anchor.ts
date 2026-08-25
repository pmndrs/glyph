/**
 * Publishes where the wordmark's line box ends as a fraction of the frame, so
 * the DOM overlay can sit a fixed optical gap beneath it at any viewport instead
 * of being parked at the bottom of the screen.
 *
 * A custom property rather than React state on purpose: this changes on resize
 * and on every relayout, and pushing it through a render would re-run the scene
 * for something only the stylesheet consumes.
 */
let published = -1;

export function publishMarkBottom(fraction: number): void {
  const clamped = Math.min(0.94, Math.max(0.06, fraction));
  // Sub-tenth-of-a-percent changes are below the threshold of anything visible
  // and would otherwise write to the DOM every frame.
  if (Math.abs(clamped - published) < 0.001) return;
  published = clamped;
  document.documentElement.style.setProperty('--mark-bottom', `${(clamped * 100).toFixed(2)}%`);
}
