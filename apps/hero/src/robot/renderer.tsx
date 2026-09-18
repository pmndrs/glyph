import { COUNT, BASE_Z, RISE } from './dust';
import { jitter } from '../sequence/departure';
import { ICON_CODE_POINTS } from '../field/content';
import { Text, TextGroup } from '@pmndrs/glyph/react';
import { defineTextMaterial, type Text as ThreeText } from '@pmndrs/glyph/three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { useGLTF } from '@react-three/drei/webgpu';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import {
  exp,
  float,
  hash,
  mix,
  step as threshold,
  texture,
  uniform,
  uv,
  positionWorld,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
import {
  DoubleSide,
  AnimationMixer,
  type Bone,
  type Group,
  Matrix4,
  type Mesh,
  MeshBasicNodeMaterial,
  type MeshStandardMaterial,
  MeshStandardNodeMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three/webgpu';

import robotUrl from '../../assets/robot.glb?url';
import type { Faces } from '../typography/fonts';
import { screenInk } from './material';
import { LOOK_UP_AT, LOOK_DOWN_AT } from './motion';
import { mat4, quat, vec3 as vector3 } from 'math';
import { Robot as RobotTrait } from './traits';
import { Frame } from '../sequence/traits';
import { useWorld, useQuery } from 'koota/react';
import type { Entity } from 'koota';
import { heroReady, textPrepared, usePreparation } from '../view/startup';
import { type RetainedLine, createRetainedLine, disposeLine, showLine } from '../typography/retained-line';

const SCALE = 3 / 2.85;
/** Display coordinates in the head joint. Text up follows +x, text right follows +z, and its normal follows +y. */
const FACE_CENTER = new Vector3(10.96, 8.6, 0.49);
const FACE_BASIS = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)),
);
/** The display frame in the head joint, in rig units. */
const FACE_LOCAL = new Matrix4().compose(FACE_CENTER, FACE_BASIS, new Vector3().setScalar(1 / (0.05737 * SCALE)));
/** The display's finish under the printed pixels. */
const FACE_FINISH = { roughness: 0.35, metalness: 0.6 };
/** The eyes glitch out over this long before the text starts, and back in over it after the text clears. */
const GLITCH_SECONDS = 0.3;
/** What it prints while it looks up, and how: pixels in the eyes' violet, typed a few a second. */
const FACE_TEXT = 'PMNDRS';
const FACE_FONT_SIZE = 0.26;
const FACE_WIDTH = 1.7;
/** The happy face holds a moment once it is looking up before the letters take over. */
const TYPE_FROM = LOOK_UP_AT + 1.1;
const TYPE_UNTIL = LOOK_DOWN_AT + 0.25;

/** The eyes' glitch: whether they are shown, and how hard the screen is tearing, `now` seconds into a run. */
function eyesAt(out: { shown: number; tear: number }, now: number): void {
  const away = (now - (TYPE_FROM - GLITCH_SECONDS)) / GLITCH_SECONDS;
  const back = (now - TYPE_UNTIL) / GLITCH_SECONDS;
  if (away >= 0 && away < 1) {
    out.shown = away < 0.5 ? 1 : 0;
    out.tear = 1 - Math.abs(away * 2 - 1);
  } else if (back >= 0 && back < 1) {
    out.shown = back < 0.5 ? 0 : 1;
    out.tear = 1 - Math.abs(back * 2 - 1);
  } else {
    out.shown = now >= TYPE_FROM && now < TYPE_UNTIL ? 0 : 1;
    out.tear = 0;
  }
}

/** Driven each frame: the eyes shown or not, the tear's strength, and a seed that reshuffles the bands. */
const uEyes = uniform(1);
const uTear = uniform(0);
const uSeed = uniform(0);

/** Glitch the eyes out in horizontal bands while the face text appears, then restore them as it clears. */
function glitchingScreen(screen: MeshStandardMaterial): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    map: screen.map,
    roughnessMap: screen.roughnessMap,
    metalnessMap: screen.metalnessMap,
    roughness: screen.roughness,
    metalness: screen.metalness,
    emissive: screen.emissive,
    emissiveIntensity: screen.emissiveIntensity,
    envMapIntensity: screen.envMapIntensity,
    side: screen.side,
  });
  if (screen.map === null) return material;
  const at = uv();
  const band = hash(at.y.mul(36).floor().add(uSeed));
  const torn = vec2(at.x.add(band.sub(0.5).mul(uTear).mul(0.06)), at.y);
  const picture = texture(screen.map, torn).rgb;
  // The eyes are the only thing on the panel brighter than the panel: painting them its colour puts them out.
  const lit = threshold(0.06, picture.r.max(picture.g).max(picture.b));
  const dark = mix(picture, vec3(0.03), lit);
  const flipped = threshold(band, uTear);
  const eyes = mix(uEyes, float(1).sub(uEyes), flipped);
  material.colorNode = mix(dark, picture, eyes);
  return material;
}

