export interface CanvasViewController {
  panBy(deltaX: number, deltaY: number): { readonly deltaX: number; readonly deltaY: number } | void;
  resetView(): void;
  zoomBy?(factor: number): void;
}
