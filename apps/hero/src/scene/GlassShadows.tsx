import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useRef } from 'react';
import {
  diffuseColor,
  materialAttenuationColor,
  materialAttenuationDistance,
  materialThickness,
  materialIOR,
  materialDispersion,
  mix,
  mrt,
  positionWorld,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import {
  Color,
  HalfFloatType,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MultiplyBlending,
  NoBlending,
  NodeUpdateType,
  PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  type WebGPURenderer,
} from 'three/webgpu';

const WIDTH = 32;
const HEIGHT = 20;
/** One apparent receiving surface, in front of the individual patterned parallax layers. */
const RECEIVER_Z = -0.06;

/** Project the flat glyph shaders onto the pattern and soften only the colored fringe outside their silhouettes. */
function createProjection(renderer: WebGPURenderer, scene: Scene) {
  const sourceScene = new Scene();
  // A virtual projector provides depth-dependent footprints without adding or moving a scene light.
  const lightCamera = new PerspectiveCamera((2 * Math.atan(HEIGHT / 50) * 180) / Math.PI, WIDTH / HEIGHT, 0.1, 80);
  const source = new RenderTarget(2048, 1280, { type: HalfFloatType, count: 2 });
  source.texture.name = 'output';
  const distanceTexture = source.textures[1];
  if (distanceTexture === undefined) throw new Error('Missing glass projection distance attachment');
  distanceTexture.name = 'distance';
  const lightMatrix = uniform(new Matrix4());
  const blur = gaussianBlur(texture(source.texture), 1.4, 2);
  const penumbra = gaussianBlur(texture(source.texture), 5, 3);
  const distanceBlur = gaussianBlur(texture(distanceTexture), 5, 3);
  penumbra.resolutionScale = 0.5;
  distanceBlur.resolutionScale = 0.5;
  // Captures may change between renders within one animation frame, including deterministic readbacks.
  blur.updateBeforeType = NodeUpdateType.RENDER;
  penumbra.updateBeforeType = NodeUpdateType.RENDER;
  distanceBlur.updateBeforeType = NodeUpdateType.RENDER;
  const lightPosition = lightMatrix.mul(vec4(positionWorld, 1));
  // Light clip space is bottom-up; WebGPU render textures are top-down.
  const shadowUV = lightPosition.xy.div(lightPosition.w).mul(0.5).add(0.5).flipY();
  const shadow = blur.getTextureNode().sample(shadowUV);
  const distant = penumbra.getTextureNode().sample(shadowUV);
  const distance = distanceBlur.getTextureNode().sample(shadowUV);
  // Coverage-weighted distance remains valid across the soft edge, including outside the source silhouette.
  const height = distance.r.div(distance.a.max(0.0001));
  const spread = height.mul(0.16).add(0.12).clamp(0, 1);
  const soft = mix(shadow, distant, spread);
  const sharp = texture(source.texture, shadowUV);
  const inside = shadowUV.x
    .greaterThanEqual(0)
    .and(shadowUV.x.lessThanEqual(1))
    .and(shadowUV.y.greaterThanEqual(0))
    .and(shadowUV.y.lessThanEqual(1));
  const bounds = inside.select(1, 0);
  // Two Gaussian scales give a defined contact edge followed by a gentle falloff, without a distant tail.
  const transmitted = soft.rgb.div(soft.a.max(0.0001));
  // A small redistribution of transmitted color at the outer edge suggests thin glass under a broad overhead light.
  const rim = soft.a.sub(sharp.a).max(0).mul(bounds).div(height.mul(0.12).add(1));
  const projectionMaterial = new MeshBasicNodeMaterial({
    name: 'glass-shadows',
    transparent: true,
    depthWrite: false,
    blending: MultiplyBlending,
    premultipliedAlpha: true,
    toneMapped: false,
  });
  const texel = vec2(1 / source.width, 1 / source.height);
  const wide = penumbra.getTextureNode();
  // The captured silhouette supplies an outward-facing optical edge for flat, unextruded letterforms.
  const gradient = vec2(
    wide.sample(shadowUV.add(vec2(texel.x, 0))).a.sub(wide.sample(shadowUV.sub(vec2(texel.x, 0))).a),
    wide.sample(shadowUV.add(vec2(0, texel.y))).a.sub(wide.sample(shadowUV.sub(vec2(0, texel.y))).a),
  );
  const inward = gradient.div(gradient.length().max(0.00001));
  const ior = distance.g.div(distance.a.max(0.0001)).max(1);
  const dispersion = distance.b.div(distance.a.max(0.0001));
  const reach = ior.sub(1).mul(12).add(height.mul(5)).mul(texel);
  const spectralSplit = dispersion.mul(0.35).clamp(0, 0.5);
  const band = (split: number) => {
    const sampleUV = shadowUV.add(inward.mul(reach).mul(spectralSplit.mul(split).add(1)));
    const near = blur.getTextureNode().sample(sampleUV).a;
    const far = blur.getTextureNode().sample(sampleUV.add(inward.mul(texel).mul(2))).a;
    return far.sub(near).max(0).mul(3);
  };
  const spectrum = vec3(band(1), band(0), band(-1));
  const energy = spectrum
    .mul(transmitted.mul(0.7).add(0.3))
    .mul(sharp.a.oneMinus())
    .mul(bounds)
    .div(height.mul(0.18).add(1));
  const fringe = mix(vec3(1), transmitted, rim.mul(0.35));
  projectionMaterial.fragmentNode = vec4(fringe.add(energy.mul(0.65)), 1);
  const receiverGeometry = new PlaneGeometry(WIDTH, HEIGHT);
  const receiver = new Mesh(receiverGeometry, projectionMaterial);
  receiver.name = 'glass-shadows';
  receiver.position.z = RECEIVER_Z;
  receiver.renderOrder = 1;
  scene.add(receiver);

  const captures = new Map<Mesh, Mesh>();
  const clear = new Color();
  function update() {
    scene.updateMatrixWorld(true);
    // This is a face-on shader projection of a thin sheet, independent of the scene's studio lighting.
    lightCamera.position.set(0, 0, 25);
    lightCamera.lookAt(0, 0, 0);
    lightCamera.updateMatrixWorld();
    lightMatrix.value.multiplyMatrices(lightCamera.projectionMatrix, lightCamera.matrixWorldInverse);
    const current = new Set<Mesh>();
    scene.traverseVisible((object) => {
      if (
        !(object instanceof Mesh) ||
        !(object.material instanceof MeshPhysicalNodeMaterial) ||
        !object.material.name.startsWith('stained-glass-')
      )
        return;
      current.add(object);
      let capture = captures.get(object);
      if (capture === undefined) {
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
        const surfaceHeight = positionWorld.z.sub(RECEIVER_Z).max(0);
        material.mrtNode = mrt({
          output: vec4(transmission.mul(diffuseColor.a), diffuseColor.a),
          distance: vec4(surfaceHeight, materialIOR, materialDispersion, 1).mul(diffuseColor.a),
        });
        capture = new Mesh(object.geometry, material);
        capture.matrixAutoUpdate = false;
        capture.frustumCulled = false;
        sourceScene.add(capture);
        captures.set(object, capture);
      }
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
    });
    for (const [original, capture] of captures) {
      if (!current.has(original)) {
        sourceScene.remove(capture);
        if (!Array.isArray(capture.material)) capture.material.dispose();
        captures.delete(original);
      }
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
      renderer.setRenderTarget(source);
      renderer.render(sourceScene, lightCamera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setMRT(previousMRT);
      renderer.setClearColor(clear, previousAlpha);
      renderer.autoClear = previousAutoClear;
    }
  }
  return {
    update,
    dispose() {
      scene.remove(receiver);
      for (const capture of captures.values()) if (!Array.isArray(capture.material)) capture.material.dispose();
      captures.clear();
      source.dispose();
      blur.dispose();
      penumbra.dispose();
      distanceBlur.dispose();
      receiverGeometry.dispose();
      projectionMaterial.dispose();
    },
  };
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
      owned.dispose();
    };
  }, [renderer, scene]);
  useFrame(() => projection.current?.update(), {
    id: 'hero-glass-shadows',
    phase: 'update',
    after: ['hero-title-motion'],
  });
  return null;
}
