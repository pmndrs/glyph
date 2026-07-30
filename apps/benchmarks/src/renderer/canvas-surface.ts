import * as THREE from 'three/webgpu';

const CANVAS_BACKGROUND_COLOR = 0x070709;
const CANVAS_GRID_COLOR = 0x50505c;
const GRID_SPACING_CSS_PX = 16;
const GRID_LINE_WIDTH_CSS_PX = 1;
const GRID_ORIGIN_CSS_PX = GRID_SPACING_CSS_PX - GRID_LINE_WIDTH_CSS_PX;

export interface CanvasSurface {
  resize(width: number, height: number): void;
  setGridVisible(visible: boolean): void;
  render(scene: THREE.Scene, camera: THREE.OrthographicCamera | THREE.PerspectiveCamera): void;
  dispose(): void;
}

/** Owns the opaque, screen-space canvas background independently from scene transforms. */
export function createCanvasSurface(
  renderer: THREE.WebGPURenderer,
  width: number,
  height: number,
  gridVisible: boolean,
): CanvasSurface {
  let surfaceWidth = width;
  let surfaceHeight = height;
  const backgroundScene = new THREE.Scene();
  const backgroundCamera = createBackgroundCamera(width, height);
  const grid = new THREE.Mesh(
    createCanvasGridGeometry(width, height),
    new THREE.MeshBasicNodeMaterial({
      color: CANVAS_GRID_COLOR,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  grid.frustumCulled = false;
  grid.visible = gridVisible;
  backgroundScene.add(grid);
  renderer.autoClear = false;
  renderer.setClearColor(CANVAS_BACKGROUND_COLOR, 1);

  return {
    resize(nextWidth, nextHeight) {
      assertViewportSize(nextWidth, 'canvas surface width');
      assertViewportSize(nextHeight, 'canvas surface height');
      if (nextWidth === surfaceWidth && nextHeight === surfaceHeight) return;
      surfaceWidth = nextWidth;
      surfaceHeight = nextHeight;
      const previous = grid.geometry;
      grid.geometry = createCanvasGridGeometry(nextWidth, nextHeight);
      previous.dispose();
      backgroundCamera.right = nextWidth;
      backgroundCamera.bottom = -nextHeight;
      backgroundCamera.updateProjectionMatrix();
    },
    setGridVisible(visible) {
      grid.visible = visible;
    },
    render(scene, camera) {
      renderer.setRenderTarget(null);
      renderer.clear();
      if (grid.visible) renderer.render(backgroundScene, backgroundCamera);
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
    dispose() {
      grid.geometry.dispose();
      grid.material.dispose();
    },
  };
}

export function createCanvasGridPositions(width: number, height: number): Float32Array {
  assertViewportSize(width, 'canvas grid width');
  assertViewportSize(height, 'canvas grid height');
  const verticalCount = Math.max(0, Math.ceil((width - GRID_ORIGIN_CSS_PX) / GRID_SPACING_CSS_PX));
  const horizontalCount = Math.max(0, Math.ceil((height - GRID_ORIGIN_CSS_PX) / GRID_SPACING_CSS_PX));
  const positions = new Float32Array((verticalCount + horizontalCount) * 6 * 3);
  let offset = 0;
  for (let x = GRID_ORIGIN_CSS_PX; x < width; x += GRID_SPACING_CSS_PX) {
    offset = writeQuad(positions, offset, x, 0, Math.min(x + GRID_LINE_WIDTH_CSS_PX, width), -height);
  }
  for (let y = GRID_ORIGIN_CSS_PX; y < height; y += GRID_SPACING_CSS_PX) {
    offset = writeQuad(positions, offset, 0, -y, width, -Math.min(y + GRID_LINE_WIDTH_CSS_PX, height));
  }
  return positions;
}

function createCanvasGridGeometry(width: number, height: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(createCanvasGridPositions(width, height), 3));
  return geometry;
}

function createBackgroundCamera(width: number, height: number): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(0, width, 0, -height, 0.1, 10);
  camera.position.z = 1;
  camera.updateProjectionMatrix();
  return camera;
}

function writeQuad(
  target: Float32Array,
  offset: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number {
  target.set([left, top, 0, left, bottom, 0, right, top, 0, left, bottom, 0, right, bottom, 0, right, top, 0], offset);
  return offset + 18;
}

function assertViewportSize(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
}
