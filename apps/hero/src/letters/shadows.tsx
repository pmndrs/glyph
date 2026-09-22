import { useThree } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';
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
  type NodeFrame,
  NodeUpdateType,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import { useWorld } from 'koota/react';
import { Title, ShadowView, TitleView } from './traits';
import { RainView } from '../rain/traits';
import { Time } from '../time/traits';
import { letterActions } from './actions';
import { uHoleBend, uHoleCamera } from '../black-hole/materials';
import { plainCoverageOf, stirred } from './lens';
import { SHADOW_CASTER_LAYER, SHADOW_LAMP, SHADOW_RECEIVER_Z } from './content';
import { RobotView } from '../robot/traits';
import { Collapse, type HoleState } from '../black-hole/traits';
import type { World } from 'koota';

/** Projection lamp above the title. Its offset makes lifted shadows spread down and left. */
const LAMP = new Vector3(...SHADOW_LAMP);
/** The receiving plane, in world units, centred on the title. */
const WIDTH = 32;
const HEIGHT = 20;
/** One apparent receiving surface, just behind the flat letters and in front of the patterned parallax layers. */
const RECEIVER_Z = SHADOW_RECEIVER_Z;
/** Apparent slab thickness used by shadow marching and refraction. */
const GLASS_DEPTH = 1.2;
/**
 * How high over the paper the black hole casts, which is where it is drawn. The march's samples are spaced
 * quadratically, so reaching this far still leaves more than half of them under the letters. From up here the
 * lamp's slant throws its shadow well down and to the left of it, clear of the hole itself.
 */
const HOLE_CAST_Z = 5;

/** 0..1: how darkly the hole shades the paper. The finale check turns it off for its control. */
export const uHoleShadow = uniform(1);
/** Quadratic height samples concentrate shadow detail near the floor. */
const MARCH_STEPS = 32;
/** Blur levels for height-dependent penumbra sampling. */
const PYRAMID = [
  { scale: 1, direction: 2, sigma: 2 },
  { scale: 0.5, direction: 2, sigma: 4 },
  { scale: 0.25, direction: 2, sigma: 4 },
  { scale: 0.125, direction: 3, sigma: 4 },
] as const;
const FACET_CELLS = [
  { size: 0.55, angle: 0.2, seed: 3 },
  { size: 0.95, angle: 1.1, seed: 17 },
] as const;
const CAPTURE_WIDTH = 1024;
const CAPTURE_HEIGHT = 640;

/**
 * How thick the glass at a texel is: the title's full slab, or the rain's thin one, from the coverage-weighted
 * ratio the normal capture carries, normalized by the coverage `weight` like the normals are. Where the coverage
 * has thinned to a soft edge the full slab stands in, so the title's penumbra is exactly what it was.
 */
function slabAt(sample: Node<'vec4'>, weight: Node<'float'>): Node<'float'> {
  const ratio = sample.z.div(weight);

  return mix(float(GLASS_DEPTH), ratio.mul(GLASS_DEPTH), smoothstep(0.05, 0.4, weight));
}

/** The capture is a straight-down orthographic view over the receiving plane, so its texels are world x and y. */
function captureUV(world: Node<'vec2'>) {
  // Camera clip space is bottom-up. WebGPU render textures are top-down.
  return vec2(world.x.div(WIDTH).add(0.5), world.y.div(HEIGHT).add(0.5)).flipY();
}

/**
 * Capture coverage, tint, height, refractive index, dispersion, and lens normals. March that field toward the
 * lamp for shadows. Refract a light grid per color channel for caustics, with brightness set by gathered source
 * area.
 */
