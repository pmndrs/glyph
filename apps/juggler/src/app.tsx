import { Text, TextGroup, useMsdf } from '@pmndrs/glyph/react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useRef, useState } from 'react';
import type { Group, Mesh } from 'three/webgpu';

import fontUrl from '../assets/inter-latin.font.glb?url';
import {
  FONT_SIZE,
  createJugglerWorld,
  deleteLetter,
  figure,
  resizeJugglerWorld,
  stepJugglerWorld,
  typeLetter,
  type JugglerWorld,
  type Letter,
  type Side,
} from './juggler.js';

const COLORS = ['#f59e0b', '#fb7185', '#ff4dc4', '#60a5fa', '#34d399', '#fde047', '#c084fc'] as const;
const INK = '#f4f7ff';
const MUTED = '#6b7a90';
/** Wide exact box so `align: 'center'` centres one glyph on its group origin. */
const LETTER_BOX = FONT_SIZE * 1.5;
/** Longest simulated step, so a background tab does not fling every letter through the floor on return. */
const MAX_STEP = 1 / 20;

useMsdf.preload(fontUrl);

export function App() {
  const font = useMsdf(fontUrl);
  const viewport = useThree((state) => state.viewport);
  const [world] = useState(() => createJugglerWorld(viewport.width, viewport.height));
  const [letters, setLetters] = useState<readonly Letter[]>([]);
  const views = useRef(new Map<number, Group>());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Backspace') deleteLetter(world);
      else if (event.key.length === 1 && event.key.trim() !== '') typeLetter(world, event.key);
      else return;
      event.preventDefault();
      setLetters([...world.letters]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [world]);

  useFrame(
    (state, delta) => {
      const { width, height } = state.viewport;
      if (world.width !== width || world.height !== height) resizeJugglerWorld(world, width, height);
      stepJugglerWorld(world, Math.min(delta, MAX_STEP));
    },
    { id: 'juggler-simulation', phase: 'physics' },
  );

  useFrame(() => {
    for (const letter of world.letters) {
      const view = views.current.get(letter.id);
      if (view === undefined) continue;
      view.position.set(letter.x, letter.y, 0);
      view.rotation.z = letter.rotation;
    }
  });

  const body = figure(viewport.height);

  return (
    <>
      <StickFigure world={world} />
      <mesh position={[0, body.floorY - 3, -1]} scale={[viewport.width, 1, 1]}>
        <planeGeometry args={[1, 2]} />
        <meshBasicNodeMaterial color="#293244" />
      </mesh>
      <TextGroup name="letters">
        {letters.map((letter) => (
          <group
            key={letter.id}
            position={[letter.x, letter.y, 0]}
            ref={(view: Group | null) => {
              if (view === null) views.current.delete(letter.id);
              else views.current.set(letter.id, view);
            }}
          >
            <Text
              constraints={{ width: { mode: 'exact', size: LETTER_BOX } }}
              font={font}
              layout={{ align: 'center', wrap: 'none' }}
              position={[-LETTER_BOX / 2, FONT_SIZE / 2, 0]}
              style={{ color: letterColor(letter), fontSize: FONT_SIZE, lineHeight: 1 }}
            >
              {letter.char}
            </Text>
          </group>
        ))}
      </TextGroup>
      <Text
        font={font}
        position={[-viewport.width / 2 + 24, body.floorY - 12, 0]}
        style={{ color: MUTED, fontSize: 14, letterSpacing: 0.6, lineHeight: 1 }}
      >
        {letters.length === 0 ? 'TYPE TO JUGGLE' : 'BACKSPACE REMOVES A LETTER'}
      </Text>
    </>
  );
}

function letterColor(letter: Letter): string {
  return COLORS[letter.id % COLORS.length] ?? INK;
}

type Limb =
  | 'torso'
  | 'leftUpperArm'
  | 'leftForearm'
  | 'rightUpperArm'
  | 'rightForearm'
  | 'leftThigh'
  | 'leftShin'
  | 'rightThigh'
  | 'rightShin';
type Joint = 'head' | 'leftHand' | 'rightHand' | 'leftKnee' | 'rightKnee' | 'leftElbow' | 'rightElbow';

const LIMBS: readonly Limb[] = [
  'torso',
  'leftUpperArm',
  'leftForearm',
  'rightUpperArm',
  'rightForearm',
  'leftThigh',
  'leftShin',
  'rightThigh',
  'rightShin',
];
const JOINTS: readonly Joint[] = ['head', 'leftHand', 'rightHand', 'leftKnee', 'rightKnee', 'leftElbow', 'rightElbow'];
const LIMB_THICKNESS = 5;
const ARM_SEGMENT = 36;
const LEG_SEGMENT = 34;
const SIDES: readonly Side[] = ['left', 'right'];

