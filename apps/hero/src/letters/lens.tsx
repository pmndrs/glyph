import { useThree } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect } from 'react';
import {
  cameraPosition,
  diffuseColor,
  dot,
  float,
  materialIOR,
  materialThickness,
  mrt,
  normalWorld,
  normalize,
  positionView,
  positionWorld,
  refract,
  screenUV,
  step,
  texture,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import {
  type Camera,
  Color,
  HalfFloatType,
  type Material,
  Mesh,
  MeshPhysicalNodeMaterial,
  NoBlending,
  type Node,
  type Object3D,
  RenderTarget,
  Scene,
  Vector2,
  type WebGPURenderer,
} from 'three/webgpu';
import type { World } from 'koota';
import { uHoleBend } from '../black-hole/materials';
import { retained } from '../hmr';
import { RainView } from '../rain/traits';
import { letterActions } from './actions';
import { LensView, Title, TitleView } from './traits';

/**
 * Glass seen through glass. The renderer's transmission refracts only the opaque scene, so a letter bends the icon
 * field beneath it but not another letter or a rain pane. This capture renders every stained-glass draw from the
 * scene camera, keeping the frontmost pane's shading normal, depth, coverage, refractive index and slab, and a
 * glass material behind it reads the pane over its fragment and shifts the point its own outline is integrated at
 * along the refracted ray through that pane, the same ray the transmission sends into the field, so overlapping
 * glass bends each other's outlines as it bends the paper. The capture clones read their coverage without the lens,
 * since a capture must not read the texture it is drawing.
 */

/** The capture's share of the frame's resolution: a pane's normal varies gently, so half is enough. */
const SCALE = 0.5;
/** A rain pane is thin glass. The title's slab is the transmission thickness the field is already bent by. */
const RAIN_SLAB = 0.3;
/** How much nearer the camera a pane must be than a fragment to count as over it, in world units. */
const OVER = 0.05;

/** The capture and the nodes that sample it, kept across a module replacement like the uniforms are. */
const lens = retained('glass-lens', () => {
  const target = new RenderTarget(2, 2, { type: HalfFloatType, count: 2 });
  const [pane, glass] = target.textures;

  if (pane === undefined || glass === undefined) throw new Error('Missing glass lens attachments');

  pane.name = 'pane';
  glass.name = 'glass';

  return { target, pane: texture(pane), glass: texture(glass), uLens: uniform(1) };
});

/** 0..1: how far glass bends the glass behind it. The lens check turns it off for its control. */
export const uLens = lens.uLens;

const plainCoverage = new WeakMap<Material, Node<'float'>>();

/** Give a glass material's coverage without the lens to the captures, which must not read what they draw. */
export function registerGlass(material: Material, coverage: Node<'float'>): void {
  plainCoverage.set(material, coverage);
}

export function plainCoverageOf(material: Material): Node<'float'> | undefined {
  return plainCoverage.get(material);
}

/**
 * How far, in world units across the floor, this fragment's outline is read from where it is, through the pane the
 * capture holds over it: nothing where no pane is nearer the camera than the fragment, or where the pane's
 * coverage has thinned to its edge, and otherwise the refracted ray into the pane, carried its slab deep, exactly
 * as the transmission carries it into the field.
 */
export function lensShift(): Node<'vec2'> {
  const pane = lens.pane.sample(screenUV);
  const glass = lens.glass.sample(screenUV);
  // Every channel is coverage-weighted, so the capture's filtering at a pane's edge blends only real glass.
  const weight = pane.a.max(0.0001);
  const depth = pane.z.div(weight);
  const over = step(positionView.z.add(OVER), depth);
  const through = pane.a.mul(over).mul(lens.uLens);
  const tilt = pane.xy.div(weight);
  // The pane's normal faces the camera, so its depth component is whatever its tilt leaves.
  const normal = vec3(tilt, float(1).sub(dot(tilt, tilt)).max(0).sqrt());
  const ior = glass.x.div(weight).max(1);
  const slab = glass.y.div(weight);
  const ray = refract(normalize(positionWorld.sub(cameraPosition)), normal, float(1).div(ior));

  return ray.xy.mul(slab).mul(through);
}

function createLens(renderer: WebGPURenderer, camera: Camera) {
  return {
    renderer,
    camera,
    sourceScene: new Scene(),
    captures: [] as { original: Mesh; capture: Mesh }[],
    /** The draw groups the captures were taken from. A new group, as after a remount, is captured afresh. */
    capturedFrom: [] as Object3D[],
    /** Each capture's visibility and world matrix as last drawn, to tell a moved glass from a still one. */
    previous: new Float32Array(0),
    clear: new Color(),
    size: new Vector2(),
  };
}

export type Lens = ReturnType<typeof createLens>;

const sources: Object3D[] = [];

/** Draw the capture after title and rain matrices have reached their draw objects, before the frame is rendered. */
export function updateGlassLens(world: World): void {
  world.query(Title, TitleView, LensView).readEach(([, draws, view]) => {
    const state = view!;
    sources.length = 0;
    sources.push(draws!.glyphs);
    const rain = world.get(RainView);

    if (rain !== undefined) sources.push(rain.root);

    if (
      sources.length !== state.capturedFrom.length ||
      sources.some((source, index) => source !== state.capturedFrom[index])
    )
      captureGlass(state, sources);

    drawLens(state);
  });
}

/** Take captures of every stained-glass draw under `roots`, replacing any from draw groups since replaced. */
function captureGlass(state: Lens, roots: readonly Object3D[]): void {
  const { sourceScene } = state;

  for (const { capture } of state.captures) {
    sourceScene.remove(capture);

    if (!Array.isArray(capture.material)) capture.material.dispose();
  }

  state.captures.length = 0;
  state.capturedFrom = [...roots];

  for (const [index, root] of roots.entries()) {
    const slab = index === 0 ? materialThickness : float(RAIN_SLAB);
    root.traverse((object) => {
      if (
        !(object instanceof Mesh) ||
        !(object.material instanceof MeshPhysicalNodeMaterial) ||
        !object.material.name.startsWith('stained-glass-')
      )
        return;

      const material = object.material.clone();
      material.name = 'glass-lens-capture';
      material.transmission = 0;
      material.outputNode = null;
      material.premultipliedAlpha = false;
      material.transparent = true;
      material.blending = NoBlending;
      material.depthWrite = true;
      material.alphaToCoverage = false;
      // Only ink writes, so a glyph quad's clear margin cannot stand in front of the glass behind it.
      material.alphaTest = 0.02;
      const plain = plainCoverageOf(object.material);

      if (plain !== undefined) material.opacityNode = plain;

      // Every attachment is coverage-weighted, so filtering the capture keeps it valid across the soft edge.
      const weight = diffuseColor.a;
      material.mrtNode = mrt({
        pane: vec4(normalWorld.xy, positionView.z, 1).mul(weight),
        glass: vec4(materialIOR, slab, 0, 1).mul(weight),
      });
      const capture = new Mesh(object.geometry, material);
      capture.matrixAutoUpdate = false;
      capture.frustumCulled = false;
      sourceScene.add(capture);
      state.captures.push({ original: object, capture });
    });
  }

  // Fresh captures have no last drawing to match, so the next frame draws.
  state.previous = new Float32Array(state.captures.length * 17).fill(Number.NaN);
}

function drawLens(state: Lens): void {
  const { renderer, camera, sourceScene, clear, size, previous } = state;
  const { target } = lens;
  // The hole bends every outline while it pulls, so the capture is redrawn as long as it does.
  let moved = uHoleBend.value > 0;

  for (const [index, { original: object, capture }] of state.captures.entries()) {
    let visible = object.visible;
    let parent = object.parent;

    while (parent !== null && visible) {
      visible = parent.visible;
      parent = parent.parent;
    }

    capture.visible = visible && object.parent !== null;
    const base = index * 17;
    const shown = capture.visible ? 1 : 0;

    if (previous[base] !== shown) {
      previous[base] = shown;
      moved = true;
    }

    if (!capture.visible) continue;

    // Glyph uses this metadata to select the retained run. Ordinary extruded meshes have no such metadata.
    capture.userData = object.userData;
    capture.matrix.copy(object.matrixWorld);
    const { elements } = object.matrixWorld;

    for (let lane = 0; lane < 16; lane++) {
      if (previous[base + 1 + lane] !== elements[lane]) {
        previous[base + 1 + lane] = elements[lane]!;
        moved = true;
      }
    }
  }

  renderer.getDrawingBufferSize(size);
  const width = Math.max(1, Math.round(size.x * SCALE));
  const height = Math.max(1, Math.round(size.y * SCALE));

  if (target.width !== width || target.height !== height) {
    target.setSize(width, height);
    moved = true;
  }

  // Glass that has not moved is captured already.
  if (!moved) return;

  const previousTarget = renderer.getRenderTarget();
  const previousMRT = renderer.getMRT();
  const previousAlpha = renderer.getClearAlpha();
  const previousAutoClear = renderer.autoClear;
  renderer.getClearColor(clear);

  try {
    renderer.autoClear = true;
    renderer.setClearColor(0, 0);
    renderer.setMRT(null);
    renderer.setRenderTarget(target);
    renderer.render(sourceScene, camera);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setMRT(previousMRT);
    renderer.setClearColor(clear, previousAlpha);
    renderer.autoClear = previousAutoClear;
  }
}

function disposeLens(state: Lens): void {
  for (const { capture } of state.captures) if (!Array.isArray(capture.material)) capture.material.dispose();

  state.captures.length = 0;
}

/** Mount the glass lens capture, drawn each frame from the scene camera before the frame itself. */
export function GlassLens() {
  const world = useWorld();
  const renderer = useThree((state) => state.renderer);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const owned = createLens(renderer, camera);
    letterActions(world).mountLensView(owned);

    return () => {
      letterActions(world).unmountLensView();
      disposeLens(owned);
    };
  }, [camera, renderer, world]);

  return null;
}
