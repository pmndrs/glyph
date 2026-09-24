import {
  diffuseColor,
  float,
  materialAttenuationColor,
  materialAttenuationDistance,
  materialDispersion,
  materialIOR,
  materialThickness,
  mrt,
  normalWorld,
  positionView,
  positionWorld,
  vec3,
  vec4,
} from 'three/tsl';
import {
  type Camera,
  Color,
  Mesh,
  MeshPhysicalNodeMaterial,
  type MRTNode,
  NoBlending,
  type NodeFrame,
  type Object3D,
  type RenderTarget,
  Vector2,
  type WebGPURenderer,
} from 'three/webgpu';
import type { World } from 'koota';
import { uHoleBend } from '../black-hole/materials';
import { Title, TitleView } from '../letters/traits';
import { RainView } from '../rain/traits';
import { RobotView } from '../robot/traits';
import { Time } from '../time/traits';
import { GLASS_DEPTH, SHADOW_CASTER_LAYER, SHADOW_RECEIVER_Z } from './content';
import { lensTarget, plainCoverageOf } from './materials';
import type { Projection } from './renderer';
import { LensView, ShadowView, type GlassCapture, type Lens } from './traits';

/** The capture's share of the frame's resolution: a pane's normal varies gently, so half is enough. */
const SCALE = 0.5;
/** A rain pane is thin glass. The title's slab is the transmission thickness the field is already bent by. */
const RAIN_SLAB = 0.3;

const shadowSources: Object3D[] = [];
const lensSources: Object3D[] = [];
const drawingBuffer = new Vector2();

/**
 * Whether `values` have stirred from `previous` by more than a hair, copying them in where they have. A body at
 * rest still settles by hairs, and an exact comparison would redraw a capture every frame for a scene that has
 * stopped.
 */
function stirred(previous: Float32Array | Float64Array, values: ArrayLike<number>): boolean {
  let moved = false;

  for (let index = 0; index < values.length; index++) {
    if (Math.abs(previous[index]! - values[index]!) <= 1e-4) continue;

    previous[index] = values[index]!;
    moved = true;
  }

  return moved;
}

/**
 * Whether the title's letters have moved since `state` last drew, taking fresh captures when a draw group has been
 * replaced. The title's draw group, and the rain's once it has mounted, are the glass; rain above `rainCeiling`
 * is left out.
 */
function followGlass(
  world: World,
  state: GlassCapture,
  sources: Object3D[],
  rainCeiling: number,
  dress: (material: MeshPhysicalNodeMaterial, source: number) => void,
): boolean {
  const entity = world.queryFirst(Title, TitleView)!;
  const letters = entity.get(Title)!.bodies!.matrices;
  sources.length = 0;
  sources.push(entity.get(TitleView)!.glyphs);
  const rain = world.get(RainView);

  if (rain !== undefined) sources.push(rain.root);

  if (
    sources.length !== state.capturedFrom.length ||
    sources.some((source, index) => source !== state.capturedFrom[index])
  ) {
    captureGlass(state, sources, rainCeiling, dress);
  }

  if (state.letters.length !== letters.length) state.letters = new Float64Array(letters.length).fill(Number.NaN);

  return stirred(state.letters, letters);
}

/**
 * Clone every stained-glass draw under `roots` into the capture's scene, replacing the captures of draw groups since
 * replaced. Each clone draws the plain lit glass without the lens, since the captures draw what the lens reads, and
 * `dress` gives it what its capture writes, by the index of its root.
 */