const shadowMaterial = new MeshBasicNodeMaterial({ color: '#000000', depthWrite: false, transparent: true });
shadowMaterial.opacityNode = exp(uv().sub(0.5).length().mul(3.2).pow(2).negate()).mul(0.32);

useGLTF.preload(robotUrl);

function createRobotTransforms() {
  return {
    axis: vector3.create(),
    parent: quat.create(),
    tilt: quat.create(),
    rotation: quat.create(),
    local: quat.create(),
    parentWorld: new Quaternion(),
    world: mat4.create(),
    head: mat4.create(),
    face: mat4.create(),
    eyes: { shown: 1, tear: 0 },
  };
}
/** Marshal the animated bone once at each boundary. Composition stays in math scratch. */
function tiltJoint(
  joint: Object3D,
  scratch: ReturnType<typeof createRobotTransforms>,
  heading: number,
  angle: number,
): void {
  if (joint.parent === null) return;
  vector3.set(scratch.axis, -Math.sin(heading), Math.cos(heading), 0);
  joint.parent.getWorldQuaternion(scratch.parentWorld).toArray(scratch.parent);
  quat.setAxisAngle(scratch.tilt, scratch.axis, angle);
  quat.invert(scratch.rotation, scratch.parent);
  quat.multiply(scratch.rotation, scratch.rotation, scratch.tilt);
  quat.multiply(scratch.rotation, scratch.rotation, scratch.parent);
  joint.quaternion.toArray(scratch.local);
  quat.multiply(scratch.local, scratch.rotation, scratch.local);
  joint.quaternion.fromArray(scratch.local);
}

export function RobotRenderer({ faces }: { readonly faces: Faces }) {
  return useQuery(RobotTrait).map((entity) => (
    <group key={entity}>
      <Robot entity={entity} faces={faces} />
      <RobotDust entity={entity} faces={faces} />
    </group>
  ));
}

function Robot({ entity, faces }: { readonly entity: Entity; readonly faces: Faces }) {
  const world = useWorld();
  const robot = entity.get(RobotTrait)!;
  const model = useGLTF(robotUrl);
  const { animations } = model;
  const mover = useRef<Group>(null);
  const body = useRef<Group>(null);
  const { scene, display, screenMaterial } = useMemo(() => {
    const owned = clone(model.scene);
    const screenMesh = owned.getObjectByName('Object_9') as Mesh;
    const original = screenMesh.material as MeshStandardMaterial;
    const material = glitchingScreen(original);
    screenMesh.material = material;
    return { scene: owned, display: screenInk(original, FACE_FINISH), screenMaterial: material };
  }, [model.scene]);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const head = useMemo(() => scene.getObjectByName('Bip001_Spine1_03') as Bone | undefined, [scene]);
  const text = useRef<ThreeText<never> | null>(null);
  const line = useRef<RetainedLine | undefined>(undefined);
  usePreparation('robot', () => line.current !== undefined);
  useEffect(
    () => () => {
      if (line.current !== undefined) disposeLine(line.current);
      line.current = undefined;
      screenMaterial.dispose();
    },
    [screenMaterial],
  );
  /** The display's group: kept in the robot's tree and moved to the head joint each frame. */
  const face = useRef<Group>(null);
  const transformsRef = useRef(useMemo(() => createRobotTransforms(), []));

  useEffect(() => {
    const clip = animations.find((candidate) => candidate.name === 'Take 001');
    if (clip === undefined) return;
    const action = mixer.clipAction(clip);
    action.play();
    return () => {
      action.stop();
      mixer.uncacheClip(clip);
    };
  }, [animations, mixer]);

  useFrame(
    () => {
      const transforms = transformsRef.current;
      const root = mover.current;
      const lean = body.current;
      if (root === null || lean === null) return;

      if (line.current === undefined) {
        if (text.current === null || text.current.commitState().status !== 'committed') return;
        line.current = createRetainedLine(text.current);
        showLine(line.current, FACE_TEXT.length);
      }
      if (!heroReady()) return;

      root.visible = robot.active;
      if (!robot.active || robot.time === undefined) {
        showLine(line.current, 0);
        return;
      }
      const { x, y, heading, look } = robot.motion.pose;
      root.position.set(x, y, 0.04);
      root.rotation.z = heading;
      // Rocks back on its wheels. The axle is the mover's y, and a negative turn about it tips the top backwards.
      lean.rotation.y = -0.34 * look;
      // Looking up, the face prints its message a letter at a time, and clears it as it looks back down.
      const now = robot.time;
      const count =
        now >= TYPE_FROM && now < TYPE_UNTIL ? Math.min(FACE_TEXT.length, Math.floor((now - TYPE_FROM) * 9)) : 0;
      showLine(line.current, count);
      if (face.current !== null) face.current.visible = count > 0;
      eyesAt(transforms.eyes, now);
      const eyes = transforms.eyes;
      uEyes.value = eyes.shown;
      uTear.value = eyes.tear;
      uSeed.value = Math.floor(now * 48);

      mixer.update(world.get(Frame)!.delta);
      if (head !== undefined && look > 0) {
        root.updateWorldMatrix(true, true);
        tiltJoint(head, transforms, heading, -0.62 * look);
      }
      // The display rides on the head joint: its matrix is the joint's, brought into the mover's frame.
      const screen = face.current;
      if (head !== undefined && screen !== null && count > 0) {
        root.updateWorldMatrix(true, true);
        root.matrixWorld.toArray(transforms.world);
        head.matrixWorld.toArray(transforms.head);
        mat4.invert(transforms.world, transforms.world);
        mat4.multiply(transforms.world, transforms.world, transforms.head);
        FACE_LOCAL.toArray(transforms.face);
        mat4.multiply(transforms.world, transforms.world, transforms.face);
        screen.matrix.fromArray(transforms.world);
      }
    },
    { fps: 60 },
  );

  return (
    <group ref={mover} visible={false}>
      <group ref={body}>
        {/* The model faces its own -z once stood up, and the quarter turn points that along the mover's +x, its
            direction of travel. Inside it, the model's +y becomes the world's +z, towards the camera. */}
        <group rotation={[0, 0, Math.PI / 2]}>
          <group rotation={[Math.PI / 2, 0, 0]} scale={SCALE}>
            <primitive object={scene} />
          </group>
        </group>
      </group>
      <mesh material={shadowMaterial} position={[0, 0, 0.01]}>
        <planeGeometry args={[3.2, 2.6]} />
      </mesh>
      {display !== undefined ? (
        <group matrixAutoUpdate={false} ref={face} visible={false}>
          <Text
            constraints={{ width: { mode: 'exact', size: FACE_WIDTH } }}
            font={faces['geist-pixel-grid']}
            layout={{ align: 'center', wrap: 'none' }}
            material={display}
            ref={text}
            position={[-FACE_WIDTH / 2, FACE_FONT_SIZE / 2, 0]}
            style={{
              color: '#a99cff',
              fontSize: FACE_FONT_SIZE,
              letterSpacing: 0.09,
              lineHeight: 1,
            }}
          >
            {FACE_TEXT}
          </Text>
        </group>
      ) : null}
    </group>
  );
}

