import { Text, TextGroup } from '@pmndrs/glyph/react';
import {
  emberMaterial,
  uHoleBlackout,
  uHoleCollapse,
  uHoleBurst,
  uHoleBloom,
  uHoleShake,
  uHoleCamera,
  buildMaterials,
  HORIZON_ON_PLANE,
  uPresence,
  uHeat,
  syncHoleUniforms,
} from './materials';
import { STAR_SYMBOLS, BURST_SECONDS, HOLE_CENTER } from './utils';
import type { SlugFont } from '../view/hooks';
import { jitter } from '../random';
import { useFrame, useThree, useRenderPipeline } from '@react-three/fiber/webgpu';
import { useMemo, useRef } from 'react';
import {
  color,
  float,
  mix,
  smoothstep,
  uv,
  vec2,
  convertToTexture,
  cos,
  pass,
  screenSize,
  sin,
  vec3,
  vec4,
} from 'three/tsl';
import type { Group, Node } from 'three/webgpu';
import { useWorld } from 'koota/react';
import { Collapse } from './traits';
import { heroReady, textPrepared, usePreparation } from '../view/startup';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/** After the robot leaves, the hole pulls in the scene and fades to black. Space replays the sequence. */
export function BlackHole() {
  const world = useWorld();
  const materials = useMemo(() => buildMaterials(), []);
  const camera = useThree((state) => state.camera);
  const hole = useRef<Group>(null);

  useFrame(
    () => {
      if (!heroReady()) return;

      uHoleCamera.value = camera.position.z;
      const state = world.get(Collapse)!.hole;
      syncHoleUniforms(state);
      const group = hole.current;

      if (group === null) return;

      group.visible = state.beat === 'open';
      uPresence.value = state.presence;
      uHeat.value = state.pull;
      const size = Math.max(state.horizon / HORIZON_ON_PLANE, 0.001);
      group.scale.set(size, size, 1);
    },
    { fps: 60 },
  );

  return (
    <>
      <group position={[HOLE_CENTER[0], HOLE_CENTER[1], 5]} ref={hole} visible={false}>
        <mesh material={materials.core} renderOrder={40}>
          <planeGeometry args={[2, 2]} />
        </mesh>
        <mesh material={materials.light} position={[0, 0, 0.01]} renderOrder={41} rotation={[0, 0, -0.15]}>
          <planeGeometry args={[2, 2]} />
        </mesh>
      </group>
      <mesh frustumCulled={false} material={materials.black} position={[0, 0, 7]} renderOrder={60}>
        <planeGeometry args={[60, 60]} />
      </mesh>
    </>
  );
}

const COLORS = ['#fff0ac', '#ffd0dc', '#cbbcff', '#b9e6ff'];
const PARTICLES = Array.from({ length: 16 }, (_, index) => ({
  index,
  symbol: STAR_SYMBOLS[index % STAR_SYMBOLS.length]!,
  color: COLORS[index % COLORS.length]!,
  angle: index * 2.39996 + jitter(index) * 0.4,
  reachX: Math.cos(index * 2.39996 + jitter(index) * 0.4) * (0.75 + jitter(index + 43) * 1.15),
  reachY: Math.sin(index * 2.39996 + jitter(index) * 0.4) * (0.75 + jitter(index + 43) * 1.15),
  size: 0.18 + jitter(index + 71) * 0.14,
  delay: jitter(index + 91) * 0.045,
  spin: (jitter(index + 121) - 0.5) * 5,
}));

/** Pastel Unicode stars flare over the black sheet, then linger as softly glowing embers. */
export function GlyphBurst({ font }: { readonly font: SlugFont }) {
  const world = useWorld();
  const groups = useRef<(Group | null)[]>([]);
  usePreparation('burst', () => groups.current.length === PARTICLES.length && groups.current.every(textPrepared));

  useFrame(() => {
    if (!heroReady()) return;

    const since = world.get(Collapse)!.hole.sincePop;

    for (const particle of PARTICLES) {
      const group = groups.current[particle.index];

      if (group === null || group === undefined) continue;

      const age = (since ?? -1) - particle.delay;

      // Keep the text mounted and shaped before emission. A near-zero transform hides its prewarmed draw.
      if (age < 0 || age >= BURST_SECONDS) {
        group.scale.setScalar(0.0001);
        continue;
      }

      const travel = 1 - Math.exp(-age * 9);
      const size = particle.size * Math.min(1, age / 0.035) * (1 - (age / BURST_SECONDS) ** 1.4 * 0.8);
      group.position.set(particle.reachX * travel, particle.reachY * travel - age * age * 0.25, 8);
      group.rotation.z = particle.angle * 0.3 + age * particle.spin;
      group.scale.setScalar(size);
    }
  });

  return (
    <group name="hole-glyph-burst">
      <TextGroup renderOrder={70}>
        {PARTICLES.map(({ index, symbol, color: tint }) => (
          <group
            key={index}
            ref={(group) => {
              groups.current[index] = group;
            }}
            scale={0.0001}
          >
            <Text
              constraints={{ width: { mode: 'exact', size: 2 } }}
              font={font}
              layout={{ align: 'center', wrap: 'none' }}
              material={emberMaterial}
              position={[-1, 0.5, 0]}
              style={{ color: tint, fontSize: 1, lineHeight: 1 }}
            >
              {symbol}
            </Text>
          </group>
        ))}
      </TextGroup>
    </group>
  );
}

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