function captureGlass(
  state: GlassCapture,
  roots: readonly Object3D[],
  rainCeiling: number,
  dress: (material: MeshPhysicalNodeMaterial, source: number) => void,
): void {
  const { sourceScene } = state;

  for (const { capture } of state.captures) {
    sourceScene.remove(capture);

    if (!Array.isArray(capture.material)) capture.material.dispose();
  }

  state.captures.length = 0;
  state.capturedFrom = [...roots];
  state.warmed = false;
  // Meshes that share a material share its capture too: every node graph built is preparation time.
  const clones = new Map<MeshPhysicalNodeMaterial, MeshPhysicalNodeMaterial>();

  for (const [index, root] of roots.entries()) {
    const ceiling = index === 0 ? Number.POSITIVE_INFINITY : rainCeiling;
    root.traverse((object) => {
      if (
        !(object instanceof Mesh) ||
        !(object.material instanceof MeshPhysicalNodeMaterial) ||
        !object.material.name.startsWith('stained-glass-')
      )
        return;

      let material = clones.get(object.material);

      if (material === undefined) {
        material = object.material.clone();
        clones.set(object.material, material);
        material.transmission = 0;
        // The rain composes its panes by multiplication; the capture wants the plain lit output.
        material.outputNode = null;
        material.premultipliedAlpha = false;
        // Retain the Slug shader's fractional analytic coverage instead of forcing opaque alpha to one.
        material.transparent = true;
        material.blending = NoBlending;
        material.depthWrite = true;
        material.alphaToCoverage = false;
        const plain = plainCoverageOf(object.material);

        if (plain !== undefined) material.opacityNode = plain;

        dress(material, index);
      }

      const capture = new Mesh(object.geometry, material);
      capture.matrixAutoUpdate = false;
      capture.frustumCulled = false;
      sourceScene.add(capture);
      state.captures.push({
        original: object,
        capture,
        ceiling,
        drawn: new Float32Array(16).fill(Number.NaN),
        shown: undefined,
      });
    });
  }
}

/**
 * Draw every pane once, showing or not, so its program compiles now, during preparation, rather than when the pane
 * first shows and the frame is already running: rain panes hide until play. Fresh captures have not been drawn, so
 * the real drawing follows in the same frame and replaces this one.
 */
function warmCaptures(state: GlassCapture, renderer: WebGPURenderer, target: RenderTarget, camera: Camera): void {
  if (state.warmed) return;

  for (const { original, capture } of state.captures) {
    capture.visible = true;
    capture.userData = original.userData;
    capture.matrix.copy(original.matrixWorld);
  }

  beginCapture(renderer);

  try {
    renderer.setRenderTarget(target);
    renderer.render(state.sourceScene, camera);
  } finally {
    endCapture(renderer);
  }

  state.warmed = true;
}

/**
 * Carry each capture to where its original is drawn, showing it only where the original and its ancestors show and
 * below its ceiling. Whether any capture moved, appeared, or left since it was last drawn.
 */
function trackCaptures(state: GlassCapture): boolean {
  let moved = false;

  for (const pane of state.captures) {
    const { original, capture } = pane;
    let visible = original.visible && original.parent !== null;

    for (let parent = original.parent; parent !== null && visible; parent = parent.parent) visible = parent.visible;

    capture.visible = visible && original.matrixWorld.elements[14]! < pane.ceiling;

    if (pane.shown !== capture.visible) {
      pane.shown = capture.visible;
      moved = true;
    }

    if (!capture.visible) continue;

    // Glyph uses this metadata to select the retained run. Ordinary extruded meshes have no such metadata.
    capture.userData = original.userData;
    capture.matrix.copy(original.matrixWorld);

    if (stirred(pane.drawn, original.matrixWorld.elements)) moved = true;
  }

  return moved;
}

const frameState = {
  target: null as RenderTarget | null,
  mrt: null as MRTNode | null,
  clear: new Color(),
  alpha: 1,
  autoClear: true,
};

/** Set the renderer up for a capture's own targets: cleared to nothing, with no frame MRT. */
function beginCapture(renderer: WebGPURenderer): void {
  frameState.target = renderer.getRenderTarget();
  frameState.mrt = renderer.getMRT();
  frameState.alpha = renderer.getClearAlpha();
  frameState.autoClear = renderer.autoClear;
  renderer.getClearColor(frameState.clear);
  renderer.autoClear = true;
  renderer.setClearColor(0, 0);
  renderer.setMRT(null);
}

/** Give the frame back the render state `beginCapture` found. */
function endCapture(renderer: WebGPURenderer): void {
  renderer.setRenderTarget(frameState.target);
  renderer.setMRT(frameState.mrt);
  renderer.setClearColor(frameState.clear, frameState.alpha);
  renderer.autoClear = frameState.autoClear;
}

