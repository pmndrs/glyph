import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';
import { float, normalize, positionLocal, uniform, vec2, vec3 } from 'three/tsl';
import { DirectionalLight, DoubleSide, MeshPhysicalNodeMaterial, NormalBlending, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/** The imperative twin: the same factory, the same physical material, a moving key light. */
const inkCentre = uniform(vec2(0, 0));
const inkSpan = uniform(vec2(1, 1));
const curvature = uniform(0.9);

const lit = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.msdf') return context.createDefaultMaterial();
  const material = new MeshPhysicalNodeMaterial({
    blending: NormalBlending,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    transparent: true,
  });
  const lean = positionLocal.xy.sub(inkCentre).div(inkSpan).mul(curvature);
  material.positionNode = context.position;
  material.normalNode = normalize(vec3(lean.x, lean.y, 1));
  material.colorNode = context.shader.color;
  material.opacityNode = context.shader.opacity;
  material.metalnessNode = float(0.62);
  material.roughnessNode = float(0.38);
  return material;
});

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:materials', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const key = new DirectionalLight('#f2f6ff', 3.4);
  scene.add(key);

  const word = three.createText({
    font: inter,
    material: lit,
    text: 'Metal',
    style: { fontSize: 1.5, color: '#e7ecf6' },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 9 } },
  });
  word.position.set(-4.5, 0.75, 0);
  scene.add(word);
  glyph.shape();

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    key.position.set(Math.cos(elapsed * 0.5) * 5, Math.sin(elapsed * 0.35) * 2.5, 4);
    frame = requestAnimationFrame(tick); // a moving light needs no shape(): nothing about the text changed
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    word.dispose();
    scene.remove(key);
    inter.dispose();
    three.dispose();
  };
}
