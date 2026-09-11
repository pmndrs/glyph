<script setup lang="ts">
import { isLight, isMesh, useLoop } from '@tresjs/core';
import {
  color,
  float,
  length,
  mix,
  mx_fractal_noise_float,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import {
  Color,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Vector3,
  type Mesh,
  type PointLight,
} from 'three/webgpu';
import { computed, onScopeDispose, watch } from 'vue';

// World units are CSS pixels at z = 0 (see Scene.vue), so every size here scales with the viewport.
const props = defineProps<{ accent: string; width: number; height: number; cameraDistance: number }>();

const accentUniform = uniform(new Color(props.accent));
watch(
  () => props.accent,
  (value) => accentUniform.value.set(value),
);

// The sky is one unlit plane; its whole look is this TSL graph. `time` is a renderer-updated uniform, so the
// plane animates without a JavaScript loop.
const skyMaterial = new MeshBasicNodeMaterial();
skyMaterial.colorNode = (() => {
  const centered = uv().sub(0.5);
  const drift = time.mul(0.05);
  const curtain = mx_fractal_noise_float(
    vec3(centered.x.mul(2.4), centered.y.mul(1.6).add(drift), drift.mul(0.6)),
    4,
    2,
    0.55,
    1,
  );
  const wave = sin(centered.y.mul(9).add(curtain.mul(4)).add(time.mul(0.2)))
    .mul(0.5)
    .add(0.5);
  const ribbon = smoothstep(0.62, 0.98, wave).mul(smoothstep(0.55, 0.05, centered.y.abs()));
  const haze = float(1).sub(smoothstep(0.1, 0.8, length(centered.mul(vec2(1, 1.6)))));
  const night = color('#07090f');
  const dusk = mix(night, color('#0c1a33'), haze);
  return mix(dusk, mix(color('#22467d'), accentUniform, 0.5), ribbon.mul(0.32));
})();

const shapeMaterial = new MeshStandardNodeMaterial({
  color: '#5a6b93',
  roughness: 0.38,
  metalness: 0.1,
  flatShading: true,
});
onScopeDispose(() => {
  skyMaterial.dispose();
  shapeMaterial.dispose();
});

// The sky sits behind the shapes but inside the camera's far plane, scaled to overfill the frustum there.
const skyDepth = computed(() => props.cameraDistance * 0.6);
const skyPosition = computed(() => new Vector3(0, 0, -skyDepth.value));
const skyScale = computed(() => {
  const spread = (1 + skyDepth.value / props.cameraDistance) * 1.15;
  return new Vector3(props.width * spread, props.height * spread, 1);
});

interface ShapeSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly detail: number;
  readonly spin: number;
  readonly phase: number;
}
// Fractions of the viewport, so the arrangement survives resizes.
const SHAPES: readonly ShapeSpec[] = [
  { x: -0.38, y: 0.22, z: -260, radius: 0.09, detail: 0, spin: 0.35, phase: 0 },
  { x: 0.36, y: 0.28, z: -320, radius: 0.07, detail: 1, spin: -0.28, phase: 1.3 },
  { x: -0.3, y: -0.3, z: -180, radius: 0.06, detail: 0, spin: 0.5, phase: 2.6 },
  { x: 0.3, y: -0.26, z: -240, radius: 0.11, detail: 0, spin: -0.22, phase: 3.9 },
  { x: 0.02, y: -0.4, z: -420, radius: 0.05, detail: 1, spin: 0.6, phase: 5.2 },
];

const meshes = new Map<number, Mesh>();
const lights = new Map<'accent' | 'cool', PointLight>();
function bindShape(index: number, instance: unknown): void {
  if (isMesh(instance)) meshes.set(index, instance);
  else meshes.delete(index);
}
function bindLight(key: 'accent' | 'cool', instance: unknown): void {
  // Tres hands back a generic Light; both lights in this template are PointLights.
  if (isLight(instance)) lights.set(key, instance as PointLight);
  else lights.delete(key);
}

const { onBeforeRender } = useLoop();
onBeforeRender(({ elapsed }) => {
  for (const [index, mesh] of meshes) {
    const spec = SHAPES[index];
    if (spec === undefined) continue;
    mesh.rotation.x = elapsed * spec.spin;
    mesh.rotation.y = elapsed * spec.spin * 0.7 + spec.phase;
    mesh.position.set(
      spec.x * props.width,
      spec.y * props.height + Math.sin(elapsed * 0.6 + spec.phase) * props.height * 0.03,
      spec.z,
    );
  }
  const orbit = elapsed * 0.35;
  lights.get('accent')?.position.set(Math.cos(orbit) * props.width * 0.35, Math.sin(orbit) * props.height * 0.3, 160);
  lights
    .get('cool')
    ?.position.set(-Math.cos(orbit * 0.8) * props.width * 0.3, -Math.sin(orbit * 0.8) * props.height * 0.35, 120);
});
</script>

<template>
  <TresGroup name="backdrop">
    <TresMesh name="sky" :material="skyMaterial" :position="skyPosition" :scale="skyScale">
      <TresPlaneGeometry />
    </TresMesh>
    <TresMesh
      v-for="(shape, index) in SHAPES"
      :key="index"
      :ref="(instance) => bindShape(index, instance)"
      :material="shapeMaterial"
    >
      <TresIcosahedronGeometry :args="[shape.radius * height, shape.detail]" />
    </TresMesh>
    <TresAmbientLight color="#8fa6ff" :intensity="1.2" />
    <!-- Physical decay over hundreds of pixel-units would need huge intensities; decay 0 keeps the numbers readable. -->
    <TresPointLight :ref="(instance) => bindLight('accent', instance)" :color="accent" :intensity="9" :decay="0" />
    <TresPointLight :ref="(instance) => bindLight('cool', instance)" color="#4f7cff" :intensity="6" :decay="0" />
  </TresGroup>
</template>