/**
 * The shadow capture, drawn from the lamp: coverage-weighted tint, height, refractive index, dispersion, and lens
 * normals. The title is thick glass, and the lamp's slant sets its shadow off beside it by that thickness. A rain glyph
 * is a small thin pane: the same slab would shift its shadow by most of the glyph, so it casts as thin glass, keeping
 * its shadow under and just around it, and at two thirds of the title's weight so it reads as a shade.
 */
function dressShadow(material: MeshPhysicalNodeMaterial, source: number): void {
  material.name = 'glass-shadow-capture';
  material.alphaTest = 0;
  // Three supplies the existing glass attenuation values.
  const transmission = materialAttenuationColor.pow(vec3(materialThickness.div(materialAttenuationDistance)));
  const height = positionWorld.z.sub(SHADOW_RECEIVER_Z).max(0);
  // Every attachment is coverage-weighted, so blurring keeps it valid across the soft edge.
  const weight = diffuseColor.a.mul(source === 0 ? 1 : 0.65);
  const slab = source === 0 ? GLASS_DEPTH : RAIN_SLAB;
  material.mrtNode = mrt({
    output: vec4(transmission.mul(weight), weight),
    distance: vec4(height, materialIOR, materialDispersion, 1).mul(weight),
    normal: vec4(normalWorld.xy, slab / GLASS_DEPTH, 1).mul(weight),
  });
}

/** The lens capture, drawn from the scene camera: coverage-weighted normals, depth, refractive index, and slab. */
function dressLens(material: MeshPhysicalNodeMaterial, source: number): void {
  material.name = 'glass-lens-capture';
  // Only ink writes, so a glyph quad's clear margin cannot stand in front of the glass behind it.
  material.alphaTest = 0.02;
  // Every attachment is coverage-weighted, so filtering the capture keeps it valid across the soft edge.
  const weight = diffuseColor.a;
  material.mrtNode = mrt({
    pane: vec4(normalWorld.xy, positionView.z, 1).mul(weight),
    glass: vec4(materialIOR, source === 0 ? materialThickness : float(RAIN_SLAB), 0, 1).mul(weight),
  });
}

