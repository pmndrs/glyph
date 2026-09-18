import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useRef } from 'react';
import {
  abs,
  cos,
  dFdx,
  dFdy,
  diffuseColor,
  float,
  Fn,
  If,
  Loop,
  materialAttenuationColor,
  materialAttenuationDistance,
  materialDispersion,
  materialIOR,
  materialThickness,
  mix,
  mrt,
  mx_cell_noise_float,
  normalWorld,
  positionGeometry,
  positionWorld,
  refract,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  HalfFloatType,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MultiplyBlending,
  NoBlending,
  type Node,
  NodeUpdateType,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';

import { heroReady } from '../startup';
import { uTime } from '../uniforms';
import { titleReach } from './metrics';

/** Where the shadow's light stands, in world units: a lamp above the top of the lift, a little to the upper right,
 * so a resting letter's shadow sits under it with a slight lean down and to the left, and a lifted letter's shadow
 * grows and spreads beneath it the way the letter grows on screen. The camera never moves, so the lamp can sit on
 * its axis without ever looking wrong. Its own light, not the studio's: the glass keeps its highlights. */
const LAMP = new Vector3(4, 6, 24);
/** The receiving plane, in world units, centred on the title. */
const WIDTH = 32;
const HEIGHT = 20;
/** One apparent receiving surface, just behind the flat letters and in front of the patterned parallax layers. */
const RECEIVER_Z = -0.06;
/** The slab of glass each flat letter is taken to be: how far its shadow is thrown, and how far the light travels
 * inside it before it reaches the floor. */
const GLASS_DEPTH = 1.2;
/** Half a letter's extent, for how high a tumbling letter can reach above its centre. */
const LETTER_REACH = 2.4;
/** Height samples the receiver takes toward the light, spaced quadratically: dense at the floor where the resting
 * shadow's edge lives, and still within a slab's depth of each other at the top of a lift. */
const MARCH_STEPS = 32;
/** Fraction of the key light the glass turns aside: the darkness of the shadow before the caustics refill it. */
const SHADE = 0.3;
/** The capture blurred at four widths, in capture texels at full resolution: the resting shadow's edge, then
 * ever wider penumbras taken at falling resolution. The march blends between neighbouring levels by height. */
const PYRAMID = [
  { scale: 1, direction: 2, sigma: 2 },
  { scale: 0.5, direction: 2, sigma: 4 },
  { scale: 0.25, direction: 2, sigma: 4 },
  { scale: 0.125, direction: 3, sigma: 4 },
] as const;
/** Pyramid levels per unit of height: the lamp has a width, so a lifted letter's shadow softens and thins as it
 * spreads, reaching the widest level near the top of the lift. */
const LIFT_SPREAD = 0.22;
/** How much sky the floor still sees under a lifted letter: the shadow fades by this much per unit of height. */
const FADE = 0.03;
/** The pane's own lens tilt is subtle on screen; the light bending through it is exaggerated so it focuses. */
const LENS_GAIN = 2;
/** An edge chamfer: the top surface slopes off toward the silhouette, so rays near the edge bend inward and pile
 * up into a bright rim inside the shadow, the way a cut edge of glass throws a line of light. */
const BEVEL = 0.6;
/** Facets: the top surface is cut into cells of two overlaid lattices, each with its own tilt, so the light lands
 * as sharp-edged shards that overlap and part, the way a crystal throws it. Each facet turns slowly so they glint. */
const FACET = 0.3;
const FACET_CELLS = [
  { size: 0.55, angle: 0.2, seed: 3 },
  { size: 0.95, angle: 1.1, seed: 17 },
] as const;
const SHIMMER = 0.35;
/** Spread of refractive index across the red, green, and blue channels per unit of material dispersion. */
const DISPERSION = 0.09;
/** How bright the refracted light is against the paper. */
const CAUSTIC_GAIN = 0.45;
/** Folds in the refraction map converge to a line; this keeps the line bright without blowing out. */
const CAUSTIC_CEILING = 5;
const CAPTURE_WIDTH = 1024;
const CAPTURE_HEIGHT = 640;
/** Vertices of the warped light grid across the receiving plane: about sixteen per world unit. */
const GRID_COLUMNS = 512;
const GRID_ROWS = 320;

/** The capture is a straight-down orthographic view over the receiving plane, so its texels are world x and y. */
function captureUV(world: Node<'vec2'>) {
  // Camera clip space is bottom-up; WebGPU render textures are top-down.
  return vec2(world.x.div(WIDTH).add(0.5), world.y.div(HEIGHT).add(0.5)).flipY();
}

/**
 * The glass title's shadow and caustics on the paper behind it, under an overhead light of its own.
 *
 * The letters are captured once per frame straight down as a height field: analytic coverage, transmitted tint,
 * height above the receiver, refractive index, dispersion, and the pane's lens normal. From that field the receiver
 * marches each of its pixels toward the light through the slab of glass every letter is taken to be, so the flat
 * glyphs throw an extruded shadow off to one side, tinted by the glass it passes through. The light the glass
 * turns aside is put back as caustics: a fine grid over the plane is carried in the vertex shader to where each
 * ray lands after refracting through the lens normal and the edge chamfer, once per colour channel, and its
 * brightness is how much source area gathers in each pixel, so the light pools where the rays converge and its
 * colours split where the index differs.
 */
function createProjection(renderer: WebGPURenderer, scene: Scene) {
  const sourceScene = new Scene();
  const lightCamera = new OrthographicCamera(-WIDTH / 2, WIDTH / 2, HEIGHT / 2, -HEIGHT / 2, 0.1, 80);
  lightCamera.position.set(0, 0, 25);
  lightCamera.lookAt(0, 0, 0);
  lightCamera.updateMatrixWorld();
  const source = new RenderTarget(CAPTURE_WIDTH, CAPTURE_HEIGHT, { type: HalfFloatType, count: 3 });
  source.texture.name = 'output';
  const [, distanceTexture, normalTexture] = source.textures;
  if (distanceTexture === undefined || normalTexture === undefined) {
    throw new Error('Missing glass projection attachments');
  }
  distanceTexture.name = 'distance';
  normalTexture.name = 'normal';
  const caustic = new RenderTarget(CAPTURE_WIDTH, CAPTURE_HEIGHT, { type: HalfFloatType });
  caustic.texture.name = 'caustic';

  // Kernel widths in capture texels, thirty-two to the world unit: a chamfer a quarter unit wide, lens normals
  // smooth enough that the grid warp stays continuous, and the pyramid the march reads by height.
  const spread = PYRAMID.map(({ scale, direction, sigma }) => {
    const coverage = gaussianBlur(texture(source.texture), direction, sigma);
    const heights = gaussianBlur(texture(distanceTexture), direction, sigma);
    coverage.resolutionScale = scale;
    heights.resolutionScale = scale;
    return { coverage, heights };
  });
  const penumbra = gaussianBlur(texture(source.texture), 1, 4);
  const normalBlur = gaussianBlur(texture(normalTexture), 2, 3);
  const causticBlur = gaussianBlur(texture(caustic.texture), 2, 2);
  penumbra.resolutionScale = 0.5;
  const blurs = [...spread.flatMap(({ coverage, heights }) => [coverage, heights]), penumbra, normalBlur, causticBlur];
  // Captures may change between renders within one animation frame, including deterministic readbacks.
  for (const node of blurs) node.updateBeforeType = NodeUpdateType.RENDER;
  const [finest] = spread;
  if (finest === undefined) throw new Error('Missing glass shadow pyramid');
  const coverage = finest.coverage.getTextureNode();
  const wide = penumbra.getTextureNode();
  const heights = finest.heights.getTextureNode();
  const normals = normalBlur.getTextureNode();

  const uLamp = uniform(new Vector3());
  /** How far above the receiver the highest glass reaches this frame. */
  const uReach = uniform(GLASS_DEPTH);
  const halfPlane = vec2(WIDTH / 2, HEIGHT / 2);

  // The light grid, warped per channel to where the refracted rays land.
  const causticScene = new Scene();
  const gridGeometry = new PlaneGeometry(2, 2, GRID_COLUMNS, GRID_ROWS);
  const causticMaterials = [0, 1, 2].map((channel) => {
    const material = new MeshBasicNodeMaterial({
      name: `glass-caustic-${channel}`,
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    const world = positionGeometry.xy.mul(halfPlane);
    const uv = captureUV(world);
    const sample = coverage.sample(uv);
    const weight = sample.a.max(0.0001);
    const tint = sample.rgb.div(weight);
    const field = heights.sample(uv);
    const height = field.r.div(weight);
    const ior = field.g.div(weight).max(1);
    const dispersion = field.b.div(weight);
    const lens = normals.sample(uv).xy.div(weight);
    // The chamfer follows the silhouette's outward direction, from the wide blur's gradient.
    const texel = vec2(1 / CAPTURE_WIDTH, 1 / CAPTURE_HEIGHT).mul(2);
    const gradient = vec2(
      wide.sample(uv.add(vec2(texel.x, 0))).a.sub(wide.sample(uv.sub(vec2(texel.x, 0))).a),
      wide.sample(uv.add(vec2(0, texel.y))).a.sub(wide.sample(uv.sub(vec2(0, texel.y))).a),
    );
    const inward = gradient.div(gradient.length().max(0.00001));
    // The wide blur passes one half at the true edge and reaches one well inside.
    const chamfer = smoothstep(0.98, 0.5, wide.sample(uv).a);
    // Texture rows run top-down, so the gradient's y points the other way in world space.
    const outward = vec2(inward.x.negate(), inward.y).mul(chamfer.mul(BEVEL));
    const facets = FACET_CELLS.map(({ size, angle, seed }) => {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const lattice = vec2(world.x.mul(c).sub(world.y.mul(s)), world.x.mul(s).add(world.y.mul(c))).div(size);
      const spin = mx_cell_noise_float(vec3(lattice, seed));
      const rate = mx_cell_noise_float(vec3(lattice, seed + 11));
      const heading = spin.mul(Math.PI * 2).add(uTime.mul(rate.sub(0.5).mul(SHIMMER)));
      return vec2(cos(heading), sin(heading)).mul(rate.mul(0.6).add(0.4));
    }).reduce((sum, tilt) => sum.add(tilt));
    const normal = vec3(lens.mul(LENS_GAIN).add(outward).add(facets.mul(FACET)), 1).normalize();
    const channelIOR = ior.add(dispersion.mul(DISPERSION * (channel - 1)));
    const base = height.sub(GLASS_DEPTH / 2).max(0);
    const incident = vec3(world, base.add(GLASS_DEPTH)).sub(uLamp).normalize();
    const inside = refract(incident, normal, float(1).div(channelIOR));
    // Through the slab along the refracted ray, out of its flat underside into air, then down to the receiver: a
    // lifted letter's glints spread with its height, and the gathered area dims them to match.
    const exit = refract(inside, vec3(0, 0, 1), channelIOR);
    const landing = world
      .add(inside.xy.mul(GLASS_DEPTH).div(inside.z.negate().max(0.05)))
      .add(exit.xy.mul(base).div(exit.z.negate().max(0.05)));
    material.vertexNode = vec4(landing.div(halfPlane), 0, 1);
    const origin = varying(world);
    const vCoverage = varying(sample.a);
    const vTint = varying(tint);
    // Source area gathered per receiver pixel, against the unwarped grid's own area per pixel.
    const gathered = abs(
      dFdx(origin)
        .x.mul(dFdy(origin).y)
        .sub(dFdx(origin).y.mul(dFdy(origin).x)),
    );
    const pixelArea = (WIDTH / CAPTURE_WIDTH) * (HEIGHT / CAPTURE_HEIGHT);
    const intensity = gathered.div(pixelArea).min(CAUSTIC_CEILING).mul(vCoverage);
    const mask = vec3(channel === 0 ? 1 : 0, channel === 1 ? 1 : 0, channel === 2 ? 1 : 0);
    material.fragmentNode = vec4(mask.mul(vTint).mul(intensity), 1);
    const grid = new Mesh(gridGeometry, material);
    grid.frustumCulled = false;
    causticScene.add(grid);
    return material;
  });

  // The receiver: the shadow marched toward the light, and the caustics laid back over it.
  const projectionMaterial = new MeshBasicNodeMaterial({
    name: 'glass-shadows',
    transparent: true,
    depthWrite: false,
    blending: MultiplyBlending,
    premultipliedAlpha: true,
    toneMapped: false,
  });
  const point = positionWorld.xy;
  // Marched inside an Fn: TSL control flow only exists on a stack, and there is none at graph-build top level.
  const shadow = Fn(() => {
    const cover = float(0).toVar();
    const through = vec3(1).toVar();
    Loop(MARCH_STEPS, ({ i }) => {
      const fraction = float(i).add(0.5).div(MARCH_STEPS);
      const t = fraction.mul(fraction).mul(uReach);
      const uv = captureUV(point.add(uLamp.xy.sub(point).mul(t.div(uLamp.z))));
      const bounds = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
      // Blend the two pyramid levels either side of this height.
      const level = t.mul(LIFT_SPREAD).clamp(0, PYRAMID.length - 1);
      const sample = vec4(0).toVar();
      const field = float(0).toVar();
      const blend = (lower: number) => () => {
        const amount = level.sub(lower);
        const from = spread[lower];
        const to = spread[lower + 1];
        if (from === undefined || to === undefined) throw new Error('Missing glass shadow pyramid level');
        sample.assign(mix(from.coverage.getTextureNode().sample(uv), to.coverage.getTextureNode().sample(uv), amount));
        field.assign(mix(from.heights.getTextureNode().sample(uv).r, to.heights.getTextureNode().sample(uv).r, amount));
      };
      If(level.lessThan(1), blend(0)).ElseIf(level.lessThan(2), blend(1)).Else(blend(2));
      const weight = sample.a.max(0.0001);
      const base = field
        .div(weight)
        .sub(GLASS_DEPTH / 2)
        .max(0);
      const inside = sample.a
        .mul(step(base, t))
        .mul(step(t, base.add(GLASS_DEPTH)))
        .mul(bounds)
        .div(t.mul(FADE).add(1));
      If(inside.greaterThan(cover), () => {
        cover.assign(inside);
        through.assign(sample.rgb.div(weight));
      });
    });
    return mix(vec3(1), through.mul(1 - SHADE), cover);
  })();
  const pooled = causticBlur.getTextureNode().sample(captureUV(point)).rgb;
  projectionMaterial.fragmentNode = vec4(shadow.add(pooled.mul(CAUSTIC_GAIN)), 1);
  const receiverGeometry = new PlaneGeometry(WIDTH, HEIGHT);
  const receiver = new Mesh(receiverGeometry, projectionMaterial);
  receiver.name = 'glass-shadows';
  receiver.position.z = RECEIVER_Z;
  receiver.renderOrder = 1;
  scene.add(receiver);
  // Development-only handle for reading the intermediate buffers from DevTools and the buffer probe.
  if (import.meta.env.DEV) {
    Object.assign(globalThis, { heroGlassShadows: { source, caustic, causticScene, lightCamera, receiver, spread } });
  }

  return {
    renderer,
    scene,
    sourceScene,
    causticScene,
    lightCamera,
    source,
    caustic,
    uLamp,
    uReach,
    receiver,
    receiverGeometry,
    projectionMaterial,
    causticMaterials,
    gridGeometry,
    blurs,
    captures: [] as { original: Mesh; capture: Mesh }[],
    known: new Set<Mesh>(),
    clear: new Color(),
  };
}
type Projection = ReturnType<typeof createProjection>;

/** Discover the retained title draws during warm-up. Playback uses the prepared list directly. */
function discoverCaptures(state: Projection): void {
  const { sourceScene } = state;
  state.scene.traverseVisible((object) => {
    if (
      !(object instanceof Mesh) ||
      !(object.material instanceof MeshPhysicalNodeMaterial) ||
      !object.material.name.startsWith('stained-glass-') ||
      state.known.has(object)
    )
      return;
    const material = object.material.clone();
    material.name = 'glass-shadow-capture';
    material.transmission = 0;
    // Retain the Slug shader's fractional analytic coverage instead of forcing opaque alpha to one.
    material.transparent = true;
    material.blending = NoBlending;
    material.depthWrite = true;
    material.alphaToCoverage = false;
    material.alphaTest = 0;
    // Preserve the original deformation and coverage. Three supplies the existing glass attenuation values.
    const transmission = materialAttenuationColor.pow(vec3(materialThickness.div(materialAttenuationDistance)));
    const height = positionWorld.z.sub(RECEIVER_Z).max(0);
    // Every attachment is coverage-weighted, so blurring keeps it valid across the soft edge.
    material.mrtNode = mrt({
      output: vec4(transmission.mul(diffuseColor.a), diffuseColor.a),
      distance: vec4(height, materialIOR, materialDispersion, 1).mul(diffuseColor.a),
      normal: vec4(normalWorld.xy, 0, 1).mul(diffuseColor.a),
    });
    const capture = new Mesh(object.geometry, material);
    capture.matrixAutoUpdate = false;
    capture.frustumCulled = false;
    sourceScene.add(capture);
    state.captures.push({ original: object, capture });
    state.known.add(object);
  });
}

function updateProjection(state: Projection): void {
  const { scene, renderer, uLamp, uReach, source, sourceScene, caustic, causticScene, lightCamera, clear } = state;
  scene.updateMatrixWorld(true);
  uLamp.value.copy(LAMP);
  if (!heroReady()) discoverCaptures(state);
  let reach = GLASS_DEPTH;
  for (let index = 0; index < state.captures.length; index++) {
    const { original: object, capture } = state.captures[index]!;
    let visible = object.visible;
    let parent = object.parent;
    while (parent !== null && visible) {
      visible = parent.visible;
      parent = parent.parent;
    }
    capture.visible = visible && object.parent !== null;
    if (!capture.visible || !(object.material instanceof MeshPhysicalNodeMaterial)) continue;
    if (capture.material instanceof MeshPhysicalNodeMaterial) {
      capture.material.ior = object.material.ior;
      capture.material.dispersion = object.material.dispersion;
      capture.material.thickness = object.material.thickness;
      capture.material.attenuationColor.copy(object.material.attenuationColor);
      capture.material.attenuationDistance = object.material.attenuationDistance;
    }
    // Glyph uses this metadata to select the retained run; ordinary extruded meshes have no such metadata.
    capture.userData = object.userData;
    capture.matrix.copy(object.matrixWorld);
    // The highest this letter can reach: its centre, plus however far its tilt lifts a corner.
    const { elements } = object.matrixWorld;
    const tilt = (Math.abs(elements[2] ?? 0) + Math.abs(elements[6] ?? 0)) * LETTER_REACH;
    reach = Math.max(reach, (elements[14] ?? 0) + tilt - RECEIVER_Z + GLASS_DEPTH / 2);
  }
  uReach.value = Math.max(reach, titleReach() - RECEIVER_Z + GLASS_DEPTH / 2);
  const previousTarget = renderer.getRenderTarget();
  const previousMRT = renderer.getMRT();
  const previousAlpha = renderer.getClearAlpha();
  const previousAutoClear = renderer.autoClear;
  renderer.getClearColor(clear);
  try {
    renderer.autoClear = true;
    renderer.setClearColor(0, 0);
    renderer.setMRT(null);
    renderer.setRenderTarget(source);
    renderer.render(sourceScene, lightCamera);
    renderer.setRenderTarget(caustic);
    renderer.render(causticScene, lightCamera);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setMRT(previousMRT);
    renderer.setClearColor(clear, previousAlpha);
    renderer.autoClear = previousAutoClear;
  }
}

function disposeProjection(state: Projection): void {
  state.scene.remove(state.receiver);
  for (const { capture } of state.captures) if (!Array.isArray(capture.material)) capture.material.dispose();
  state.source.dispose();
  state.caustic.dispose();
  for (const node of state.blurs) node.dispose();
  for (const material of state.causticMaterials) material.dispose();
  state.gridGeometry.dispose();
  state.receiverGeometry.dispose();
  state.projectionMaterial.dispose();
}

export function GlassShadows() {
  const renderer = useThree((state) => state.renderer);
  const scene = useThree((state) => state.scene);
  const projection = useRef<ReturnType<typeof createProjection> | null>(null);
  useEffect(() => {
    const owned = createProjection(renderer, scene);
    projection.current = owned;
    return () => {
      projection.current = null;
      disposeProjection(owned);
    };
  }, [renderer, scene]);
  useFrame(
    () => {
      if (projection.current !== null) updateProjection(projection.current);
    },
    {
      id: 'hero-glass-shadows',
      phase: 'update',
      after: ['hero-title-motion'],
      // Canvas's FPS limit applies only to its default render job, not this offscreen pass.
      fps: 60,
    },
  );
  return null;
}