const SYMBOLS = Object.values(ICON_CODE_POINTS).map((point) => String.fromCodePoint(point));

const SLOTS = Array.from({ length: COUNT }, (_, index) => ({
  index,
  symbol: SYMBOLS[Math.floor(jitter(index + 17) * SYMBOLS.length)]!,
}));

// Height encodes lifetime, so all particles share one material and fade without re-shaping their text.
const dust = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false });
  material.name = 'robot-glyph-dust';
  material.positionNode = context.position;
  material.colorNode = context.shader.color;
  material.opacityNode = context.shader.coverage.mul(
    smoothstep(BASE_Z + RISE * 0.15, BASE_Z + RISE, positionWorld.z)
      .oneMinus()
      .mul(0.65),
  );
  return material;
});

/** A bounded trail in world space, fed by distance travelled rather than time spent on screen. */
function RobotDust({ entity, faces }: { readonly entity: Entity; readonly faces: Faces }) {
  const groups = useRef<(Group | null)[]>([]);
  usePreparation('dust', () => groups.current.length === COUNT && groups.current.every(textPrepared));
  const robot = entity.get(RobotTrait)!;
  useFrame(() => {
    if (!heroReady()) return;
    const state = robot.dust;
    for (let index = 0; index < COUNT; index++) {
      const group = groups.current[index];
      if (group == null) continue;
      const particle = state.particles[index]!;
      group.visible = particle.age < particle.life;
      if (!group.visible) continue;
      group.position.fromArray(particle.position);
      group.rotation.z = particle.roll;
      group.scale.setScalar(particle.size * (1 - (particle.age / particle.life) * 0.55));
    }
  });

  return (
    <TextGroup name="robot-glyph-dust">
      {SLOTS.map(({ index, symbol }) => (
        <group
          key={index}
          name="robot-dust-particle"
          ref={(group) => {
            groups.current[index] = group;
          }}
          visible={false}
        >
          <Text
            constraints={{ width: { mode: 'exact', size: 2 } }}
            font={faces.icons}
            layout={{ align: 'center', wrap: 'none' }}
            material={dust}
            position={[-1, 0.5, 0]}
            style={{ color: '#676779', fontSize: 1, lineHeight: 1 }}
          >
            {symbol}
          </Text>
        </group>
      ))}
    </TextGroup>
  );
}
