export type ScreenRect = Readonly<{ x: number; y: number; width: number; height: number }>;

export type ShowcaseUiLayout = Readonly<{
  panel: ScreenRect;
  content: ScreenRect;
  denseExit: ScreenRect;
  launch: ScreenRect;
}>;

const SAFE_AREA = 12;
const PANEL_PADDING = 18;
const CONTROL_HEIGHT = 34;

/** Pixel-authored overlay layout for the fixed camera-space information panel. */
export function showcaseUiLayout(width: number, height: number): ShowcaseUiLayout {
  const availableWidth = Math.max(1, width - SAFE_AREA * 2);
  const availableHeight = Math.max(1, height - SAFE_AREA * 2);
  const panelWidth = Math.min(360, Math.max(240, availableWidth * 0.46), availableWidth);
  const panel = rect(width - SAFE_AREA - panelWidth, SAFE_AREA, panelWidth, availableHeight);
  const content = rect(
    panel.x + PANEL_PADDING,
    panel.y + PANEL_PADDING,
    Math.max(1, panel.width - PANEL_PADDING * 2),
    Math.max(1, panel.height - PANEL_PADDING * 2),
  );
  const launchWidth = 96;
  const controlY = panel.y + panel.height - PANEL_PADDING - CONTROL_HEIGHT;
  const launch = rect(panel.x + panel.width - PANEL_PADDING - launchWidth, controlY, launchWidth, CONTROL_HEIGHT);
  const denseExit = launch;
  return Object.freeze({ content, denseExit, launch, panel });
}

/** World units represented by one CSS pixel at a camera-local plane. */
export function cameraUnitsPerPixel(viewportHeight: number, verticalFovDegrees: number, distance: number): number {
  const height = Math.max(1, viewportHeight);
  const radians = (verticalFovDegrees * Math.PI) / 180;
  return (2 * Math.tan(radians / 2) * distance) / height;
}

export function containsScreenPoint(rectangle: ScreenRect, x: number, y: number): boolean {
  return (
    x >= rectangle.x && x <= rectangle.x + rectangle.width && y >= rectangle.y && y <= rectangle.y + rectangle.height
  );
}

function rect(x: number, y: number, width: number, height: number): ScreenRect {
  return Object.freeze({ height, width, x, y });
}
