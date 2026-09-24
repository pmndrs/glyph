import { useThree } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect } from 'react';
import {
  abs,
  cos,
  dFdx,
  dFdy,
  float,
  Fn,
  If,
  Loop,
  mix,
  mrt,
  mx_cell_noise_float,
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
  DoubleSide,
  HalfFloatType,
  Mesh,
  MeshBasicNodeMaterial,
  MultiplyBlending,
  type Node,
  NodeUpdateType,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  type WebGPURenderer,
} from 'three/webgpu';
import { glassActions } from './actions';
import { GLASS_DEPTH, SHADOW_RECEIVER_Z } from './content';
import type { CapturedPane, Lens } from './traits';

/** The receiving plane, in world units, centred on the title. */
const WIDTH = 32;
const HEIGHT = 20;
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

  /** The lamp the glass casts its shadows from, above the title and to the upper right. */
  const lamp = vec3(4, 6, 24);
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
    const incident = vec3(world, base.add(slab)).sub(lamp).normalize();
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
    const height = positionWorld.z.sub(SHADOW_RECEIVER_Z).max(0);
    casterMaterial.mrtNode = mrt({
      output: vec4(0, 0, 0, 1).mul(weight),
      distance: vec4(height, 1, 0, 1).mul(weight),
      normal: vec4(0, 0, 1, 1).mul(weight),
    });
  }

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
      const uv = captureUV(point.add(lamp.xy.sub(point).mul(t.div(lamp.z))));
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
  receiver.position.z = SHADOW_RECEIVER_Z;
  receiver.renderOrder = 1;
  scene.add(receiver);

  const projection = {
    renderer,
    scene,
    sourceScene,
    causticScene,
    lightCamera,
    source,
    caustic,
    shadowTarget,
    marchScene,
    sourceBlurs,
    casterMaterial,
    /** Whether an opaque caster was drawn last time, so its leaving is a change too. */
    castersDrawn: false,
    /** Whether every caster has been drawn once, which compiles their programs during preparation. */
    castersBuilt: false,
    /** Whether the march and caustic readers have been drawn, which sets up the blur nodes they read. */
    built: false,
    uReach,
    uTime,
    captures: [] as CapturedPane[],
    capturedFrom: [] as Object3D[],
    letters: new Float64Array(0),
    warmed: false,
    dispose: () => {
      scene.remove(receiver);
      disposeCaptures(projection.captures);
      source.dispose();
      caustic.dispose();
      shadowTarget.dispose();
      marchMaterial.dispose();
      marchGeometry.dispose();
      casterMaterial.dispose();

      for (const node of blurs) node.dispose();

      for (const material of causticMaterials) material.dispose();

      gridGeometry.dispose();
      receiverGeometry.dispose();
      projectionMaterial.dispose();
    },
  };

  return projection;
}

export type Projection = ReturnType<typeof createProjection>;

function disposeCaptures(captures: readonly CapturedPane[]): void {
  for (const { capture } of captures) if (!Array.isArray(capture.material)) capture.material.dispose();
}

/**
 * Mount the glass shadow projection under its lamp, and the lens capture drawn each frame from the scene camera
 * before the frame itself.
 */
export function GlassRenderer() {
  const world = useWorld();
  const renderer = useThree((state) => state.renderer);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const projection = createProjection(renderer, scene);
    glassActions(world).mountShadowView(projection);

    return () => {
      glassActions(world).unmountShadowView();
      projection.dispose();
    };
  }, [renderer, scene, world]);

  useEffect(() => {
    const lens: Lens = {
      renderer,
      camera,
      sourceScene: new Scene(),
      captures: [],
      capturedFrom: [],
      letters: new Float64Array(0),
      warmed: false,
    };
    glassActions(world).mountLensView(lens);

    return () => {
      glassActions(world).unmountLensView();
      disposeCaptures(lens.captures);
    };
  }, [camera, renderer, world]);

  return null;
}
