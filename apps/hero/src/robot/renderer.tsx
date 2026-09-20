import { COUNT, FACE_TEXT } from './content';
import { jitter } from '../utils';
import { ICON_CODE_POINTS } from '../icon-field/content';
import { Text, TextGroup } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { useGLTF } from '@react-three/drei/webgpu';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import {
  AnimationMixer,
  type Bone,
  type Group,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import type { SlugFont } from '../hero/fonts';
import { screenInk, uEyes, uTear, uSeed, glitchingScreen, shadowMaterial, dust } from './materials';
import { mat4, quat, vec3 as vector3 } from 'math';
import { Robot as RobotTrait } from './traits';
import { robotActions } from './actions';
import { useWorld, useQuery } from 'koota/react';
import type { Entity } from 'koota';
import { textPrepared, usePreparation } from '../hero/prepare';
import { type RetainedLine, createRetainedLine, disposeLine, showLine } from '../letters/text';
import robotUrl from '../../assets/robot.glb?url';

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
const FACE_FONT_SIZE = 0.26;
const FACE_WIDTH = 1.7;

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

export function RobotRenderer({ font, icons }: { readonly font: SlugFont; readonly icons: SlugFont }) {
  return useQuery(RobotTrait).map((entity) => (
    <group key={entity}>
      <Robot entity={entity} font={font} />
      <RobotDust entity={entity} font={icons} />
    </group>
  ));
}

function Robot({ entity, font }: { readonly entity: Entity; readonly font: SlugFont }) {
  const world = useWorld();
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
      robotActions(world).unmountRobotView(entity);

      if (line.current !== undefined) disposeLine(line.current);

      line.current = undefined;
      screenMaterial.dispose();
    },
    [screenMaterial, world, entity],
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
        robotActions(world).mountRobotView(entity, {
          root,
          lean,
          screen: face.current,
          head,
          mixer,
          line: line.current,
          transforms,
          faceLocal: FACE_LOCAL,
          eyes: uEyes,
          tear: uTear,
          seed: uSeed,
        });
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
            font={font}
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

/** A bounded trail in world space, fed by distance travelled rather than time spent on screen. */
function RobotDust({ entity, font }: { readonly entity: Entity; readonly font: SlugFont }) {
  const groups = useRef<(Group | null)[]>([]);
  usePreparation('dust', () => groups.current.length === COUNT && groups.current.every(textPrepared));
  const world = useWorld();

  useEffect(() => {
    robotActions(world).mountDustView(entity, groups.current);

    return () => robotActions(world).unmountDustView(entity);
  }, [world, entity]);

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
            font={font}
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