function createProjection(renderer: WebGPURenderer, scene: Scene) {
  const uTime = uniform(0);
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

  // Blur capture texels for the edge chamfer, lens normals, and height-dependent penumbra.
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
  const sourceBlurs = [...spread.flatMap(({ coverage, heights }) => [coverage, heights]), penumbra, normalBlur];
  const blurs = [...sourceBlurs, causticBlur];

  // The source blurs run only when the capture is redrawn, by hand; the caustic's follows each caustic render,
  // which may happen more than once in an animation frame, as in deterministic readbacks.
  for (const node of sourceBlurs) node.updateBeforeType = NodeUpdateType.NONE;

  causticBlur.updateBeforeType = NodeUpdateType.RENDER;

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
  // Eight texels of the capture a cell: the warped grid is blurred after, so finer cells add nothing.
  const gridGeometry = new PlaneGeometry(2, 2, 128, 80);

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
    const lensSample = normals.sample(uv);
    const lens = lensSample.xy.div(weight);
    const slab = slabAt(lensSample, weight);
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
    const outward = vec2(inward.x.negate(), inward.y).mul(chamfer.mul(0.6));

    const facets = FACET_CELLS.map(({ size, angle, seed }) => {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const lattice = vec2(world.x.mul(c).sub(world.y.mul(s)), world.x.mul(s).add(world.y.mul(c))).div(size);
      const spin = mx_cell_noise_float(vec3(lattice, seed));
      const rate = mx_cell_noise_float(vec3(lattice, seed + 11));
      const heading = spin.mul(Math.PI * 2).add(uTime.mul(rate.sub(0.5).mul(0.35)));

      return vec2(cos(heading), sin(heading)).mul(rate.mul(0.6).add(0.4));
    }).reduce((sum, tilt) => sum.add(tilt));

    const normal = vec3(lens.mul(2).add(outward).add(facets.mul(0.3)), 1).normalize();
    const channelIOR = ior.add(dispersion.mul(0.09 * (channel - 1)));
    const base = height.sub(slab.div(2)).max(0);
    const incident = vec3(world, base.add(slab)).sub(uLamp).normalize();
    const inside = refract(incident, normal, float(1).div(channelIOR));
    // Refract through the slab and onto the receiver. Height spreads the caustics while gathered area controls
    // brightness.
    const exit = refract(inside, vec3(0, 0, 1), channelIOR);
    const landing = world
      .add(inside.xy.mul(slab).div(inside.z.negate().max(0.05)))
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
    const intensity = gathered.div(pixelArea).min(5).mul(vCoverage);
    const mask = vec3(channel === 0 ? 1 : 0, channel === 1 ? 1 : 0, channel === 2 ? 1 : 0);
    material.fragmentNode = vec4(mask.mul(vTint).mul(intensity), 1);
    const grid = new Mesh(gridGeometry, material);
    grid.frustumCulled = false;
    causticScene.add(grid);

    return material;
  });

  // Opaque casters, the robot, drawn into the capture from the main scene through this override on their own
  // layer: skinning and joints come with the objects, which clones would lose. No tint, so they pool no light,
  // and a little over half the weight, so their shade reads beside the tinted glass rather than as a hole.
  const casterMaterial = new MeshBasicNodeMaterial({ name: 'glass-shadow-caster', side: DoubleSide });
  {
    const weight = float(0.55);
    const height = positionWorld.z.sub(RECEIVER_Z).max(0);
    casterMaterial.mrtNode = mrt({
      output: vec4(0, 0, 0, 1).mul(weight),
      distance: vec4(height, 1, 0, 1).mul(weight),
      normal: vec4(0, 0, 1, 1).mul(weight),
    });
  }

  // The hole swallows every ray that falls on it: a disk the size of its drawn core, black to the last and
  // fading out over its outer half, with no tint so it pools no light either. Its own presence fades the disk in and out with the hole.
  const uHolePresence = uniform(0);
  const holeMaterial = new MeshBasicNodeMaterial({ name: 'glass-shadow-hole', side: DoubleSide });
  holeMaterial.transparent = true;
  holeMaterial.blending = NoBlending;
  holeMaterial.depthWrite = true;
  // Only the disk writes, so the quad's clear corners cannot punch the glass behind it out of the capture.
  holeMaterial.alphaTest = 0.02;
  holeMaterial.opacityNode = smoothstep(1, 0.45, positionGeometry.xy.length()).mul(uHolePresence).mul(uHoleShadow);
  {
    const weight = diffuseColor.a;
    const height = positionWorld.z.sub(RECEIVER_Z).max(0);
    holeMaterial.mrtNode = mrt({
      output: vec4(0, 0, 0, 1).mul(weight),
      distance: vec4(height, 1, 0, 1).mul(weight),
      normal: vec4(0, 0, 1, 1).mul(weight),
    });
  }
  // The unit quad spans minus one to one, so the disk's rim is the horizon once scaled.
  const holeGeometry = new PlaneGeometry(2, 2);
  const holeCaster = new Mesh(holeGeometry, holeMaterial);
  holeCaster.frustumCulled = false;
  holeCaster.visible = false;
  sourceScene.add(holeCaster);

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
      const level = t.mul(0.22).clamp(0, PYRAMID.length - 1);
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
      const slab = slabAt(normals.sample(uv), weight);
      const base = field.div(weight).sub(slab.div(2)).max(0);
      const inside = sample.a
        .mul(step(base, t))
        .mul(step(t, base.add(slab)))
        .mul(bounds)
        .div(t.mul(0.03).add(1));

      If(inside.greaterThan(cover), () => {
        cover.assign(inside);
        through.assign(sample.rgb.div(weight));
      });
    });

    return mix(vec3(1), through.mul(1 - 0.3), cover);
  })();

  // The march is drawn once over the receiving plane into a texture, at the capture's resolution, which is all
  // the detail the blurred capture holds, and only when the glass or the hole has moved. The receiver reads it
  // back with one sample a pixel, so the march costs the plane's texels rather than every screen pixel.
  const shadowTarget = new RenderTarget(CAPTURE_WIDTH, CAPTURE_HEIGHT);
  shadowTarget.texture.name = 'shadow';
  const marchMaterial = new MeshBasicNodeMaterial({ name: 'glass-shadow-march', toneMapped: false });
  marchMaterial.fragmentNode = vec4(shadow, 1);
  const marchGeometry = new PlaneGeometry(WIDTH, HEIGHT);
  const march = new Mesh(marchGeometry, marchMaterial);
  march.frustumCulled = false;
  const marchScene = new Scene();
  marchScene.add(march);
  const pooled = causticBlur.getTextureNode().sample(captureUV(point)).rgb;
  const marched = texture(shadowTarget.texture).sample(captureUV(point)).rgb;
  projectionMaterial.fragmentNode = vec4(marched.add(pooled.mul(0.45)), 1);
  const receiverGeometry = new PlaneGeometry(WIDTH, HEIGHT);
  const receiver = new Mesh(receiverGeometry, projectionMaterial);
  receiver.name = 'glass-shadows';
  receiver.position.z = RECEIVER_Z;
  receiver.renderOrder = 1;
  scene.add(receiver);

  return {
    renderer,
    scene,
    sourceScene,
    causticScene,
    lightCamera,
    source,
    caustic,
    shadowTarget,
    marchScene,
    marchMaterial,
    marchGeometry,
    sourceBlurs,
    casterMaterial,
    holeCaster,
    holeMaterial,
    holeGeometry,
    uHolePresence,
    /** Whether an opaque caster was drawn last time, so its leaving is a change too. */
    castersDrawn: false,
    /** Whether every caster has been drawn once, which compiles their programs during preparation. */
    castersBuilt: false,
    /** Each capture's visibility, world matrix, and glass values as last drawn, to tell a moved glass from a still one. */
    previous: new Float32Array(0),
    /** The title's letter transforms as last drawn: they live in one instanced draw whose own matrix never moves. */
    letters: new Float64Array(0),
    /** Whether the march and caustic readers have been drawn, which sets up the blur nodes they read. */
    built: false,
    uLamp,
    uReach,
    uTime,
    receiver,
    receiverGeometry,
    projectionMaterial,
    causticMaterials,
    gridGeometry,
    blurs,
    captures: [] as { original: Mesh; capture: Mesh; ceiling: number }[],
    /** The draw groups the captures were taken from. A new group, as after a remount, is captured afresh. */
    capturedFrom: [] as Object3D[],
    clear: new Color(),
  };
}

