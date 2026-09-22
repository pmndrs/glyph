import { Text, TextGroup } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useGLTF } from '@react-three/drei/webgpu';
import { useFrame } from '@react-three/fiber/webgpu';
import type { Entity } from 'koota';
import { useQuery, useWorld } from 'koota/react';
import { useEffect, useMemo, useRef } from 'react';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
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
import { GLYPHS } from '../icon-field/content';
import type { SlugFont } from '../cameo/fonts';
import { textPrepared, usePreparation } from '../cameo/prepare';
import { jitter } from '../utils';
import robotUrl from '../../assets/robot.glb?url';
import { robotActions } from './actions';
import {
  CARDS,
  DUST_COUNT,
  FACE_CENTER,
  FACE_FONT_SIZE,
  FACE_LETTER_SPACING,
  FACE_PADDING,
  FACE_WIDTH,
  RIG_SCALE,
} from './content';
import { dustInk, glitchingScreen, screenInk, uEyes, uSeed, uTear } from './materials';
import { createPrintedCard, disposeCard, printCard, type PrintedCard } from './text';
import { mat4, quat, vec3 as vector3 } from 'math';
import { Robot as RobotTrait } from './traits';

/** Display coordinates in the head joint. Text up follows +x, text right follows +z, and its normal follows +y. */
const FACE_BASIS = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)),
);
/** The display frame in the head joint, in rig units. */
const FACE_LOCAL = new Matrix4().compose(
  new Vector3(...FACE_CENTER),
  FACE_BASIS,
  new Vector3().setScalar(1 / (0.05737 * RIG_SCALE)),
);

/** What the type is centred in: the panel less its margin either side. */
const PRINTABLE_WIDTH = FACE_WIDTH - FACE_PADDING * 2;

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
    owned.traverse((object) => {
      object.castShadow = true;
    });
    const screenMesh = owned.getObjectByName('Object_9') as Mesh;
    const original = screenMesh.material as MeshStandardMaterial;
    const material = glitchingScreen(original);
    screenMesh.material = material;

    return { scene: owned, display: screenInk(original), screenMaterial: material };
  }, [model.scene]);

  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const head = useMemo(() => scene.getObjectByName('Bip001_Spine1_03') as Bone | undefined, [scene]);
  const texts = useRef<(ThreeText<never> | null)[]>([]);
  const cards = useRef<PrintedCard[] | undefined>(undefined);
  usePreparation('robot', () => cards.current !== undefined);

  useEffect(
    () => () => {
      robotActions(world).unmountRobotView(entity);

      for (const card of cards.current ?? []) disposeCard(card);

      cards.current = undefined;
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
      const root = mover.current;
      const lean = body.current;

      if (root === null || lean === null || cards.current !== undefined) return;

      const committed = texts.current;

      if (committed.length !== CARDS.length) return;

      if (!committed.every((text) => text !== null && text.commitState().status === 'committed')) return;

      const built = committed.map((text) => createPrintedCard(text!, PRINTABLE_WIDTH));

      for (const card of built) printCard(card, 0);

      cards.current = built;
      robotActions(world).mountRobotView(entity, {
        root,
        lean,
        screen: face.current,
        head,
        mixer,
        cards: built,
        transforms: transformsRef.current,
        faceLocal: FACE_LOCAL,
        eyes: uEyes,
        tear: uTear,
        seed: uSeed,
      });
    },
    { fps: 60 },
  );

  return (
    <group ref={mover} visible={false}>
      <group ref={body}>
        {/* The model faces its own -z once stood up, and the quarter turn points that along the mover's +x, its
            direction of travel. Inside it, the model's +y becomes the world's +z. */}
        <group rotation={[0, 0, Math.PI / 2]}>
          <group rotation={[Math.PI / 2, 0, 0]} scale={RIG_SCALE}>
            <primitive object={scene} />
          </group>
        </group>
      </group>
      <group matrixAutoUpdate={false} ref={face} visible={false}>
        {CARDS.map((card, index) => (
          <Text
            constraints={{ width: { mode: 'exact', size: PRINTABLE_WIDTH } }}
            font={font}
            key={card.text}
            layout={{ align: 'center', wrap: 'none' }}
            material={display}
            /* Top anchored, so one line of type hangs across the middle of the display. */
            position={[-PRINTABLE_WIDTH / 2, FACE_FONT_SIZE / 2, 0]}
            ref={(text) => {
              texts.current[index] = text as ThreeText<never> | null;
            }}
            style={{
              color: '#a99cff',
              fontSize: FACE_FONT_SIZE,
              letterSpacing: FACE_LETTER_SPACING,
              lineHeight: 1,
            }}
          >
            {card.text}
          </Text>
        ))}
      </group>
    </group>
  );
}

const SLOTS = Array.from({ length: DUST_COUNT }, (_, index) => ({
  index,
  glyph: GLYPHS[Math.floor(jitter(index + 17) * GLYPHS.length)]!,
}));

/** A bounded trail in world space, fed by distance travelled rather than time spent on screen. */
function RobotDust({ entity, font }: { readonly entity: Entity; readonly font: SlugFont }) {
  const groups = useRef<(Group | null)[]>([]);
  usePreparation('dust', () => groups.current.length === DUST_COUNT && groups.current.every(textPrepared));
  const world = useWorld();

  useEffect(() => {
    robotActions(world).mountDustView(entity, groups.current);

    return () => robotActions(world).unmountDustView(entity);
  }, [world, entity]);

  return (
    <TextGroup name="cameo-robot-dust">
      {SLOTS.map(({ index, glyph }) => (
        <group
          key={index}
          name="cameo-dust-particle"
          ref={(group) => {
            groups.current[index] = group;
          }}
          visible={false}
        >
          <Text
            constraints={{ width: { mode: 'exact', size: 2 } }}
            font={font}
            layout={{ align: 'center', wrap: 'none' }}
            material={dustInk}
            position={[-1, 0.5, 0]}
            style={{ color: '#7d7a8e', fontSize: 1, lineHeight: 1 }}
          >
            {glyph}
          </Text>
        </group>
      ))}
    </TextGroup>
  );
}
