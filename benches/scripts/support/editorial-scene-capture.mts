import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';

const CANVAS_SELECTOR = 'canvas[data-configured-renderer-active="true"]';

/** Captures Chromium's composited canvas rectangle while every intersecting DOM overlay is temporarily hidden. */
export async function captureEditorialSceneOnly(page: Page): Promise<{
  readonly png: Uint8Array;
  readonly hiddenOverlayElements: number;
}> {
  const proofToken = randomUUID();
  try {
    const hiddenOverlayElements = await page.evaluate(
      ({ selector, marker }) => {
        const canvas = document.querySelector<HTMLCanvasElement>(selector);
        if (canvas === null) throw new Error('Editorial scene capture lost its active canvas');
        const rectangle = canvas.getBoundingClientRect();
        if (
          !canvas.isConnected ||
          rectangle.width <= 0 ||
          rectangle.height <= 0 ||
          getComputedStyle(canvas).visibility !== 'visible'
        ) {
          throw new Error('Editorial scene canvas is not visible');
        }
        const intersectsCanvas = (element: Element): boolean => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.width > 0 &&
            bounds.height > 0 &&
            bounds.left < rectangle.right &&
            bounds.right > rectangle.left &&
            bounds.top < rectangle.bottom &&
            bounds.bottom > rectangle.top
          );
        };
        let hidden = 0;
        for (const element of document.querySelectorAll<HTMLElement | SVGElement>('*')) {
          if (element === canvas || element.contains(canvas) || !intersectsCanvas(element)) continue;
          element.dataset.editorialProofVisibility = element.style.getPropertyValue('visibility');
          element.dataset.editorialProofPriority = element.style.getPropertyPriority('visibility');
          element.dataset.editorialProofTransitionProperty = element.style.getPropertyValue('transition-property');
          element.dataset.editorialProofTransitionPriority = element.style.getPropertyPriority('transition-property');
          element.dataset.editorialProofHidden = marker;
          element.style.setProperty('transition-property', 'none', 'important');
          element.style.setProperty('visibility', 'hidden', 'important');
          hidden += 1;
        }
        for (const element of document.querySelectorAll<HTMLElement | SVGElement>(
          `[data-editorial-proof-hidden="${marker}"]`,
        )) {
          const visibility = getComputedStyle(element).visibility;
          if (visibility !== 'hidden') {
            const identity = `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`}`;
            throw new Error(
              `Overlapping ${identity} class=${JSON.stringify(element.getAttribute('class'))} remained ${visibility}`,
            );
          }
        }
        if (getComputedStyle(canvas).visibility !== 'visible' || hidden === 0) {
          throw new Error('Editorial scene isolation hid the canvas or found no overlapping UI');
        }
        return hidden;
      },
      { selector: CANVAS_SELECTOR, marker: proofToken },
    );
    const png = await page.locator(CANVAS_SELECTOR).screenshot();
    return { png, hiddenOverlayElements };
  } finally {
    await page.evaluate((marker) => {
      const hidden = [
        ...document.querySelectorAll<HTMLElement | SVGElement>(`[data-editorial-proof-hidden="${marker}"]`),
      ];
      try {
        for (const element of hidden) {
          const previousVisibility = element.dataset.editorialProofVisibility;
          const previousPriority = element.dataset.editorialProofPriority;
          if (previousVisibility === undefined || previousVisibility === '') {
            element.style.removeProperty('visibility');
          } else {
            element.style.setProperty('visibility', previousVisibility, previousPriority);
          }
        }
        // Commit restored visibility while transitions remain disabled, so the capture creates no delayed fade.
        for (const element of hidden) getComputedStyle(element).getPropertyValue('visibility');
      } finally {
        for (const element of hidden) {
          const previousTransitionProperty = element.dataset.editorialProofTransitionProperty;
          const previousTransitionPriority = element.dataset.editorialProofTransitionPriority;
          if (previousTransitionProperty === undefined || previousTransitionProperty === '') {
            element.style.removeProperty('transition-property');
          } else {
            element.style.setProperty('transition-property', previousTransitionProperty, previousTransitionPriority);
          }
          delete element.dataset.editorialProofHidden;
          delete element.dataset.editorialProofVisibility;
          delete element.dataset.editorialProofPriority;
          delete element.dataset.editorialProofTransitionProperty;
          delete element.dataset.editorialProofTransitionPriority;
        }
      }
    }, proofToken);
  }
}

interface EditorialCaptureState {
  readonly animationEnabled: false;
  readonly camera: string;
  readonly canvasCss: readonly [number, number];
  readonly configurationRevision: number;
  readonly dpr: number;
  readonly fontFixture: string;
  readonly showGrid: boolean;
  readonly workload: string;
}

/** Binds the post-PNG viewport state to the later, read-only scene inspection before a semantic artifact is saved. */
export function assertEditorialSceneMatchesCapture(producer: unknown, state: EditorialCaptureState): void {
  const scene = proofObject(producer, 'editorial scene producer');
  const configuration = proofObject(scene.configuration, 'editorial scene configuration');
  const camera = proofObject(scene.camera, 'editorial scene camera');
  const viewport = configuration.viewport;
  // The runtime receives the anchor's integer client size; canvas bounds can retain a fractional CSS size.
  const viewportMatches =
    Array.isArray(viewport) &&
    viewport.length === 2 &&
    viewport.every(
      (value, index) => typeof value === 'number' && value === Math.round(state.canvasCss[index] ?? Number.NaN),
    );
  if (
    state.showGrid !== true ||
    state.workload !== 'editorial' ||
    state.camera !== 'perspective' ||
    configuration.revision !== state.configurationRevision ||
    configuration.workload !== state.workload ||
    configuration.animationEnabled !== state.animationEnabled ||
    configuration.dpr !== state.dpr ||
    configuration.fontFixture !== state.fontFixture ||
    configuration.showGrid !== state.showGrid ||
    camera.kind !== state.camera ||
    !viewportMatches
  ) {
    throw new Error('Editorial scene producer changed after the paused PNG capture');
  }
}

function proofObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}