/** Update the mounted projection after title and rain matrices have reached their draw objects. */
export function updateGlassShadows(world: World): void {
  const state = world.get(ShadowView);

  if (state === undefined || world.queryFirst(Title, TitleView) === undefined) return;

  // Rain falls from near the camera: one glyph that high would stretch the march over the whole scene and coarsen
  // every shadow, so rain casts only over the last stretch of its fall. The hole bends every outline while it
  // pulls, so the capture is redrawn as long as it does.
  let moved = followGlass(world, state, shadowSources, SHADOW_RECEIVER_Z + 4, dressShadow) || uHoleBend.value > 0;
  state.scene.updateMatrixWorld(true);
  warmCaptures(state, state.renderer, state.source, state.lightCamera);
  moved = trackCaptures(state) || moved;
  state.uTime.value = world.get(Time)!.elapsed;
  let reach = GLASS_DEPTH;

  for (const { original, capture } of state.captures) {
    if (!capture.visible) continue;

    // The highest this letter can reach: its centre, plus however far its tilt lifts a corner.
    const { elements } = original.matrixWorld;
    const tilt = (Math.abs(elements[2]!) + Math.abs(elements[6]!)) * 2.4;
    reach = Math.max(reach, elements[14]! + tilt - SHADOW_RECEIVER_Z + GLASS_DEPTH / 2);
  }

  const title = world.queryFirst(Title)!.get(Title)!;
  reach = Math.max(reach, title.reach - SHADOW_RECEIVER_Z + GLASS_DEPTH / 2);

  if (!(Math.abs(state.uReach.value - reach) <= 1e-4)) {
    state.uReach.value = reach;
    moved = true;
  }

  // The robot is handed over even while it is hidden, so its caster can be drawn once to compile.
  const caster = world.queryFirst(RobotView)?.get(RobotView)?.root;
  // A caster on the move, and it is never still while it shows, redraws the capture; so does its leaving.
  const casting = caster !== undefined && caster.visible;
  // Every caster is drawn once, even one not showing yet, so its program compiles during preparation rather than
  // when it first appears and the frame is already running.
  const warming = !state.castersBuilt && caster !== undefined;

  if (casting || warming || state.castersDrawn) moved = true;

  state.castersDrawn = casting;
  const { renderer, sourceScene, source, lightCamera, caustic, causticScene } = state;
  beginCapture(renderer);

  try {
    // The warming draw is thrown away by the real one below, which follows it in the same frame.
    if (warming && caster !== undefined) {
      const shownCaster = caster.visible;
      caster.visible = true;
      renderer.setRenderTarget(source);
      renderer.render(sourceScene, lightCamera);
      drawCasters(state);
      caster.visible = shownCaster;
      state.castersBuilt = true;
    }

    if (moved) {
      renderer.setRenderTarget(source);
      renderer.render(sourceScene, lightCamera);

      // The casters join the same capture, over the glass render's depth, from the scene they live in.
      if (casting) drawCasters(state);

      // A blur node is set up by the first draw that reads it, so the first projection draws both readers once
      // before it can run the blurs by hand.
      if (!state.built) {
        renderer.setRenderTarget(state.shadowTarget);
        renderer.render(state.marchScene, lightCamera);
        renderer.setRenderTarget(caustic);
        renderer.render(causticScene, lightCamera);
        state.built = true;
      }

      // The blur nodes ask their frame only for the renderer.
      for (const node of state.sourceBlurs) node.updateBefore({ renderer } as unknown as NodeFrame);

      renderer.setRenderTarget(state.shadowTarget);
      renderer.render(state.marchScene, lightCamera);
    }

    // The caustics' facets turn with time, so they are drawn every frame from the blurred capture as it stands.
    renderer.setRenderTarget(caustic);
    renderer.render(causticScene, lightCamera);
  } finally {
    endCapture(renderer);
  }
}

/** Draw the opaque casters over the glass capture, from the scene they live in, under the lamp. */
function drawCasters(state: Projection): void {
  const { renderer, scene, lightCamera } = state;
  const overridden = scene.overrideMaterial;
  const background = scene.background;
  scene.overrideMaterial = state.casterMaterial;
  // The scene's background would be drawn into the capture as pale glass everywhere, washing the frame out.
  scene.background = null;
  lightCamera.layers.set(SHADOW_CASTER_LAYER);
  renderer.autoClear = false;

  try {
    renderer.render(scene, lightCamera);
  } finally {
    renderer.autoClear = true;
    lightCamera.layers.set(0);
    scene.background = background;
    scene.overrideMaterial = overridden;
  }
}

/** Draw the lens capture after title and rain matrices have reached their draw objects, before the frame. */
export function updateGlassLens(world: World): void {
  const state = world.get(LensView);

  if (state === undefined || world.queryFirst(Title, TitleView) === undefined) return;

  // The hole bends every outline while it pulls, so the capture is redrawn as long as it does.
  let moved = followGlass(world, state, lensSources, Number.POSITIVE_INFINITY, dressLens) || uHoleBend.value > 0;
  warmCaptures(state, state.renderer, lensTarget, state.camera);
  moved = trackCaptures(state) || moved;
  moved = fitLensTarget(state) || moved;

  // Glass that has not moved is captured already.
  if (!moved) return;

  beginCapture(state.renderer);

  try {
    state.renderer.setRenderTarget(lensTarget);
    state.renderer.render(state.sourceScene, state.camera);
  } finally {
    endCapture(state.renderer);
  }
}

/** Keep the lens target at its share of the drawing buffer. Whether it was resized, which empties it. */
function fitLensTarget(state: Lens): boolean {
  state.renderer.getDrawingBufferSize(drawingBuffer);
  const width = Math.max(1, Math.round(drawingBuffer.x * SCALE));
  const height = Math.max(1, Math.round(drawingBuffer.y * SCALE));

  if (lensTarget.width === width && lensTarget.height === height) return false;

  lensTarget.setSize(width, height);

  return true;
}