/** A stick figure posed every frame from the simulation: two-bone arms reach the hands, legs stride with the body. */
function StickFigure({ world }: { readonly world: JugglerWorld }) {
  const parts = useRef(new Map<Limb | Joint, Mesh>());
  /** Eased body velocity so lean and stride do not flicker with the chase steps. */
  const eased = useRef(0);

  useFrame((_, delta) => {
    const { juggler } = world;
    const body = figure(world.height);
    const part = (name: Limb | Joint) => parts.current.get(name);
    eased.current += (juggler.vx - eased.current) * (1 - Math.exp(-10 * delta));
    const velocity = eased.current;
    const lean = clamp(velocity * 0.014, -18, 18);
    const running = clamp(Math.abs(velocity) / 700, 0, 1);
    const forward = Math.abs(velocity) > 40 ? Math.sign(velocity) : 0;

    const hipX = juggler.x;
    const shoulderX = hipX + lean;
    poseLimb(part('torso'), hipX, body.hipY, shoulderX, body.shoulderY);
    poseJoint(part('head'), shoulderX + lean * 0.4, body.headY);

    for (const [index, side] of SIDES.entries()) {
      const sign = side === 'left' ? -1 : 1;
      const hand = juggler.hands[side];
      const sx = shoulderX + sign * 8;
      const elbow = bend(sx, body.shoulderY, hand.x, hand.y, ARM_SEGMENT, sign * 0.4, -1);
      poseLimb(part(side === 'left' ? 'leftUpperArm' : 'rightUpperArm'), sx, body.shoulderY, elbow[0], elbow[1]);
      poseLimb(part(side === 'left' ? 'leftForearm' : 'rightForearm'), elbow[0], elbow[1], hand.x, hand.y);
      poseJoint(part(side === 'left' ? 'leftElbow' : 'rightElbow'), elbow[0], elbow[1]);
      poseJoint(part(side === 'left' ? 'leftHand' : 'rightHand'), hand.x, hand.y);

      const phase = juggler.stride / 28 + index * Math.PI;
      const footX = hipX + sign * 14 + Math.sin(phase) * 22 * running * (forward || 1);
      const footY = body.floorY + Math.max(0, Math.cos(phase)) * 16 * running;
      const knee = bend(hipX, body.hipY, footX, footY, LEG_SEGMENT, forward || sign, 0.2);
      poseLimb(part(side === 'left' ? 'leftThigh' : 'rightThigh'), hipX, body.hipY, knee[0], knee[1]);
      poseLimb(part(side === 'left' ? 'leftShin' : 'rightShin'), knee[0], knee[1], footX, footY);
      poseJoint(part(side === 'left' ? 'leftKnee' : 'rightKnee'), knee[0], knee[1]);
    }
  });

  const register = (name: Limb | Joint) => (mesh: Mesh | null) => {
    if (mesh === null) parts.current.delete(name);
    else parts.current.set(name, mesh);
  };

  return (
    <group name="juggler">
      {LIMBS.map((name) => (
        <mesh key={name} ref={register(name)}>
          <planeGeometry args={[1, LIMB_THICKNESS]} />
          <meshBasicNodeMaterial color={INK} />
        </mesh>
      ))}
      {JOINTS.map((name) => (
        <mesh key={name} ref={register(name)}>
          <circleGeometry args={[name === 'head' ? figure(world.height).headRadius : LIMB_THICKNESS / 2, 32]} />
          <meshBasicNodeMaterial color={INK} />
        </mesh>
      ))}
    </group>
  );
}

/** Stretches a unit-length plane between two points. */
function poseLimb(mesh: Mesh | undefined, ax: number, ay: number, bx: number, by: number): void {
  if (mesh === undefined) return;
  const dx = bx - ax;
  const dy = by - ay;
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, 0);
  mesh.rotation.z = Math.atan2(dy, dx);
  mesh.scale.x = Math.max(Math.hypot(dx, dy), 0.001);
}

function poseJoint(mesh: Mesh | undefined, x: number, y: number): void {
  mesh?.position.set(x, y, 0);
}

/**
 * Two-bone inverse kinematics: the middle joint of two equal segments joining `a` to `b`, bending toward the
 * preferred direction. When the target is out of reach the joint sits on the line and the limb stretches.
 */
function bend(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  segment: number,
  preferX: number,
  preferY: number,
): readonly [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const distance = Math.hypot(dx, dy);
  const midX = (ax + bx) / 2;
  const midY = (ay + by) / 2;
  if (distance >= 2 * segment || distance === 0) return [midX, midY];
  const height = Math.sqrt(segment * segment - (distance / 2) * (distance / 2));
  const px = (-dy / distance) * height;
  const py = (dx / distance) * height;
  const toward = px * preferX + py * preferY >= 0 ? 1 : -1;
  return [midX + px * toward, midY + py * toward];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
