import { useRenderPipeline } from '@react-three/fiber/webgpu';
import type { Node } from 'three/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import {
  color,
  convertToTexture,
  cos,
  float,
  mix,
  pass,
  screenSize,
  sin,
  smoothstep,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

import { BURST_SECONDS, uHoleBloom, uHoleBlackout, uHoleBurst, uHoleCollapse, uHoleShake } from '../scene/hole';

/** The rendered sheet itself corkscrews into the hole. The explosion is composed afterward, over true black. */
export function Post() {
  useRenderPipeline(({ renderPipeline, scene, camera }) => {
    const scenePass = pass(scene, camera, { samples: 4 });
    const beauty = scenePass.getTextureNode('output');
    const lit = convertToTexture(beauty.add(bloom(beauty, uHoleBloom, 0.55, 1)));
    const point = uv().sub(0.5).add(uHoleShake);
    const aspect = vec2(screenSize.x.div(screenSize.y), 1);
    const radius = point.mul(aspect).length();
    const collapse = uHoleCollapse;
    const scale = float(1).sub(collapse).max(0.002);
    // Inverse mapping keeps every pixel attached to the paper as its edges curl away from the viewport.
    const turn = collapse.mul(5).mul(float(1).sub(radius).max(0));
    const source = vec2(
      point.x.mul(cos(turn)).sub(point.y.mul(sin(turn))),
      point.x.mul(sin(turn)).add(point.y.mul(cos(turn))),
    )
      .div(scale)
      .add(0.5);
    const edge = source.sub(0.5).abs().max(source.sub(0.5).abs().yx).x;
    const paper = float(1)
      .sub(smoothstep(0.48, 0.5, edge))
      .mul(float(1).sub(smoothstep(0.995, 1, collapse)))
      .mul(float(1).sub(uHoleBlackout));
    const warped = lit.sample(source.clamp()).rgb;
    const sheet = mix(lit.rgb, warped.mul(paper), smoothstep(0, 0.025, collapse));
    // After the pop the scene contains only the emitted glyphs over the opaque black sheet.
    const age = uHoleBurst.max(0);
    // Dimming after bloom keeps the halo-to-core ratio intact all the way down to black.
    const emberFade = float(1)
      .sub(smoothstep(0.08, BURST_SECONDS, age))
      .pow(1.5);
    const sceneColor = mix(sheet, lit.rgb.mul(emberFade), uHoleBlackout);
    const alive = uHoleBurst.greaterThanEqual(0).select(float(1).sub(smoothstep(0.03, 0.24, age)), 0);
    const expansion = float(1).sub(age.mul(-14).exp());
    const sparkPoint = point.mul(aspect);
    let sparks: Node<'vec3'> = vec3(0);
    for (let index = 0; index < 7; index += 1) {
      const angle = index * 2.39996;
      const reach = 0.025 + (index % 3) * 0.021;
      const delta = sparkPoint.sub(vec2(Math.cos(angle), Math.sin(angle)).mul(expansion.mul(reach))).abs();
      const glint = delta.x
        .mul(-850)
        .sub(delta.y.mul(180))
        .exp()
        .add(delta.x.mul(-180).sub(delta.y.mul(850)).exp());
      sparks = sparks.add(
        color(index % 2 === 0 ? '#e1c99d' : '#b7c4d9')
          .mul(glint)
          .mul(0.65),
      );
    }
    const ember = radius.mul(-95).exp().mul(age.mul(-24).exp());
    const finished = sceneColor.add(sparks.add(color('#dfccb0').mul(ember)).mul(alive));
    renderPipeline.outputNode = vec4(finished.mul(uHoleBurst.greaterThanEqual(BURST_SECONDS).select(0, 1)), 1);
  });
  return null;
}