export type Projection = ReturnType<typeof createProjection>;

const sources: Object3D[] = [];
const NO_LETTERS = new Float64Array(0);

/** Update the mounted projection after title and rain matrices have reached their draw objects. */
export function updateGlassShadows(world: World): void {
  world.query(Title, TitleView, ShadowView).readEach(([title, draws, view]) => {
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

    state.uTime.value = world.get(Time)!.elapsed;
    const letters = title.bodies?.matrices ?? NO_LETTERS;

    if (state.letters.length !== letters.length) state.letters = new Float64Array(letters.length).fill(Number.NaN);

    const stirredLetters = stirred(state.letters, letters);
    // The robot is handed over even while it is hidden, so its caster can be drawn once to compile.
    updateProjection(
      state,
      title.reach,
      world.queryFirst(RobotView)?.get(RobotView)?.root,
      world.get(Collapse)!.hole,
      stirredLetters,
    );
  });
}

/** Take captures of every stained-glass draw under `roots`, replacing any from draw groups since replaced. */
function captureGlass(state: Projection, roots: readonly Object3D[]): void {
  const { sourceScene } = state;

  for (const { capture } of state.captures) {
    sourceScene.remove(capture);

    if (!Array.isArray(capture.material)) capture.material.dispose();
  }

  state.captures.length = 0;
  state.capturedFrom = [...roots];
  // Meshes that share a material share its capture too: every node graph built is preparation time.
  const clones = new Map<MeshPhysicalNodeMaterial, MeshPhysicalNodeMaterial>();

  // The title's shadows spread as it lifts, but rain falls from near the camera: one glyph that high would stretch
  // the march over the whole scene and coarsen every shadow, so rain casts only over the last stretch of its fall.
  // The title is thick glass, and the lamp's slant sets its shadow off beside it by that thickness. A rain glyph
  // is a small thin pane: the same slab would shift its shadow by most of the glyph, so it casts as thin glass,
  // keeping its shadow under and just around it, and at two thirds of the title's weight so it reads as a shade.
  for (const [index, root] of roots.entries()) {
    const ceiling = index === 0 ? Number.POSITIVE_INFINITY : RECEIVER_Z + 4;
    const strength = index === 0 ? 1 : 0.65;
    const slab = index === 0 ? GLASS_DEPTH : 0.3;
    root.traverse((object) => {
      if (
        !(object instanceof Mesh) ||
        !(object.material instanceof MeshPhysicalNodeMaterial) ||
        !object.material.name.startsWith('stained-glass-')
      )
        return;

      const shared = clones.get(object.material);

      if (shared !== undefined) {
        const capture = new Mesh(object.geometry, shared);
        capture.matrixAutoUpdate = false;
        capture.frustumCulled = false;
        sourceScene.add(capture);
        state.captures.push({ original: object, capture, ceiling });

        return;
      }

      const material = object.material.clone();
      clones.set(object.material, material);
      material.name = 'glass-shadow-capture';
      material.transmission = 0;
      // The rain composes its panes by multiplication; the capture wants the plain lit output.
      material.outputNode = null;
      material.premultipliedAlpha = false;
      // Retain the Slug shader's fractional analytic coverage instead of forcing opaque alpha to one.
      material.transparent = true;
      material.blending = NoBlending;
      material.depthWrite = true;
      material.alphaToCoverage = false;
      material.alphaTest = 0;
      // The coverage without the lens: this capture is drawn from the lamp, where the lens has no meaning.
      const plain = plainCoverageOf(object.material);

      if (plain !== undefined) material.opacityNode = plain;

      // Preserve the original deformation and coverage. Three supplies the existing glass attenuation values.
      const transmission = materialAttenuationColor.pow(vec3(materialThickness.div(materialAttenuationDistance)));
      const height = positionWorld.z.sub(RECEIVER_Z).max(0);
      // Every attachment is coverage-weighted, so blurring keeps it valid across the soft edge.
      const weight = diffuseColor.a.mul(strength);
      material.mrtNode = mrt({
        output: vec4(transmission.mul(weight), weight),
        distance: vec4(height, materialIOR, materialDispersion, 1).mul(weight),
        normal: vec4(normalWorld.xy, slab / GLASS_DEPTH, 1).mul(weight),
      });
      const capture = new Mesh(object.geometry, material);
      capture.matrixAutoUpdate = false;
      capture.frustumCulled = false;
      sourceScene.add(capture);
      state.captures.push({ original: object, capture, ceiling });
    });
  }

  // Fresh captures have no last drawing to match, so the next projection redraws.
  state.previous = new Float32Array(state.captures.length * 17).fill(Number.NaN);
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

function updateProjection(
  state: Projection,
  titleReach: number,
  caster: Object3D | undefined,
  hole: HoleState,
  stirredLetters: boolean,
): void {
  const { scene, renderer, uLamp, uReach, source, sourceScene, caustic, causticScene, lightCamera, clear } = state;
  scene.updateMatrixWorld(true);
  uLamp.value.copy(LAMP);
  let reach = GLASS_DEPTH;
  // The hole bends every outline while it pulls, so the capture is redrawn as long as it does.
  let moved = uHoleBend.value > 0 || stirredLetters;
  const previous = state.previous;

  for (let index = 0; index < state.captures.length; index++) {
    const { original: object, capture, ceiling } = state.captures[index]!;
    let visible = object.visible;
    let parent = object.parent;

    while (parent !== null && visible) {
      visible = parent.visible;
      parent = parent.parent;
    }

    capture.visible = visible && object.parent !== null && (object.matrixWorld.elements[14] ?? 0) < ceiling;
    const base = index * 17;
    const shown = capture.visible ? 1 : 0;

    if (previous[base] !== shown) {
      previous[base] = shown;
      moved = true;
    }

    if (!capture.visible || !(object.material instanceof MeshPhysicalNodeMaterial)) continue;

    if (capture.material instanceof MeshPhysicalNodeMaterial) {
      const glass = capture.material;
      const original = object.material;

      // The capture holds what it was last given, so a glass whose values have changed is caught on that frame.
      if (
        glass.ior !== original.ior ||
        glass.dispersion !== original.dispersion ||
        glass.thickness !== original.thickness ||
        glass.attenuationDistance !== original.attenuationDistance ||
        !glass.attenuationColor.equals(original.attenuationColor)
      )
        moved = true;

      glass.ior = original.ior;
      glass.dispersion = original.dispersion;
      glass.thickness = original.thickness;
      glass.attenuationColor.copy(original.attenuationColor);
      glass.attenuationDistance = original.attenuationDistance;
    }

    // Glyph uses this metadata to select the retained run. Ordinary extruded meshes have no such metadata.
    capture.userData = object.userData;
    capture.matrix.copy(object.matrixWorld);
    // The highest this letter can reach: its centre, plus however far its tilt lifts a corner.
    const { elements } = object.matrixWorld;

    // A body at rest still settles by hairs, and an exact comparison would redraw the capture every frame for a
    // scene that has stopped; only a move worth a fraction of a pixel counts.
    for (let lane = 0; lane < 16; lane++) {
      if (!(Math.abs(previous[base + 1 + lane]! - elements[lane]!) <= 1e-4)) {
        previous[base + 1 + lane] = elements[lane]!;
        moved = true;
      }
    }

    const tilt = (Math.abs(elements[2] ?? 0) + Math.abs(elements[6] ?? 0)) * 2.4;
    reach = Math.max(reach, (elements[14] ?? 0) + tilt - RECEIVER_Z + GLASS_DEPTH / 2);
  }

  const { holeCaster } = state;
  holeCaster.visible = (hole.beat === 'play' || hole.beat === 'open') && hole.presence > 0.01 && hole.horizon > 0.01;

  if (holeCaster.visible) {
    // Where the hole is drawn: its floor place carried up the camera's ray to the height it casts from.
    const along = (uHoleCamera.value - HOLE_CAST_Z) / uHoleCamera.value;
    holeCaster.position.set(hole.x * along, hole.y * along, HOLE_CAST_Z);
    holeCaster.scale.setScalar(hole.horizon);
    state.uHolePresence.value = Math.min(1, hole.presence);
    reach = Math.max(reach, HOLE_CAST_Z - RECEIVER_Z + GLASS_DEPTH / 2);
  }

  // A caster on the move, and neither is ever still while it shows, redraws the capture; so does its leaving.
  const casting = caster !== undefined && caster.visible;
  // Every caster is drawn once, even one not showing yet, so its program compiles during preparation rather than
  // when it first appears and the frame is already running.
  const warming = !state.castersBuilt && caster !== undefined;

  if (casting || holeCaster.visible || warming || state.castersDrawn) moved = true;

  state.castersDrawn = casting || holeCaster.visible;
  const reached = Math.max(reach, titleReach - RECEIVER_Z + GLASS_DEPTH / 2);

  if (!(Math.abs(uReach.value - reached) <= 1e-4)) {
    uReach.value = reached;
    moved = true;
  }

  const previousTarget = renderer.getRenderTarget();
  const previousMRT = renderer.getMRT();
  const previousAlpha = renderer.getClearAlpha();
  const previousAutoClear = renderer.autoClear;
  renderer.getClearColor(clear);

  try {
    renderer.autoClear = true;
    renderer.setClearColor(0, 0);
    renderer.setMRT(null);
    // Every caster is drawn once, even one not showing yet, so its program compiles here rather than when it
    // first appears. That draw is thrown away by the real one below, which follows it in the same frame.
    if (warming && caster !== undefined) {
      const shownHole = holeCaster.visible;
      const shownCaster = caster.visible;
      holeCaster.visible = true;
      caster.visible = true;
      renderer.setRenderTarget(source);
      renderer.render(sourceScene, lightCamera);
      drawCasters(state);
      holeCaster.visible = shownHole;
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
  state.shadowTarget.dispose();
  state.marchMaterial.dispose();
  state.marchGeometry.dispose();
  state.casterMaterial.dispose();
  state.holeMaterial.dispose();
  state.holeGeometry.dispose();

  for (const node of state.blurs) node.dispose();

  for (const material of state.causticMaterials) material.dispose();

  state.gridGeometry.dispose();
  state.receiverGeometry.dispose();
  state.projectionMaterial.dispose();
}

export function GlassShadows() {
  const world = useWorld();
  const renderer = useThree((state) => state.renderer);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const owned = createProjection(renderer, scene);
    letterActions(world).mountShadowView(owned);

    return () => {
      letterActions(world).unmountShadowView();
      disposeProjection(owned);
    };
  }, [renderer, scene, world]);

  return null;
}
